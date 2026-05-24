export function detectProject(root) {
    return {
        detected: false,
        framework: 'generic',
        details: {
            root
        }
    };
}
export function buildSnapshot(manifest) {
    return {
        ...manifest,
        snapshot_type: 'generic'
    };
}
//# sourceMappingURL=index.js.map