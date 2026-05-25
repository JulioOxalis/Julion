# Julion Web v2 — Serverless + MongoDB Atlas

Static frontend + serverless API functions, deployable to Vercel, Netlify, or Cloudflare Pages.

## Architecture

```
packages/web-v2/
├── public/            Static files served at the root URL
│   ├── index.html     Landing page (light theme)
│   ├── pages/         Dashboard pages (loaded via vercel.json rewrites)
│   ├── js/            Client-side ES modules (fetch-based, no framework)
│   ├── styles.css     Shared CSS (dark dashboard + light landing)
│   └── images/        Logo, favicons, OG image (see SETUP.md)
├── api/               Vercel serverless functions
│   ├── auth/          google.js · callback.js · logout.js · me.js · session/[id].js
│   ├── repositories/  index.js
│   ├── files/         content.js · save.js
│   ├── snapshots.js
│   └── status.js
├── db/
│   └── client.js      MongoDB Atlas singleton
├── lib/
│   ├── auth.js        JWT cookie helpers
│   ├── drive.js       Google Drive helpers
│   └── archive.js     .on file read/write
├── tools/             Dev-only scripts (NOT deployed)
│   ├── seed.js        Create collections + indexes
│   └── admin.js       List/purge users & sessions
├── vercel.json
├── .env.example
└── package.json
```

## Setup

### 1. MongoDB Atlas

1. Create a free cluster at https://cloud.mongodb.com  
2. Network Access → Add IP Address → **0.0.0.0/0** (required for serverless deployments)  
3. Database Access → create a user with **read/write** privileges  
4. Connect → Drivers → copy the `mongodb+srv://...` connection string

### 2. Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client  
2. Authorized redirect URI: `https://your-app.vercel.app/api/auth/callback`  
3. Copy Client ID and Client Secret

### 3. Environment variables

```bash
cp .env.example .env
# Fill in MONGODB_URI, DB_NAME, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# GOOGLE_REDIRECT_URI, JWT_SECRET
```

Generate `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 4. Install dependencies

```bash
npm install
```

### 5. Initialise the database (run once)

```bash
npm run seed
```

### 6. Local development

```bash
npm run dev        # starts vercel dev (serves static + API)
```

## Deploying to Vercel

```bash
# Install Vercel CLI once
npm install -g vercel

# Link and deploy
vercel

# Set production environment variables in Vercel dashboard or CLI
vercel env add MONGODB_URI
vercel env add DB_NAME
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REDIRECT_URI
vercel env add JWT_SECRET

# Deploy to production
npm run deploy
```

In the Vercel dashboard, set **Root Directory** to `packages/web-v2`.

## API reference

| Method | Path                          | Auth     | Description                          |
|--------|-------------------------------|----------|--------------------------------------|
| GET    | /api/auth/google              | —        | Start Google OAuth flow              |
| GET    | /api/auth/callback            | —        | OAuth callback, sets JWT cookie      |
| POST   | /api/auth/logout              | cookie   | Clear session                        |
| GET    | /api/auth/me                  | cookie   | Return current user                  |
| GET    | /api/auth/session/:id         | —        | CLI polls for auth completion        |
| GET    | /api/repositories             | cookie   | List Drive repositories              |
| GET    | /api/snapshots?repo=name      | cookie   | List snapshots in a repository       |
| GET    | /api/files/content?…          | cookie   | Read a file from a .on snapshot      |
| POST   | /api/files/save               | cookie   | Write a file back to Drive           |
| GET    | /api/status                   | —        | Health check + DB ping               |

All APIs return `{ success, data, error }`.

## Local admin tools

```bash
npm run admin -- list-users
npm run admin -- list-sessions
npm run admin -- purge-sessions
npm run admin -- delete-user user@example.com
npm run admin -- stats
```

## Images

See `public/images/SETUP.md` for the full list of required image assets.
