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
node packages/cli/dist/index.js seal --out my-project.on
```

4. Restore a snapshot:

```bash
node packages/cli/dist/index.js unseal my-project.on ./restore-target --force
```

5. Configure environment variables (copy `.env.example` to `.env`):

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (site root, e.g. `https://julion.julio.co.tz`)
- `JULION_SITE_URL` and `JULION_WEBSITE_AUTH_URL`
- MySQL: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`

In Google Cloud Console, add this authorized redirect URI:

`https://your-domain/auth/google/callback`

6. Start the Julion website (login + dashboard):

```bash
npm run build
npm run web
```

7. Authenticate from VS Code / CLI via the website:

```bash
node packages/cli/dist/index.js connect google --website
```

The CLI opens your browser, you sign in with Google, and the token is stored in MySQL for the CLI to use.

8. Deposit a snapshot to Google Drive:

```bash
node packages/cli/dist/index.js deposit my-project.on my-repo
```

9. Fetch a snapshot from Google Drive:

```bash
node packages/cli/dist/index.js fetch my-repo my-project.on -o downloaded.on
```

## Workspace layout

- `packages/cli` - CLI entrypoint and command definitions
- `packages/core` - manifest models, format spec, validation
- `packages/engine` - snapshot, restore, sync engines
- `packages/adapters` - framework drivers and detection
- `packages/cloud` - Google Drive integration
- `packages/shared` - shared utilities and helpers

## Next steps

- implement `julion begin`
- implement `julion seal`
- implement `.on` format serialization
- implement Google Drive auth and upload
