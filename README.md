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

4. Restore a snapshot:

```bash
node packages/cli/dist/index.js restore my-project.on ./restore-target --force
```

5. Authenticate with Google Drive:

```bash
node packages/cli/dist/index.js auth google
```

Google Drive credentials can be provided via environment variables:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_REDIRECT_URI="your-redirect-uri"
```

or saved in `~/.julion/google-client.json`.

6. Push a snapshot to Google Drive:

```bash
node packages/cli/dist/index.js push my-project.on my-repo
```

7. Pull a snapshot from Google Drive:

```bash
node packages/cli/dist/index.js pull my-repo my-project.on -o downloaded.on
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
