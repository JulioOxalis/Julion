import { createReadStream, createWriteStream, promises as fsPromises } from "fs";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";

const gzipAsync   = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const SIGNATURE   = "JULIONON";

export function tmpPath(suffix) {
  return join(tmpdir(), `julion_${Date.now()}_${Math.random().toString(36).slice(2)}_${suffix}`);
}

export async function readOnArchive(filePath) {
  const raw = await fsPromises.readFile(filePath);

  // Signature check
  const sig = raw.slice(0, SIGNATURE.length).toString("utf8");
  if (sig !== SIGNATURE) throw new Error("Invalid .on archive signature");

  let pos = SIGNATURE.length; // 8

  // Entry count (4-byte big-endian)
  const entryCount = raw.readUInt32BE(pos); pos += 4;

  // Parse TOC entries
  const toc = [];
  for (let i = 0; i < entryCount; i++) {
    const nameLen = raw.readUInt32BE(pos); pos += 4;
    const name    = raw.slice(pos, pos + nameLen).toString("utf8"); pos += nameLen;
    // Content size: 8 bytes big-endian (two 32-bit halves)
    const contentSize = raw.readUInt32BE(pos) * 0x100000000 + raw.readUInt32BE(pos + 4); pos += 8;
    // Hash size: 8 bytes big-endian
    const hashSize    = raw.readUInt32BE(pos) * 0x100000000 + raw.readUInt32BE(pos + 4); pos += 8;
    pos += hashSize; // skip hash bytes
    toc.push({ name, contentSize });
  }

  // Data section starts at current pos
  let dataOffset = pos;
  const archive = {};

  for (const entry of toc) {
    const content = raw.slice(dataOffset, dataOffset + entry.contentSize);
    dataOffset += entry.contentSize;

    // Strip .jl extension to get key name
    const key = entry.name.replace(/\.jl$/, "");

    // Binary sections — keep as Buffer (converting to string loses data)
    if (entry.name.endsWith(".bin")) {
      archive[key] = content;
      continue;
    }

    // Try gzip decompress, fallback to raw
    let text;
    try { text = (await gunzipAsync(content)).toString("utf8"); }
    catch { text = content.toString("utf8"); }

    // Try JSON parse, fallback to raw string
    try { archive[key] = JSON.parse(text); }
    catch { archive[key] = text; }
  }

  // Normalize index
  if (Array.isArray(archive.index)) archive.index = { files: archive.index };
  if (!archive.index) archive.index = { files: [] };

  // If index.files is empty, derive from meta.structure.files
  if (!archive.index.files?.length && archive.meta?.structure?.files?.length) {
    archive.index.files = archive.meta.structure.files.filter(f => !f.endsWith(".on"));
  }

  if (!archive.files)     archive.files     = {};
  if (!archive.checksums) archive.checksums = {};

  // Derive checksums from tree if available and checksums is empty
  if (!Object.keys(archive.checksums).length && archive.tree && typeof archive.tree === "object") {
    for (const [k, v] of Object.entries(archive.tree)) {
      if (v?.checksum) archive.checksums[k] = v.checksum;
      else if (v?.hash) archive.checksums[k] = v.hash;
    }
  }

  return archive;
}

export async function writeOnArchive(archive, filePath) {
  const entries = [];

  for (const [key, value] of Object.entries(archive)) {
    if (value === null || value === undefined) continue;
    let name, content;
    if (key.endsWith(".bin")) {
      name    = key;
      content = Buffer.isBuffer(value) ? value : Buffer.from(value);
    } else {
      name = key + ".jl";
      const json = Buffer.from(JSON.stringify(value), "utf8");
      try { content = await gzipAsync(json, { level: 9 }); }
      catch { content = json; }
    }
    entries.push({ name, content });
  }

  const sig      = Buffer.from(SIGNATURE, "utf8");
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32BE(entries.length, 0);

  const tocParts  = [sig, countBuf];
  const dataParts = [];

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32BE(nameBuf.length, 0);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeUInt32BE(0, 0);
    sizeBuf.writeUInt32BE(content.length, 4);
    const hashBuf = Buffer.alloc(8, 0);
    tocParts.push(nameLen, nameBuf, sizeBuf, hashBuf);
    dataParts.push(content);
  }

  await fsPromises.writeFile(filePath, Buffer.concat([...tocParts, ...dataParts]));
}

export async function downloadDriveFile(drive, fileId) {
  const dest = tmpPath("dl.on");
  const writer = createWriteStream(dest);
  const driveRes = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  await new Promise((resolve, reject) =>
    driveRes.data.pipe(writer).on("finish", resolve).on("error", reject)
  );
  return dest;
}

export async function uploadDriveFile(drive, fileId, archive) {
  const src = tmpPath("ul.on");
  try {
    await writeOnArchive(archive, src);
    await drive.files.update({
      fileId,
      media: { body: createReadStream(src) },
    });
  } finally {
    await fsPromises.unlink(src).catch(() => {});
  }
}
