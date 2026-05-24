import { promises as fs } from 'fs';
import path from 'path';
import { readOnArchive } from 'julion-core';

export interface RestoreOptions {
  overwrite?: boolean;
}

async function ensureSafeRelativePath(relativePath: string) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid archive path: ${relativePath}`);
  }
  return normalized;
}

export async function restoreSnapshot(onFilePath: string, targetPath: string, options: RestoreOptions = {}) {
  const archive = await readOnArchive(onFilePath);
  await fs.mkdir(targetPath, { recursive: true });

  let restoredFiles = 0;

  for (const relative of archive.index.files) {
    const safePath = await ensureSafeRelativePath(relative);
    const destination = path.join(targetPath, safePath);
    const destinationDir = path.dirname(destination);

    await fs.mkdir(destinationDir, { recursive: true });

    try {
      if (!options.overwrite) {
        await fs.access(destination);
        continue;
      }
    } catch {
      // File does not exist, continue to write.
    }

    const content = Buffer.from(archive.files[relative], 'base64');
    await fs.writeFile(destination, content, { flag: 'w' });
    restoredFiles += 1;
  }

  return {
    snapshotName: archive.manifest.name,
    targetPath,
    totalFiles: archive.index.files.length,
    restoredFiles
  };
}
