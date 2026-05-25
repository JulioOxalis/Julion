import { promises as fsPromises } from "fs";
import { requireAuth } from "../lib/auth.js";
import { getDriveForUser, listRepositories, listSnapshots } from "../lib/drive.js";
import { downloadDriveFile, readOnArchive } from "../lib/archive.js";

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!n) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" });
}

function treeText(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i] + "/"]) node[parts[i] + "/"] = {};
      node = node[parts[i] + "/"];
    }
    node[parts[parts.length - 1]] = null;
  }
  function render(node, pad = "") {
    return Object.entries(node)
      .sort(([a], [b]) => {
        const ad = a.endsWith("/"), bd = b.endsWith("/");
        return ad !== bd ? (ad ? -1 : 1) : a.localeCompare(b);
      })
      .flatMap(([name, children]) =>
        children !== null
          ? [pad + "📁 " + name, ...render(children, pad + "  ")]
          : [pad + "📄 " + name]
      );
  }
  return render(root).join("\n");
}

const HELP = `Julion Web Terminal — commands run against your Google Drive

  help                            Show this help
  ls                              List all repositories
  ls <repo>                       List snapshots in a repository
  inspect <repo> <snapshot>       Show file tree of a snapshot
  stat <repo> <snapshot>          Show snapshot metadata & stats
  diff <repo> <snap1> <snap2>     Compare two snapshots
  clear                           Clear the terminal`;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  const user = requireAuth(req, res);
  if (!user) return;

  const cmd = (req.query.cmd || "").trim();
  if (!cmd) return res.status(400).json({ success: false, data: null, error: "Missing cmd" });

  const parts   = cmd.split(/\s+/);
  const command = parts[0].toLowerCase();

  if (command === "help")  return res.status(200).json({ success: true, data: { output: HELP, type: "info" }, error: null });
  if (command === "clear") return res.status(200).json({ success: true, data: { output: "__CLEAR__" }, error: null });

  let tmp1 = null, tmp2 = null;
  try {
    const drive = await getDriveForUser(user.email);

    // ls
    if (command === "ls") {
      if (parts.length === 1) {
        const repos = await listRepositories(drive);
        if (!repos.length) return res.status(200).json({ success: true, data: { output: "No repositories found.\nRun: julion seal --deposit --repository <name>" }, error: null });
        const lines = repos.map(r => r.name.padEnd(36) + fmtDate(r.modifiedTime));
        return res.status(200).json({ success: true, data: { output: lines.join("\n") }, error: null });
      }
      const snaps = await listSnapshots(drive, parts[1]);
      if (!snaps.length) return res.status(200).json({ success: true, data: { output: `No snapshots in "${parts[1]}".` }, error: null });
      const lines = snaps.map(s => s.name.padEnd(36) + fmtBytes(s.size).padEnd(12) + fmtDate(s.modifiedTime));
      return res.status(200).json({ success: true, data: { output: lines.join("\n") }, error: null });
    }

    // inspect
    if (command === "inspect") {
      if (parts.length < 3) return res.status(200).json({ success: true, data: { output: "Usage: inspect <repo> <snapshot>" }, error: null });
      const snaps = await listSnapshots(drive, parts[1]);
      const snap  = snaps.find(s => s.name === parts[2]);
      if (!snap) return res.status(200).json({ success: true, data: { output: `Snapshot "${parts[2]}" not found in "${parts[1]}".` }, error: null });
      tmp1 = await downloadDriveFile(drive, snap.id);
      const arc  = await readOnArchive(tmp1);
      const files = arc.index?.files || [];
      return res.status(200).json({ success: true, data: { output: `${parts[2]}  (${files.length} files)\n\n${treeText(files)}` }, error: null });
    }

    // stat
    if (command === "stat") {
      if (parts.length < 3) return res.status(200).json({ success: true, data: { output: "Usage: stat <repo> <snapshot>" }, error: null });
      const snaps = await listSnapshots(drive, parts[1]);
      const snap  = snaps.find(s => s.name === parts[2]);
      if (!snap) return res.status(200).json({ success: true, data: { output: `Snapshot "${parts[2]}" not found in "${parts[1]}".` }, error: null });
      tmp1 = await downloadDriveFile(drive, snap.id);
      const arc = await readOnArchive(tmp1);
      const m   = arc.manifest || {};
      const files = arc.index?.files || [];
      const lines = [
        `Snapshot:   ${parts[2]}`,
        `Repository: ${parts[1]}`,
        `Size:       ${fmtBytes(snap.size)}`,
        `Modified:   ${fmtDate(snap.modifiedTime)}`,
        `Files:      ${files.length}`,
        `Project:    ${m.projectName || "—"}`,
        `Created:    ${m.createdAt ? fmtDate(m.createdAt) : "—"}`,
      ];
      return res.status(200).json({ success: true, data: { output: lines.join("\n") }, error: null });
    }

    // diff
    if (command === "diff") {
      if (parts.length < 4) return res.status(200).json({ success: true, data: { output: "Usage: diff <repo> <snapshot1> <snapshot2>" }, error: null });
      const snaps = await listSnapshots(drive, parts[1]);
      const s1 = snaps.find(s => s.name === parts[2]);
      const s2 = snaps.find(s => s.name === parts[3]);
      if (!s1 || !s2) return res.status(200).json({ success: true, data: { output: "One or both snapshots not found." }, error: null });
      [tmp1, tmp2] = await Promise.all([downloadDriveFile(drive, s1.id), downloadDriveFile(drive, s2.id)]);
      const [a1, a2] = await Promise.all([readOnArchive(tmp1), readOnArchive(tmp2)]);
      const f1 = new Set(a1.index?.files || []), f2 = new Set(a2.index?.files || []);
      const c1 = a1.checksums || {}, c2 = a2.checksums || {};
      const added    = [...f2].filter(f => !f1.has(f));
      const removed  = [...f1].filter(f => !f2.has(f));
      const modified = [...f2].filter(f => f1.has(f) && c1[f] !== c2[f]);
      const lines = [
        `${parts[2]}  →  ${parts[3]}`,
        "",
        ...added.map(f => `+ ${f}`),
        ...removed.map(f => `- ${f}`),
        ...modified.map(f => `~ ${f}`),
        "",
        `+${added.length} added  -${removed.length} removed  ~${modified.length} modified`,
      ];
      return res.status(200).json({ success: true, data: { output: lines.join("\n"), diff: true }, error: null });
    }

    return res.status(200).json({ success: true, data: { output: `Unknown command: "${command}"\nType "help" for available commands.`, type: "error" }, error: null });
  } catch (err) {
    if (err.message === "no_token") return res.status(200).json({ success: true, data: { output: "Error: Google Drive not connected.", type: "error" }, error: null });
    console.error("[terminal]", err);
    return res.status(200).json({ success: true, data: { output: `Error: ${err.message}`, type: "error" }, error: null });
  } finally {
    await Promise.all([
      tmp1 ? fsPromises.unlink(tmp1).catch(() => {}) : null,
      tmp2 ? fsPromises.unlink(tmp2).catch(() => {}) : null,
    ]);
  }
}
