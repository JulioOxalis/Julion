export interface JulionManifest {
    name: string;
    framework: string;
    language: string;
    framework_version: string;
    runtime_version?: string;
    dependencies: Record<string, unknown>;
    modules: string[];
    routes: string[];
    created_at: string;
    julion_version: string;
    adapter: string;
    ignore?: string[];
}
export interface JulionMetadata {
    project_root: string;
    file_count: number;
    total_size: number;
    dependency_graph: Record<string, unknown>;
    framework_details: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map