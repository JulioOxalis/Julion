import { JulionManifest } from 'julion-core';
export interface AdapterReport {
    detected: boolean;
    framework: string;
    details: Record<string, unknown>;
}
export declare function detectProject(root: string): AdapterReport;
export declare function buildSnapshot(manifest: JulionManifest): any;
//# sourceMappingURL=index.d.ts.map