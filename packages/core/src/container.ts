import { promises as fs } from 'fs';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { JulionManifest, JulionMetadata } from './types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const SIGNATURE = 'JULION_ON\n';

export interface JulionSnapshotIndex {
  files: string[];
  modules: string[];
  routes: string[];
}

export interface JulionOnContainer {
  header: {
    magic: 'JULION_ON';
    version: '1.0';
    created_at: string;
  };
  manifest: JulionManifest;
  metadata: JulionMetadata;
  checksums: Record<string, string>;
  index: JulionSnapshotIndex;
  files: Record<string, string>;
}

export async function writeOnArchive(outputPath: string, container: Omit<JulionOnContainer, 'header'>) {
  const payload = JSON.stringify({
    header: {
      magic: 'JULION_ON',
      version: '1.0',
      created_at: new Date().toISOString()
    },
    ...container
  });

  const compressed = await gzipAsync(Buffer.from(payload, 'utf8'), { level: 9 });
  const fileBuffer = Buffer.concat([Buffer.from(SIGNATURE, 'utf8'), compressed]);

  await fs.writeFile(outputPath, fileBuffer);
}

export async function readOnArchive(archivePath: string): Promise<JulionOnContainer> {
  const raw = await fs.readFile(archivePath);
  const signature = raw.slice(0, SIGNATURE.length).toString('utf8');

  if (signature !== SIGNATURE) {
    throw new Error('Invalid JULION .on archive signature');
  }

  const compressed = raw.slice(SIGNATURE.length);
  const payload = await gunzipAsync(compressed);
  const parsed = JSON.parse(payload.toString('utf8')) as JulionOnContainer;

  return parsed;
}
