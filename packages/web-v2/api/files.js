import crypto from "crypto";
import { brotliDecompress } from "zlib";
import { promisify } from "util";
import { promises as fsPromises } from "fs";
import { requireAuth } from "../lib/auth.js";
import { getDriveForJWT, listSnapshots } from "../lib/drive.js";
import { downloadDriveFile, readOnArchive, uploadDriveFile } from "../lib/archive.js";

const brotliDecompressAsync = promisify(brotliDecompress);

async function extractFromChunks(arc, filePath) {
  const tree = Array.isArray(arc.tree) ? arc.tree : null;
  if (!tree) return null;

  const entry = tree.find(e => e.relativePath === filePath);
  if (!entry || entry.excluded || !entry.chunkIds?.length) return null;

  const chunkMeta = arc["index.map"]?.chunks;
  if (!chunkMeta?.length) return null;

  const chunksBin = arc["chunks.bin"];
  if (!chunksBin) return null;

  const bin = Buffer.isBuffer(chunksBin) ? chunksBin : Buffer.from(chunksBin, "binary");

  // Build offset map from chunk metadata
  let offset = 0;
  const offsetMap = {};
  for (const chunk of chunkMeta) {
    offsetMap[chunk.chunkId] = { offset, size: chunk.compressedSize, compression: chunk.compression };
    offset += chunk.compressedSize;
  }

  const parts = [];
  for (const chunkId of entry.chunkIds) {
    const meta = offsetMap[chunkId];
    if (!meta) return null;
    const chunkData = bin.slice(meta.offset, meta.offset + meta.size);
    const decompressed = meta.compression === "brotli"
      ? await brotliDecompressAsync(chunkData)
      : chunkData;
    parts.push(decompressed);
  }

  return Buffer.concat(parts);
}

const IMAGE_EXTS  = new Set(["png","jpg","jpeg","gif","ico","webp","bmp","svg"]);
const BINARY_EXTS = new Set([
  "pdf","zip","tar","gz","7z","rar",
  "exe","dll","so","dylib","class","jar","wasm",
  "mp3","mp4","wav","ogg","ttf","woff","woff2",
]);

function getExt(filename) { return (filename.split(".").pop() || "").toLowerCase(); }
function isImage(filename)  { return IMAGE_EXTS.has(getExt(filename)); }
function isBinary(filename) { return BINARY_EXTS.has(getExt(filename)); }

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET: read file content ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { repo, snapshot, file } = req.query;
    if (!repo || !snapshot || !file) return res.status(400).json({ success: false, data: null, error: "Missing repo, snapshot, or file" });

    let tmp = null;
    try {
      const drive = await getDriveForJWT(user);
      const snaps = await listSnapshots(drive, repo);
      const snap  = snaps.find(s => s.name === snapshot);
      if (!snap) return res.status(404).json({ success: false, data: null, error: "Snapshot not found" });

      tmp = await downloadDriveFile(drive, snap.id);
      const arc = await readOnArchive(tmp);

      if (!arc.index?.files?.includes(file)) return res.status(404).json({ success: false, data: null, error: "File not in snapshot" });

      // Check if file is marked excluded in tree (e.g. .env — excluded for security)
      if (Array.isArray(arc.tree)) {
        const treeEntry = arc.tree.find(e => e.relativePath === file);
        if (treeEntry?.excluded) {
          return res.status(200).json({ success: true, data: { excluded: true, content: null }, error: null });
        }
      }

      if (isBinary(file)) return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });

      // Basic snapshots store files as base64 in arc.files
      // Ultra snapshots store content in arc.chunks.bin — reconstruct from there
      let contentBuf = null;
      const b64 = arc.files?.[file];
      if (b64) {
        contentBuf = Buffer.from(b64, "base64");
      } else {
        contentBuf = await extractFromChunks(arc, file);
      }

      if (!contentBuf) return res.status(404).json({ success: false, data: null, error: "File content missing in archive" });

      // Images: return as base64 data URL for browser display
      if (isImage(file)) {
        const ext  = getExt(file);
        const mime = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : `image/${ext}`;
        return res.status(200).json({ success: true, data: { image: true, mime, content: contentBuf.toString("base64") }, error: null });
      }

      if (contentBuf.includes(0)) return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });

      return res.status(200).json({ success: true, data: { binary: false, content: contentBuf.toString("utf8") }, error: null });
    } catch (err) {
      if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
      return res.status(500).json({ success: false, data: null, error: "Failed to read file" });
    } finally {
      if (tmp) await fsPromises.unlink(tmp).catch(() => {});
    }
  }

  // ── POST: save file content ───────────────────────────────────────────────────
  if (req.method === "POST") {
    const { repo, snapshot, file, content } = req.body || {};
    if (!repo || !snapshot || !file || content === undefined) return res.status(400).json({ success: false, data: null, error: "Missing repo, snapshot, file, or content" });

    let tmp = null;
    try {
      const drive = await getDriveForJWT(user);
      const snaps = await listSnapshots(drive, repo);
      const snap  = snaps.find(s => s.name === snapshot);
      if (!snap) return res.status(404).json({ success: false, data: null, error: "Snapshot not found on Drive" });

      tmp = await downloadDriveFile(drive, snap.id);
      const arc = await readOnArchive(tmp);

      if (!arc.index?.files?.includes(file)) return res.status(404).json({ success: false, data: null, error: "File not in snapshot" });

      arc.files[file] = Buffer.from(content, "utf8").toString("base64");
      if (arc.checksums) arc.checksums[file] = "sha256:" + crypto.createHash("sha256").update(content).digest("hex");

      await uploadDriveFile(drive, snap.id, arc);
      return res.status(200).json({ success: true, data: { saved: true }, error: null });
    } catch (err) {
      if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
      return res.status(500).json({ success: false, data: null, error: "Failed to save file" });
    } finally {
      if (tmp) await fsPromises.unlink(tmp).catch(() => {});
    }
  }

  return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
}
