import crypto from 'crypto';

export interface FileChunkReference {
  contentHash: string;
  chunkIds: string[];
}

export interface ChunkMetadata {
  chunkId: string;
  contentHash: string;
  offset: number;
  length: number;
  category: string;
  originalSize: number;
}

export interface ChunkData {
  chunkId: string;
  data: Buffer;
  metadata: ChunkMetadata;
}

function chunkSizeByCategory(category: string) {
  if (category === 'source_code') {
    return 64 * 1024;
  }
  if (category === 'assets') {
    return 256 * 1024;
  }
  return 128 * 1024;
}

export function splitIntoChunks(blobs: Record<string, { content: Buffer; category: string }>) {
  const chunkMap: Record<string, FileChunkReference> = {};
  const chunks: ChunkData[] = [];

  for (const [contentHash, blob] of Object.entries(blobs)) {
    const size = chunkSizeByCategory(blob.category);
    const totalSize = blob.content.byteLength;
    const chunkIds: string[] = [];

    for (let offset = 0; offset < totalSize; offset += size) {
      const slice = blob.content.slice(offset, offset + size);
      const chunkId = crypto.createHash('sha256').update(slice).digest('hex');
      chunkIds.push(chunkId);

      if (!chunks.some((existing) => existing.chunkId === chunkId)) {
        chunks.push({
          chunkId,
          data: slice,
          metadata: {
            chunkId,
            contentHash,
            offset: 0,
            length: slice.byteLength,
            category: blob.category,
            originalSize: slice.byteLength
          }
        });
      }
    }

    chunkMap[contentHash] = { contentHash, chunkIds };
  }

  return { chunks, chunkMap };
}
