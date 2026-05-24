export function analyzeProject(root) {
    return {
        name: 'unknown',
        framework: 'unknown',
        language: 'unknown',
        framework_version: '0.0',
        dependencies: {},
        modules: [],
        routes: [],
        created_at: new Date().toISOString(),
        julion_version: '0.1.0',
        adapter: 'generic',
        ignore: [
            'vendor/',
            'node_modules/',
            '.git/',
            '.env',
            'storage/logs/',
            'cache/',
            'tmp/',
            'dist/',
            'build/'
        ]
    };
}
//# sourceMappingURL=index.js.map