import { promises as fsPromises } from "fs";
import { requireAuth } from "../../lib/auth.js";
import { getDriveForUser, listSnapshots } from "../../lib/drive.js";
import { downloadDriveFile, readOnArchive } from "../../lib/archive.js";

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
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { repo, snapshot, file } = req.query;
  if (!repo || !snapshot || !file) {
    return res.status(400).json({ success: false, data: null, error: "Missing repo, snapshot, or file" });
  }

  let tmpFile = null;
  try {
    const drive = await getDriveForUser(user.email);
    const snaps = await listSnapshots(drive, repo);
    const snap  = snaps.find((s) => s.name === snapshot);
    if (!snap) {
      return res.status(404).json({ success: false, data: null, error: "Snapshot not found" });
    }

    tmpFile = await downloadDriveFile(drive, snap.id);
    const archive = await readOnArchive(tmpFile);

    if (!archive.index?.files?.includes(file)) {
      return res.status(404).json({ success: false, data: null, error: "File not in snapshot" });
    }

    if (isBinary(file)) {
      return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });
    }

    const b64 = archive.files?.[file];
    if (!b64) {
      return res.status(404).json({ success: false, data: null, error: "File content missing in archive" });
    }

    const content = Buffer.from(b64, "base64").toString("utf8");
    if (content.includes("\0")) {
      return res.status(200).json({ success: true, data: { binary: true, content: null }, error: null });
    }

    return res.status(200).json({ success: true, data: { binary: false, content }, error: null });
  } catch (err) {
    if (err.message === "no_token") {
      return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
    }
    console.error("[files/content]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to read file" });
  } finally {
    if (tmpFile) await fsPromises.unlink(tmpFile).catch(() => {});
  }
}
