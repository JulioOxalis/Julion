import crypto from "crypto";
import { promises as fsPromises } from "fs";
import { requireAuth } from "../lib/auth.js";
import { getDriveForJWT, listSnapshots } from "../lib/drive.js";
import { downloadDriveFile, readOnArchive, uploadDriveFile } from "../lib/archive.js";

const BINARY_EXTS = new Set([
  "png","jpg","jpeg","gif","ico","webp","bmp","svg",
  "pdf","zip","tar","gz","7z","rar",
  "exe","dll","so","dylib","class","jar","wasm",
  "mp3","mp4","wav","ogg","ttf","woff","woff2",
]);

function isBinary(filename) {
  return BINARY_EXTS.has((filename.split(".").pop() || "").toLowerCase());
}

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
      if (isBinary(file)) return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });

      const b64 = arc.files?.[file];
      if (!b64) return res.status(404).json({ success: false, data: null, error: "File content missing in archive" });

      const content = Buffer.from(b64, "base64").toString("utf8");
      if (content.includes("\0")) return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });

      return res.status(200).json({ success: true, data: { binary: false, content }, error: null });
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
