import crypto from 'crypto';
import { promises as fs } from 'fs';
import { ClassifiedFile } from './classifier';

export interface DeduplicatedFile {
  relativePath: string;
  category: ClassifiedFile['category'];
  contentHash: string;
  excluded: boolean;
  reason?: string;
}

export interface DeduplicationResult {
  files: DeduplicatedFile[];
  blobs: Record<string, { size: number; content: Buffer; references: number; category: ClassifiedFile['category'] }>;
  savings: {
    duplicateFiles: number;
    totalFiles: number;
    savingsPercent: number;
  };
}

export async function deduplicateFiles(classifiedFiles: ClassifiedFile[]) {
  const blobs: Record<string, { size: number; content: Buffer; references: number; category: ClassifiedFile['category'] }> = {};
  const files: DeduplicatedFile[] = [];
  let duplicateFiles = 0;

  for (const file of classifiedFiles) {
    if (file.excluded) {
      files.push({
        relativePath: file.relativePath,
        category: file.category,
        contentHash: '',
        excluded: true,
        reason: file.reason
      });
      continue;
    }

    const content = await fs.readFile(file.absolutePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (!blobs[hash]) {
      blobs[hash] = {
        size: content.byteLength,
        content,
        references: 1,
        category: file.category
      };
    } else {
      blobs[hash].references += 1;
      duplicateFiles += 1;
    }

    files.push({
      relativePath: file.relativePath,
      category: file.category,
      contentHash: hash,
      excluded: false
    });
  }

  const totalFiles = classifiedFiles.length;
  const savingsPercent = totalFiles ? (duplicateFiles / totalFiles) * 100 : 0;

  return {
    files,
    blobs,
    savings: {
      duplicateFiles,
      totalFiles,
      savingsPercent: Number(savingsPercent.toFixed(2))
    }
  } as DeduplicationResult;
}
