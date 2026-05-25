import { createReadStream, createWriteStream, promises as fsPromises } from "fs";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";

const gzipAsync   = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const SIGNATURE   = "JULION_ON\n";

export function tmpPath(suffix) {
  return join(tmpdir(), `julion_${Date.now()}_${Math.random().toString(36).slice(2)}_${suffix}`);
}

export async function readOnArchive(filePath) {
  const raw = await fsPromises.readFile(filePath);
  const sig = raw.slice(0, SIGNATURE.length).toString("utf8");
  if (sig !== SIGNATURE) throw new Error("Invalid .on archive signature");
  const decompressed = await gunzipAsync(raw.slice(SIGNATURE.length));
  return JSON.parse(decompressed.toString("utf8"));
}

export async function writeOnArchive(archive, filePath) {
  const compressed = await gzipAsync(
    Buffer.from(JSON.stringify(archive), "utf8"),
    { level: 9 }
  );
  await fsPromises.writeFile(
    filePath,
    Buffer.concat([Buffer.from(SIGNATURE, "utf8"), compressed])
  );
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
