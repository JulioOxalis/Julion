import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { JulionManifest, JulionMetadata, writeOnArchive } from 'julion-core';

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

async function gatherFiles(root: string, ignore: string[]): Promise<string[]> {
  const files: string[] = [];
  await walkDirectory(root, '.', ignore, files);
  return files;
}

function detectFramework(projectRoot: string, packageData: any, composerData: any) {
  if (composerData && composerData.require && composerData.require['laravel/framework']) {
    return 'laravel';
  }

  if (packageData) {
    if (packageData.dependencies?.react || packageData.devDependencies?.react) {
      return 'react';
    }
    if (packageData.dependencies?.vue || packageData.devDependencies?.vue) {
      return 'vue';
    }
    if (packageData.dependencies?.next || packageData.devDependencies?.next) {
      return 'next';
    }
    if (packageData.dependencies?.express || packageData.devDependencies?.express) {
      return 'express';
    }
    if (packageData.dependencies?.['@nestjs'] || packageData.devDependencies?.['@nestjs']) {
      return 'node';
    }
  }

  return 'generic';
}

async function loadJson(filePath: string) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

export async function analyzeProject(root: string): Promise<JulionManifest> {
  const packageJson = await loadJson(path.join(root, 'package.json'));
  const composerJson = await loadJson(path.join(root, 'composer.json'));
  const name = packageJson?.name || composerJson?.name || path.basename(root);
  const framework = detectFramework(root, packageJson, composerJson);
  const dependencies: Record<string, unknown> = {};

  if (packageJson) {
    dependencies.npm = {
      dependencies: packageJson.dependencies ?? {},
      devDependencies: packageJson.devDependencies ?? {}
    };
  }

  if (composerJson) {
    dependencies.composer = {
      require: composerJson.require ?? {},
      requireDev: composerJson['require-dev'] ?? {}
    };
  }

  return {
    name,
    framework,
    language: composerJson ? 'php' : 'javascript',
    framework_version: composerJson?.require?.['laravel/framework'] || packageJson?.dependencies?.react || 'unknown',
    runtime_version: composerJson?.require?.php || packageJson?.engines?.node || 'unknown',
    dependencies,
    modules: [],
    routes: [],
    created_at: new Date().toISOString(),
    julion_version: '0.1.0',
    adapter: framework,
    ignore: DEFAULT_IGNORE
  };
}

export async function buildSnapshot(projectRoot: string, outputPath?: string, adapterName?: string) {
  const manifest = await analyzeProject(projectRoot);
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

  const metadata: JulionMetadata = {
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
