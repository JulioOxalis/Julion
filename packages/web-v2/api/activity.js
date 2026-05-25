import { requireAuth } from "../lib/auth.js";
import { getDriveForUser, listRepositories, listSnapshots } from "../lib/drive.js";

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!n) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const drive = await getDriveForUser(user.email);
    const repos = await listRepositories(drive);

    // Fetch snapshots from up to 6 repos in parallel
    const snapsByRepo = await Promise.all(
      repos.slice(0, 6).map(async (repo) => {
        const snaps = await listSnapshots(drive, repo.name);
        return { repo: repo.name, snaps: snaps.slice(0, 4) };
      })
    );

    const activity = snapsByRepo
      .flatMap(({ repo, snaps }) => snaps.map(s => ({
        repo,
        name:          s.name,
        size:          s.size,
        sizeFormatted: fmtBytes(s.size),
        modifiedTime:  s.modifiedTime,
      })))
      .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
      .slice(0, 12);

    const totalSnaps = snapsByRepo.reduce((n, { snaps }) => n + snaps.length, 0);

    return res.status(200).json({
      success: true,
      data: {
        repos: repos.map(r => ({ name: r.name, modifiedTime: r.modifiedTime })),
        activity,
        totalRepos: repos.length,
        totalSnaps,
      },
      error: null,
    });
  } catch (err) {
    if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
    console.error("[activity]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to load activity" });
  }
}
