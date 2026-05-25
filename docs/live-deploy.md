# Julion live deployment checklist

## What runs where

| Piece | Where it runs |
|-------|----------------|
| `julion auth google --website` | User's PC (VS Code terminal) |
| `julion save --push` | User's PC |
| Website `https://julion.julio.co.tz` | Your server |
| MySQL `julion` database | Your server (same host as website) |
| Google OAuth | Google Cloud + your domain |

Users **do not** run `npm run web` on their own machines for production. They only run Julion CLI commands locally. Your server hosts the login website.

## Enabled in code

- Google login on `/auth/google`
- OAuth callback `/auth/google/callback`
- Dashboard `/dashboard` and logout
- CLI polls `https://julion.julio.co.tz/api/auth/session/{id}` after browser login
- Per-user Google Drive tokens in MySQL

## Server setup (julion.julio.co.tz)

1. Upload project (SFTP to `public_html` or deploy via git).
2. On the server, create `.env` with production values (copy from `.env.example`).
3. Set `DB_*` to the **hosting MySQL** credentials (not `127.0.0.1` unless MySQL is on the same box).
4. Install Node.js 18+ on the host.
5. Run:

```bash
npm install
npm run build
npm run web
```

6. Keep the process running (PM2, systemd, or hosting panel Node app).
7. Point the domain to the Node port (reverse proxy / `.htaccess` proxy if needed).

## Google Cloud Console

Authorized redirect URI (exact):

```text
https://julion.julio.co.tz/auth/google/callback
```

## User `.env` on their PC

Users only need Google-related vars if using direct CLI auth. For website login they need:

```env
JULION_SITE_URL=https://julion.julio.co.tz
JULION_WEBSITE_AUTH_URL=https://julion.julio.co.tz/auth/google
```

They **do not** need your server MySQL credentials on their laptop.

## User commands

```bash
npm run build
node packages/cli/dist/index.js connect google --website
node packages/cli/dist/index.js seal --ultra --deposit --repository my-repo
```

## SFTP note

Uploading files alone does **not** start the website. After upload you must run `npm install`, `npm run build`, and start `npm run web` on the server (or use a host that runs Node automatically).
