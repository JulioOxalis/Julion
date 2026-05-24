import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface PackageSection {
  name: string;
  data: Buffer;
  hash: string;
}

export interface PackageIndexEntry {
  name: string;
  offset: number;
  length: number;
  hash: string;
}

export interface PackageResult {
  outputPath: string;
  size: number;
  integrityHash: string;
}

function createSection(name: string, data: Buffer): PackageSection {
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return { name, data, hash };
}

export async function packageOnFile(
  outputPath: string,
  manifest: any,
  meta: any,
  dependenciesGraph: any,
  tree: any,
  indexMap: any,
  chunks: Array<{ chunkId: string; data: Buffer; originalSize: number; compressedSize: number; compression: string }>
): Promise<PackageResult> {
  const sections: PackageSection[] = [
    createSection('manifest.jl', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')),
    createSection('meta.jl', Buffer.from(JSON.stringify(meta, null, 2), 'utf8')),
    createSection('dependencies.jl', Buffer.from(JSON.stringify(dependenciesGraph, null, 2), 'utf8')),
    createSection('tree.jl', Buffer.from(JSON.stringify(tree, null, 2), 'utf8')),
    createSection('index.map', Buffer.from(JSON.stringify(indexMap, null, 2), 'utf8'))
  ];

  const chunksBin = Buffer.concat(chunks.map((chunk) => chunk.data));
  sections.push(createSection('chunks.bin', chunksBin));

  const header = Buffer.from('JULIONON');
  const sectionCount = Buffer.alloc(4);
  sectionCount.writeUInt32BE(sections.length, 0);

  const sectionDescriptors = sections.map((section) => {
    const nameBuffer = Buffer.from(section.name, 'utf8');
    const descriptor = Buffer.alloc(4 + nameBuffer.byteLength + 8 + 8 + 32);
    descriptor.writeUInt32BE(nameBuffer.byteLength, 0);
    nameBuffer.copy(descriptor, 4);
    descriptor.writeBigUInt64BE(BigInt(section.data.byteLength), 4 + nameBuffer.byteLength);
    descriptor.writeBigUInt64BE(BigInt(Buffer.from(section.hash, 'hex').byteLength), 4 + nameBuffer.byteLength + 8);
    Buffer.from(section.hash, 'hex').copy(descriptor, 4 + nameBuffer.byteLength + 8 + 8);
    return descriptor;
  });

  const headerBuffer = Buffer.concat([header, sectionCount, ...sectionDescriptors]);
  const contentBuffer = Buffer.concat([headerBuffer, ...sections.map((section) => section.data)]);
  const integrityHash = crypto.createHash('sha256').update(contentBuffer).digest('hex');
  await fs.writeFile(outputPath, contentBuffer);

  return {
    outputPath,
    size: contentBuffer.byteLength,
    integrityHash
  };
}
