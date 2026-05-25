import { requireAuth } from "../lib/auth.js";
import { getDriveForJWT, listSnapshots } from "../lib/drive.js";

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { repo } = req.query;
  if (!repo) {
    return res.status(400).json({ success: false, data: null, error: "Missing repo parameter" });
  }

  try {
    const drive     = await getDriveForJWT(user);
    const snapshots = await listSnapshots(drive, repo);
    return res.status(200).json({
      success: true,
      data: snapshots.map((s) => ({
        id:            s.id,
        name:          s.name,
        size:          s.size,
        sizeFormatted: formatBytes(s.size),
        modifiedTime:  s.modifiedTime,
      })),
      error: null,
    });
  } catch (err) {
    if (err.message === "no_token") {
      return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
    }
    console.error("[snapshots]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to list snapshots" });
  }
}
