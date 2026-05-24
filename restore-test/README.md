# JULION

JULION is a developer-native portable project snapshot ecosystem for building, saving, syncing, and restoring projects using the `.on` snapshot format.

## Goals

- CLI-first snapshot workflow
- Intelligent portable `.on` containers
- Google Drive cloud integration
- Framework-aware adapters
- Snapshot, restore, and sync engines

## Getting started

1. Install dependencies:

```bash
npm run bootstrap
```

2. Build the workspace:

```bash
npm run build
```

3. Create a snapshot from the current project root:

```bash
node packages/cli/dist/index.js save --out my-project.on
```

## Workspace layout

- `packages/cli` - CLI entrypoint and command definitions
- `packages/core` - manifest models, format spec, validation
- `packages/engine` - snapshot, restore, sync engines
- `packages/adapters` - framework drivers and detection
- `packages/cloud` - Google Drive integration
- `packages/shared` - shared utilities and helpers

## Next steps

- implement `julion init`
- implement `julion save`
- implement `.on` format serialization
- implement Google Drive auth and upload
