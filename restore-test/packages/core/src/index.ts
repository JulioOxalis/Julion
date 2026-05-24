export * from './types';
export * from './container';

export function loadManifest(path: string) {
  return {
    name: 'demo',
    framework: 'unknown',
    framework_version: '0.0',
  };
}
