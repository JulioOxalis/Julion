import crypto from "crypto";
import { promises as fsPromises } from "fs";
import { requireAuth } from "../../lib/auth.js";
import { getDriveForUser, listSnapshots } from "../../lib/drive.js";
import { downloadDriveFile, readOnArchive, uploadDriveFile } from "../../lib/archive.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { repo, snapshot, file, content } = req.body || {};
  if (!repo || !snapshot || !file || content === undefined) {
    return res.status(400).json({ success: false, data: null, error: "Missing repo, snapshot, file, or content" });
  }

  let tmpFile = null;
  try {
    const drive = await getDriveForUser(user.email);
    const snaps = await listSnapshots(drive, repo);
    const snap  = snaps.find((s) => s.name === snapshot);
    if (!snap) {
      return res.status(404).json({ success: false, data: null, error: "Snapshot not found on Drive" });
    }

    tmpFile = await downloadDriveFile(drive, snap.id);
    const archive = await readOnArchive(tmpFile);

    if (!archive.index?.files?.includes(file)) {
      return res.status(404).json({ success: false, data: null, error: "File not in snapshot" });
    }

    archive.files[file] = Buffer.from(content, "utf8").toString("base64");
    if (archive.checksums) {
      archive.checksums[file] =
        "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
    }

    await uploadDriveFile(drive, snap.id, archive);

    return res.status(200).json({ success: true, data: { saved: true }, error: null });
  } catch (err) {
    if (err.message === "no_token") {
      return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
    }
    console.error("[files/save]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to save file" });
  } finally {
    if (tmpFile) await fsPromises.unlink(tmpFile).catch(() => {});
  }
}
