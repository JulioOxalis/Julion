import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { analyzeProject, ProjectMetadata } from './pipeline/analyzer';
import { classifyFiles, createClassificationStats } from './pipeline/classifier';
import { writeOnArchive } from 'julion-core';
import { resolveDependencies, DependencyGraph } from './pipeline/resolver';
import { deduplicateFiles } from './pipeline/deduplicator';
import { splitIntoChunks } from './pipeline/chunker';
import { compressChunks } from './pipeline/compressor';
import { packageOnFile, PackageResult } from './pipeline/packager';
import { uploadSnapshot } from 'julion-cloud-google-drive';

export interface SaveUltraOptions {
  outputPath?: string;
  push?: boolean;
  repository?: string;
}

export interface SaveUltraResult {
  metadata: ProjectMetadata;
  classificationStats: Record<string, number>;
  dependencyGraph: DependencyGraph;
  deduplication: {
    savingsPercent: number;
    duplicateFiles: number;
    totalFiles: number;
  };
  compression: {
    totalOriginal: number;
    totalCompressed: number;
    ratio: number;
  };
  package: PackageResult;
  upload?: {
    fileId: string;
    fileName: string;
    repositoryName: string;
    repositoryFolderId: string;
    link: string;
  };
}

export async function saveUltra(root: string, options: SaveUltraOptions = {}) {
  const { metadata, manifest } = await analyzeProject(root);
  const files = metadata.structure.files;

  const classified = classifyFiles(root, files);
  const classificationStats = createClassificationStats(classified);

  const dependencyGraph = await resolveDependencies(root);
  const deduplication = await deduplicateFiles(classified);

  const blobsForChunking: Record<string, { content: Buffer; category: string }> = {};
  const filePathsByContent: Record<string, string> = {};
  for (const item of deduplication.files) {
    if (item.excluded || !item.contentHash) {
      continue;
    }
    const blob = deduplication.blobs[item.contentHash];
    if (!blob) {
      continue;
    }
    blobsForChunking[item.contentHash] = {
      content: blob.content,
      category: blob.category
    };
    filePathsByContent[item.contentHash] = item.relativePath;
  }

  const { chunks, chunkMap } = splitIntoChunks(blobsForChunking);
  const categoryByChunk: Record<string, string> = {};
  for (const chunk of chunks) {
    categoryByChunk[chunk.chunkId] = chunk.metadata.category;
  }

  const compressedChunks = await compressChunks(chunks, categoryByChunk, filePathsByContent);
  const totalOriginal = compressedChunks.reduce((sum, chunk) => sum + chunk.originalSize, 0);
  const totalCompressed = compressedChunks.reduce((sum, chunk) => sum + chunk.compressedSize, 0);

  const tree = deduplication.files.map((item) => ({
    relativePath: item.relativePath,
    category: item.category,
    excluded: item.excluded,
    contentHash: item.contentHash,
    chunkIds: item.contentHash ? chunkMap[item.contentHash]?.chunkIds ?? [] : []
  }));

  const indexMap = {
    chunks: compressedChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      originalSize: chunk.originalSize,
      compressedSize: chunk.compressedSize,
      compression: chunk.compression,
      category: chunk.category
    }))
  };

  const outputPath = options.outputPath || path.join(root, `${metadata.name}.on`);
  const packageResult = await packageOnFile(outputPath, manifest, metadata, dependencyGraph, tree, indexMap, compressedChunks);

  const result: SaveUltraResult = {
    metadata,
    classificationStats,
    dependencyGraph,
    deduplication: {
      savingsPercent: deduplication.savings.savingsPercent,
      duplicateFiles: deduplication.savings.duplicateFiles,
      totalFiles: deduplication.savings.totalFiles
    },
    compression: {
      totalOriginal,
      totalCompressed,
      ratio: totalOriginal ? Number((totalCompressed / totalOriginal).toFixed(4)) : 1
    },
    package: packageResult
  };

  if (options.push) {
    const uploadResult = await uploadSnapshot(packageResult.outputPath, options.repository);
    const fileId = uploadResult.fileId || '';
    const fileName = uploadResult.fileName || path.basename(packageResult.outputPath);
    result.upload = {
      fileId,
      fileName,
      repositoryName: uploadResult.repositoryName,
      repositoryFolderId: uploadResult.repositoryFolderId,
      link: `https://drive.google.com/file/d/${fileId}/view`
    };
  }

  return result;
}

const DEFAULT_IGNORE = [
  'vendor/',
  'node_modules/',
  '.git/',
  '.env',
  'storage/logs/',
  'cache/',
  'tmp/',
  'dist/',
  'build/',
  '*.on'
];

function isIgnored(relativePath: string, ignorePatterns: string[]) {
  const normalized = relativePath.replace(/\\/g, '/');
  return ignorePatterns.some((pattern) => {
    if (pattern.endsWith('/')) {
      return normalized === pattern || normalized.startsWith(pattern) || normalized.includes(`/${pattern}`);
    }
    if (pattern.startsWith('*.')) {
      return normalized.endsWith(pattern.slice(1));
    }
    return normalized === pattern || normalized.endsWith(`/${pattern}`);
  });
}

async function walkDirectory(root: string, dir: string, ignorePatterns: string[], files: string[]) {
  const fullPath = path.join(root, dir);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name);
    if (isIgnored(relative, ignorePatterns)) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkDirectory(root, relative, ignorePatterns, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(relative);
    }
  }
}

async function gatherFiles(root: string, ignore: string[]) {
  const files: string[] = [];
  await walkDirectory(root, '.', ignore, files);
  return files;
}

export async function buildSnapshot(projectRoot: string, outputPath?: string, adapterName?: string) {
  const { manifest } = await analyzeProject(projectRoot);
  if (adapterName) {
    manifest.adapter = adapterName;
  }

  const ignorePatterns = manifest.ignore ?? DEFAULT_IGNORE;
  const files = await gatherFiles(projectRoot, ignorePatterns);
  const checksums: Record<string, string> = {};
  const snapshotFiles: Record<string, string> = {};
  let totalSize = 0;

  for (const relative of files) {
    const absolute = path.join(projectRoot, relative);
    const content = await fs.readFile(absolute);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    checksums[relative] = `sha256:${hash}`;
    snapshotFiles[relative] = content.toString('base64');
    totalSize += content.byteLength;
  }

  const metadata = {
    project_root: projectRoot,
    file_count: files.length,
    total_size: totalSize,
    dependency_graph: {},
    framework_details: {
      framework: manifest.framework,
      language: manifest.language
    }
  };

  const index = {
    files,
    modules: manifest.modules,
    routes: manifest.routes
  };

  const outputFile = outputPath ?? path.join(projectRoot, `${manifest.name}.on`);
  await writeOnArchive(outputFile, {
    manifest,
    metadata,
    checksums,
    index,
    files: snapshotFiles
  });

  return outputFile;
}
