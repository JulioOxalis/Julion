import { JulionManifest } from 'julion-core';

export const adapterName = 'generic';

export interface AdapterReport {
  detected: boolean;
  framework: string;
  details: Record<string, unknown>;
}

export async function detectProject(root: string): Promise<boolean> {
  return false;
}

export async function inspectProject(root: string): Promise<AdapterReport> {
  return {
    detected: false,
    framework: 'generic',
    details: {
      root
    }
  };
}

export async function buildSnapshot(manifest: JulionManifest) {
  return {
    ...manifest,
    snapshot_type: 'generic'
  };
}
