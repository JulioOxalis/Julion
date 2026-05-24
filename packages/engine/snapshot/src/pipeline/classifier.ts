import path from 'path';

export type FileCategory =
  | 'source_code'
  | 'config'
  | 'dependencies_manifest'
  | 'assets'
  | 'build_output'
  | 'cache'
  | 'logs'
  | 'environment_sensitive'
  | 'system_files'
  | 'other';

export interface ClassifiedFile {
  relativePath: string;
  absolutePath: string;
  category: FileCategory;
  excluded: boolean;
  reason?: string;
}

const sourceExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.php', '.py', '.java', '.cs', '.go', '.rb', '.rs']);
const configExtensions = new Set(['.json', '.yaml', '.yml', '.xml', '.ini', '.toml', '.env', '.env.example', '.gitignore']);
const assetExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.mp4', '.mov', '.avi', '.mp3', '.woff', '.woff2', '.ttf', '.otf']);
const compressedExtensions = new Set(['.zip', '.gz', '.mp4', '.mov', '.avi', '.webp', '.png', '.jpg', '.jpeg', '.mp3']);

function ext(filePath: string) {
  return path.extname(filePath).toLowerCase();
}

function matchesPath(filePath: string, pattern: string) {
  const normalized = filePath.replace(/\\/g, '/');
  if (pattern.endsWith('/')) {
    return normalized.startsWith(pattern);
  }
  return normalized === pattern || normalized.endsWith(pattern);
}

function isEnvironmentSensitive(filePath: string) {
  return filePath.startsWith('.env') || /secret|credential|token|key/i.test(filePath);
}

function isDependencyManifest(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  return ['composer.json', 'package.json', 'requirements.txt', 'package-lock.json', 'yarn.lock', 'composer.lock', 'poetry.lock', 'Pipfile'].includes(name);
}

export function classifyFiles(root: string, files: string[]) {
  const classified: ClassifiedFile[] = [];

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    const extension = ext(normalized);
    let category: FileCategory = 'other';
    let excluded = false;
    let reason: string | undefined;

    if (isEnvironmentSensitive(normalized)) {
      category = 'environment_sensitive';
      excluded = true;
      reason = 'Sensitive environment file';
    } else if (matchesPath(normalized, '.git/')) {
      category = 'system_files';
      excluded = true;
      reason = 'Git metadata';
    } else if (matchesPath(normalized, 'vendor/') || matchesPath(normalized, 'node_modules/')) {
      category = 'dependencies_manifest';
      excluded = true;
      reason = 'Dependency folder excluded';
    } else if (matchesPath(normalized, 'storage/logs/') || normalized.endsWith('.log')) {
      category = 'logs';
      excluded = true;
      reason = 'Log file excluded';
    } else if (matchesPath(normalized, 'cache/') || matchesPath(normalized, '.next/') || matchesPath(normalized, 'dist/') || matchesPath(normalized, 'build/')) {
      category = 'cache';
      excluded = true;
      reason = 'Build/cache output excluded';
    } else if (isDependencyManifest(normalized)) {
      category = 'dependencies_manifest';
    } else if (sourceExtensions.has(extension)) {
      category = 'source_code';
    } else if (configExtensions.has(extension) || normalized.includes('/config/')) {
      category = 'config';
    } else if (assetExtensions.has(extension) || normalized.includes('/assets/') || normalized.includes('/public/')) {
      category = 'assets';
    }

    classified.push({
      relativePath: normalized,
      absolutePath: path.join(root, normalized),
      category,
      excluded,
      reason
    });
  }

  return classified;
}

export function createClassificationStats(files: ClassifiedFile[]) {
  const stats = new Map<FileCategory, number>();
  for (const file of files) {
    stats.set(file.category, (stats.get(file.category) ?? 0) + 1);
  }
  return Object.fromEntries(stats.entries());
}

export function shouldStoreFile(file: ClassifiedFile) {
  return !file.excluded;
}
