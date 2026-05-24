export * from './env';
export * from './auth-store';
export * from './google-config';

export function sanitizeIgnoreList(files: string[]) {
  const defaults = [
    'vendor/',
    'node_modules/',
    '.git/',
    '.env',
    'storage/logs/',
    'cache/',
    'tmp/',
    'dist/',
    'build/'
  ];
  return Array.from(new Set([...defaults, ...files]));
}
