import crypto from "crypto";
import { promises as fsPromises } from "fs";
import { requireAuth } from "../lib/auth.js";
import { getDriveForUser, listSnapshots } from "../lib/drive.js";
import { downloadDriveFile, readOnArchive } from "../lib/archive.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  const user = requireAuth(req, res);
  if (!user) return;

  const { action, repo, snapshot, snapshot1, snapshot2 } = req.query;
  if (!action || !repo) return res.status(400).json({ success: false, data: null, error: "Missing action or repo" });

  // ── tree ─────────────────────────────────────────────────────────────────────
  if (action === "tree") {
    if (!snapshot) return res.status(400).json({ success: false, data: null, error: "Missing snapshot" });
    let tmp = null;
    try {
      const drive = await getDriveForUser(user.email);
      const snaps = await listSnapshots(drive, repo);
      const snap  = snaps.find(s => s.name === snapshot);
      if (!snap) return res.status(404).json({ success: false, data: null, error: "Snapshot not found" });

      tmp = await downloadDriveFile(drive, snap.id);
      const arc   = await readOnArchive(tmp);
      const files = arc.index?.files || [];
      const readme = files.find(f => /^readme(\.(md|txt|rst))?$/i.test(f.split("/").pop() || ""));
      return res.status(200).json({
        success: true,
        data: { snapshot: snap.name, size: snap.size, modifiedTime: snap.modifiedTime, manifest: arc.manifest || {}, files, checksums: arc.checksums || {}, totalFiles: files.length, readmeFile: readme || null },
        error: null,
      });
    } catch (err) {
      if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
      return res.status(500).json({ success: false, data: null, error: "Failed to read snapshot" });
    } finally {
      if (tmp) await fsPromises.unlink(tmp).catch(() => {});
    }
  }

  // ── compare ───────────────────────────────────────────────────────────────────
  if (action === "compare") {
    if (!snapshot1 || !snapshot2) return res.status(400).json({ success: false, data: null, error: "Missing snapshot1 or snapshot2" });
    let tmp1 = null, tmp2 = null;
    try {
      const drive = await getDriveForUser(user.email);
      const snaps = await listSnapshots(drive, repo);
      const s1 = snaps.find(s => s.name === snapshot1);
      const s2 = snaps.find(s => s.name === snapshot2);
      if (!s1 || !s2) return res.status(404).json({ success: false, data: null, error: "Snapshot(s) not found" });

      [tmp1, tmp2] = await Promise.all([downloadDriveFile(drive, s1.id), downloadDriveFile(drive, s2.id)]);
      const [a1, a2] = await Promise.all([readOnArchive(tmp1), readOnArchive(tmp2)]);
      const f1 = new Set(a1.index?.files || []), f2 = new Set(a2.index?.files || []);
      const c1 = a1.checksums || {}, c2 = a2.checksums || {};
      const added     = [...f2].filter(f => !f1.has(f));
      const removed   = [...f1].filter(f => !f2.has(f));
      const modified  = [...f2].filter(f => f1.has(f) && c1[f] !== c2[f]);
      const unchanged = [...f2].filter(f => f1.has(f) && c1[f] === c2[f]);
      return res.status(200).json({
        success: true,
        data: { snapshot1, snapshot2, added, removed, modified, unchanged, summary: { added: added.length, removed: removed.length, modified: modified.length, unchanged: unchanged.length } },
        error: null,
      });
    } catch (err) {
      if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
      return res.status(500).json({ success: false, data: null, error: err.message });
    } finally {
      await Promise.all([
        tmp1 ? fsPromises.unlink(tmp1).catch(() => {}) : null,
        tmp2 ? fsPromises.unlink(tmp2).catch(() => {}) : null,
      ]);
    }
  }

  // ── verify ────────────────────────────────────────────────────────────────────
  if (action === "verify") {
    if (!snapshot) return res.status(400).json({ success: false, data: null, error: "Missing snapshot" });
    let tmp = null;
    try {
      const drive = await getDriveForUser(user.email);
      const snaps = await listSnapshots(drive, repo);
      const snap  = snaps.find(s => s.name === snapshot);
      if (!snap) return res.status(404).json({ success: false, data: null, error: "Snapshot not found" });

      tmp = await downloadDriveFile(drive, snap.id);
      const arc = await readOnArchive(tmp);
      const files = arc.index?.files || [], checksums = arc.checksums || {}, fileContents = arc.files || {};

      const results = {};
      let passed = 0, failed = 0, skipped = 0;
      for (const file of files) {
        const stored = checksums[file], b64 = fileContents[file];
        if (!stored || !b64) { results[file] = "skipped"; skipped++; continue; }
        const actual = "sha256:" + crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
        if (actual === stored) { results[file] = "ok"; passed++; }
        else                   { results[file] = "tampered"; failed++; }
      }
      return res.status(200).json({
        success: true,
        data: { results, summary: { passed, failed, skipped, total: files.length }, clean: failed === 0 },
        error: null,
      });
    } catch (err) {
      if (err.message === "no_token") return res.status(403).json({ success: false, data: null, error: "Google Drive not connected" });
      return res.status(500).json({ success: false, data: null, error: err.message });
    } finally {
      if (tmp) await fsPromises.unlink(tmp).catch(() => {});
    }
  }

  return res.status(400).json({ success: false, data: null, error: "Unknown action" });
}
