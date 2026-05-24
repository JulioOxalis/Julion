import zlib, { brotliCompress } from 'zlib';
import { promisify } from 'util';
import path from 'path';
import { ChunkData } from './chunker';

const brotliCompressAsync = promisify(brotliCompress);
const compressedExtensions = new Set(['.zip', '.gz', '.mp4', '.mov', '.avi', '.webp', '.png', '.jpg', '.jpeg', '.mp3']);

export interface CompressedChunk {
  chunkId: string;
  originalSize: number;
  compressedSize: number;
  compression: 'brotli' | 'none';
  data: Buffer;
  category: string;
}

function isAlreadyCompressed(relativePath: string) {
  return compressedExtensions.has(path.extname(relativePath).toLowerCase());
}

export async function compressChunks(chunks: ChunkData[], categoryByChunk: Record<string, string>, filePaths: Record<string, string>) {
  const compressedChunks: CompressedChunk[] = [];

  for (const chunk of chunks) {
    const category = categoryByChunk[chunk.chunkId] || chunk.metadata.category;
    const extension = path.extname(filePaths[chunk.metadata.contentHash] ?? '');
    const skipCompression = isAlreadyCompressed(extension) || category === 'assets';

    if (skipCompression) {
      compressedChunks.push({
        chunkId: chunk.chunkId,
        originalSize: chunk.data.byteLength,
        compressedSize: chunk.data.byteLength,
        compression: 'none',
        data: chunk.data,
        category
      });
      continue;
    }

    const compressed = await brotliCompressAsync(chunk.data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: chunk.data.byteLength
      }
    });

    if (compressed.byteLength < chunk.data.byteLength) {
      compressedChunks.push({
        chunkId: chunk.chunkId,
        originalSize: chunk.data.byteLength,
        compressedSize: compressed.byteLength,
        compression: 'brotli',
        data: compressed,
        category
      });
    } else {
      compressedChunks.push({
        chunkId: chunk.chunkId,
        originalSize: chunk.data.byteLength,
        compressedSize: chunk.data.byteLength,
        compression: 'none',
        data: chunk.data,
        category
      });
    }
  }

  return compressedChunks;
}
