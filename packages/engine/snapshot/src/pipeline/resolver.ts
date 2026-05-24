import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';

export interface DependencyEntry {
  name: string;
  version: string;
  source?: string;
}

export interface DependencyGraph {
  manifests: Record<string, any>;
  dependencies: DependencyEntry[];
  lockFiles: Record<string, { path: string; hash: string }>; 
}

async function loadJson(filePath: string) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

async function loadText(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeDependency(name: string, version: string) {
  return { name, version };
}

export async function resolveDependencies(root: string) {
  const manifests: Record<string, any> = {};
  const dependencies: DependencyEntry[] = [];
  const lockFiles: Record<string, { path: string; hash: string }> = {};

  const packageJson = await loadJson(path.join(root, 'package.json'));
  if (packageJson) {
    manifests.packageJson = packageJson;
    for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) {
      dependencies.push({ ...normalizeDependency(name, String(version)), source: 'npm' });
    }
    for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
      dependencies.push({ ...normalizeDependency(name, String(version)), source: 'npm-dev' });
    }
  }

  const composerJson = await loadJson(path.join(root, 'composer.json'));
  if (composerJson) {
    manifests.composerJson = composerJson;
    for (const [name, version] of Object.entries(composerJson.require ?? {})) {
      dependencies.push({ ...normalizeDependency(name, String(version)), source: 'composer' });
    }
    for (const [name, version] of Object.entries(composerJson['require-dev'] ?? {})) {
      dependencies.push({ ...normalizeDependency(name, String(version)), source: 'composer-dev' });
    }
  }

  const requirementsTxt = await loadText(path.join(root, 'requirements.txt'));
  if (requirementsTxt) {
    manifests.requirementsTxt = requirementsTxt;
    for (const line of requirementsTxt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const [name, version] = trimmed.split(/>=|==|~=|<=|=/).map((part) => part.trim());
      dependencies.push({ ...normalizeDependency(name, version || 'latest'), source: 'pip' });
    }
  }

  const lockFileNames = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'composer.lock',
    'poetry.lock',
    'Pipfile.lock'
  ];

  for (const lockFile of lockFileNames) {
    const lockPath = path.join(root, lockFile);
    const content = await loadText(lockPath);
    if (content) {
      const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      lockFiles[lockFile] = { path: lockPath, hash };
    }
  }

  return {
    manifests,
    dependencies,
    lockFiles
  } as DependencyGraph;
}
