import { requireAuth } from "../../lib/auth.js";
import { getDriveForUser, listRepositories } from "../../lib/drive.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const drive = await getDriveForUser(user.email);
    const repos  = await listRepositories(drive);
    return res.status(200).json({
      success: true,
      data: repos.map((r) => ({
        id:           r.id,
        name:         r.name,
        modifiedTime: r.modifiedTime,
      })),
      error: null,
    });
  } catch (err) {
    if (err.message === "no_token") {
      return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
    }
    console.error("[repositories]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to list repositories" });
  }
}
