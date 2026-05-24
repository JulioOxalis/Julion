import { JulionManifest } from 'julion-core';

export interface AdapterReport {
  detected: boolean;
  framework: string;
  details: Record<string, unknown>;
}

export interface AdapterModule {
  adapterName: string;
  detectProject(root: string): Promise<boolean>;
  inspectProject?(root: string): Promise<AdapterReport>;
  buildSnapshot?(manifest: JulionManifest): Promise<JulionManifest>;
  restoreSnapshot?(archivePath: string, targetPath: string): Promise<{ snapshotName: string }>;
}

export interface AdapterEntry {
  name: string;
  module: AdapterModule;
  path: string;
}
