# JULION Architecture

## Overview

JULION is built as a monorepo with multiple packages for CLI, core format, engines, adapters, and cloud integration.

## Core packages

- `packages/cli` - CLI commands and command dispatch
- `packages/core` - manifest definitions, `.on` container abstraction, integrity validation
- `packages/engine/snapshot` - snapshot analyzer and builder
- `packages/engine/restore` - safe extraction and rebuild logic
- `packages/engine/sync` - diff and sync planner
- `packages/adapters` - framework-specific detection and restore drivers
- `packages/cloud/google-drive` - Google Drive auth and storage adapter
- `packages/shared` - filesystem helpers, logging, config utilities

## `.on` snapshot format

A JULION snapshot is a structured container with:

- `manifest.json`
- `metadata.json`
- `checksums.json`
- `index.json`
- `snapshot/`
- `modules/`
- `routes/`
- `preview/`
- `dependencies/`

The format is designed for partial extraction, integrity validation, and future layering.

## Development path

1. CLI and snapshot engine
2. Restore engine and cloud upload/download
3. Sync engine and framework adapters
4. Web viewer and sharing
5. AI analysis and marketplace
