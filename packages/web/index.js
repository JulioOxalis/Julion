const crypto    = require('crypto');
const express   = require('express');
const path      = require('path');
const os        = require('os');
const { createReadStream, createWriteStream, promises: fsPromises } = require('fs');
const { gzip, gunzip } = require('zlib');
const { promisify }    = require('util');
const session          = require('express-session');
const { google }       = require('googleapis');
const { buildHead, buildSitemap, buildRobots, SITE, esc } = require('./seo');
const {
  loadMergedEnv,
  loadGoogleClientConfig,
  GOOGLE_DRIVE_SCOPES,
  resolvePublicBaseUrl,
  createAuthSession,
  completeAuthSession,
  claimAuthSession,
  getAuthSessionStatus,
  upsertUser,
  saveUserDriveToken,
  deleteUserDriveToken,
  loadUserDriveToken,
  getDbConnection
} = require('julion-shared');

// Compression — graceful fallback if package not yet installed
let compression = null;
try { compression = require('compression'); } catch { /* run npm install */ }

const app  = express();
const port = Number(process.env.PORT || 3000);

// ─── Cached async state ───────────────────────────────────────────────────────
let cachedEnv     = null;
let siteBaseUrl   = '';

async function getEnv() {
  if (!cachedEnv) cachedEnv = await loadMergedEnv(path.join(__dirname, '..', '..'));
  return cachedEnv;
}

async function ensureBaseUrl() {
  if (!siteBaseUrl) siteBaseUrl = resolvePublicBaseUrl(await getEnv());
  return siteBaseUrl;
}

// ─── Archive read/write (inlined — core has no dist) ─────────────────────────
const gzipAsync   = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const ON_SIGNATURE = 'JULION_ON\n';

async function readOnArchive(archivePath) {
  const raw = await fsPromises.readFile(archivePath);
  const sig = raw.slice(0, ON_SIGNATURE.length).toString('utf8');
  if (sig !== ON_SIGNATURE) throw new Error('Invalid .on archive signature');
  const payload = await gunzipAsync(raw.slice(ON_SIGNATURE.length));
  return JSON.parse(payload.toString('utf8'));
}

async function writeOnArchive(archive, outputPath) {
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(archive), 'utf8'), { level: 9 });
  await fsPromises.writeFile(outputPath, Buffer.concat([Buffer.from(ON_SIGNATURE, 'utf8'), compressed]));
}

// ─── Misc utilities ───────────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session?.user?.email) return res.redirect('/auth/google');
  return next();
}

function escapeQueryValue(v) {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isValidName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 128 && !/[<>"{}|\\^`]/.test(name);
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function detectLanguage(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ({
    ts:'typescript', tsx:'typescript',
    js:'javascript', jsx:'javascript', mjs:'javascript', cjs:'javascript',
    py:'python',     pyw:'python',
    json:'json',     jsonc:'json',
    css:'css',       scss:'scss',    less:'less',
    html:'html',     htm:'html',
    md:'markdown',   mdx:'markdown',
    go:'go',         rs:'rust',      php:'php',
    java:'java',     kt:'kotlin',    swift:'swift',
    c:'c',           cpp:'cpp',      h:'c',          hpp:'cpp',
    sh:'shell',      bash:'shell',   zsh:'shell',
    yaml:'yaml',     yml:'yaml',
    toml:'ini',      ini:'ini',      env:'ini',
    xml:'xml',       svg:'xml',      graphql:'graphql',
    sql:'sql',       tf:'hcl',       dockerfile:'dockerfile'
  })[ext] || 'plaintext';
}

function isBinaryExtension(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ['png','jpg','jpeg','gif','ico','webp','bmp','pdf','zip','tar','gz','7z','rar',
          'exe','dll','so','dylib','class','jar','wasm','mp3','mp4','wav','ogg'].includes(ext);
}

// ─── HTML layouts ─────────────────────────────────────────────────────────────

function publicLayout({ title, description, path: urlPath = '/', robots = 'index, follow, max-image-preview:large', keywords, landing = false } = {}, body) {
  const head = buildHead({ baseUrl: siteBaseUrl, title, description, path: urlPath, robots, keywords });
  if (landing) {
    return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body class="lp-body">${body}</body>
</html>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body>
  <div class="app-shell">${body}</div>
</body>
</html>`;
}

function dashboardLayout({ title, description, path: urlPath = '/dashboard', robots = 'noindex, nofollow' } = {}, user, active, content) {
  const head = buildHead({ baseUrl: siteBaseUrl, title, description, path: urlPath, robots });

  const avatar = user.picture
    ? `<img class="avatar avatar-sm" src="${esc(user.picture)}" alt="${esc(user.name || '')}" loading="lazy"/>`
    : `<div class="avatar avatar-sm avatar-fallback" aria-hidden="true">${(user.name || user.email)[0].toUpperCase()}</div>`;

  function navLink(href, label, id) {
    const isActive = active === id;
    return `<a href="${href}" class="nav-link${isActive ? ' nav-link-active' : ''}" aria-current="${isActive ? 'page' : 'false'}">${label}</a>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body class="dashboard-body">
  <div class="dashboard-layout">
    <nav class="sidebar" aria-label="Main navigation">
      <div class="sidebar-logo" aria-label="Julion">JULION</div>
      <div class="nav-links" role="list">
        ${navLink('/dashboard',    'Overview',      'dashboard')}
        ${navLink('/repositories', 'Repositories',  'repositories')}
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          ${avatar}
          <div class="sidebar-user-info">
            <span class="sidebar-user-name">${esc(user.name || user.email)}</span>
            <span class="sidebar-user-email">${esc(user.email)}</span>
          </div>
        </div>
        <form method="post" action="/logout">
          <button class="logout-btn" type="submit">Log out</button>
        </form>
      </div>
    </nav>
    <main class="main-panel" id="main-content">${content}</main>
  </div>
</body>
</html>`;
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function getDriveForUser(email, projectRoot) {
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig(projectRoot);
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const token = await loadUserDriveToken(email, projectRoot);
  if (!token?.access_token && !token?.refresh_token) throw new Error('no_token');
  auth.setCredentials(token);
  auth.on('tokens', async (refreshed) => {
    const merged = Object.assign({}, token, refreshed);
    await saveUserDriveToken(email, merged, projectRoot).catch(() => {});
  });
  return google.drive({ version: 'v3', auth });
}

async function getJulionRoot(drive) {
  const res = await drive.files.list({
    q:      "name='JULION' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false",
    fields: 'files(id,name)',
    spaces: 'drive'
  });
  return res.data.files?.[0] || null;
}

async function listRepositories(drive) {
  const root = await getJulionRoot(drive);
  if (!root) return [];
  const res = await drive.files.list({
    q:        `'${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields:   'files(id,name,modifiedTime)',
    spaces:   'drive',
    orderBy:  'modifiedTime desc'
  });
  return res.data.files || [];
}

async function listSnapshots(drive, repoName) {
  const root = await getJulionRoot(drive);
  if (!root) return [];
  const repoRes = await drive.files.list({
    q:      `name='${escapeQueryValue(repoName)}' and '${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive'
  });
  const repoFolder = repoRes.data.files?.[0];
  if (!repoFolder) return [];
  const filesRes = await drive.files.list({
    q:       `'${repoFolder.id}' in parents and trashed=false`,
    fields:  'files(id,name,size,modifiedTime)',
    spaces:  'drive',
    orderBy: 'modifiedTime desc'
  });
  return filesRes.data.files || [];
}

async function downloadAndReadSnapshot(drive, repoName, snapshotName) {
  const files = await listSnapshots(drive, repoName);
  const file  = files.find(f => f.name === snapshotName);
  if (!file) throw new Error(`Snapshot "${snapshotName}" not found in "${repoName}"`);
  const tmpPath = path.join(os.tmpdir(), `julion-view-${Date.now()}.on`);
  const dest    = createWriteStream(tmpPath);
  const stream  = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    stream.data.on('end', resolve).on('error', reject).pipe(dest);
  });
  try {
    const archive = await readOnArchive(tmpPath);
    return { archive, file };
  } finally {
    await fsPromises.unlink(tmpPath).catch(() => {});
  }
}

// ─── Middleware stack ─────────────────────────────────────────────────────────

// 1. Gzip/Brotli compression
if (compression) app.use(compression());

// 2. HTTPS enforcement (production behind reverse proxy)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// 3. Trailing-slash canonical redirect (GET only, skip root)
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/')) {
    const clean = req.path.slice(0, -1) + (req.url.slice(req.path.length) || '');
    return res.redirect(301, clean);
  }
  next();
});

// 4. Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'SAMEORIGIN');
  res.setHeader('X-XSS-Protection',          '1; mode=block');
  res.setHeader('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// 5. Ensure baseUrl is resolved before any route runs
app.use(async (req, res, next) => {
  await ensureBaseUrl().catch(() => {});
  next();
});

// 6. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 7. Static files (aggressive cache in production)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge:       process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag:         true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // OG + logo images: 1-day cache so updates propagate quickly to social crawlers
    if (/\/(julion-og|julion-logo)\.(png|jpg|jpeg|webp)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return;
    }
    // Favicon variants: 1 week
    if (/\.(ico|png)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return;
    }
    // Styles, scripts: 1 day (no content hashing, so not immutable)
    if (/\.(css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// 8. Session
app.use(session({
  secret:            process.env.SESSION_SECRET || 'julion-change-this-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ─── SEO routes (before any catch-alls) ──────────────────────────────────────

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(buildRobots(siteBaseUrl));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(buildSitemap(siteBaseUrl));
});

// ─── Public home ──────────────────────────────────────────────────────────────

app.get('/', async (req, res) => {
  if (req.session?.user?.email) return res.redirect('/dashboard');
  const year = new Date().getFullYear();
  res.send(publicLayout(
    {
      title:       'Seal, Store & Restore Your Projects',
      description: 'Julion lets you snapshot your entire project into a portable .on container, store it on Google Drive, and restore it anywhere with one command.',
      path:        '/',
      keywords:    'Julion, project snapshot, developer CLI, Google Drive backup, seal restore, portable code',
      landing:     true
    },
    `
<!-- ── Navbar ── -->
<nav class="lp-nav" role="navigation" aria-label="Main">
  <a class="lp-nav-brand" href="/">JULION</a>
  <ul class="lp-nav-links" role="list">
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="https://github.com/JulioOxalis/julion" rel="noopener">GitHub</a></li>
  </ul>
  <a class="lp-nav-cta" href="/auth/google">Sign in</a>
</nav>

<!-- ── Hero ── -->
<section class="lp-hero" id="hero" aria-labelledby="hero-heading">
  <div class="lp-eyebrow">Developer-native snapshot platform</div>
  <h1 class="lp-headline" id="hero-heading">
    Seal, Store &amp; Restore<br><span>Any Project. Anywhere.</span>
  </h1>
  <p class="lp-sub">Compress your entire codebase into a portable <strong>.on</strong> container, push it to Google Drive, and restore it on any machine with a single command.</p>
  <a class="lp-hero-cta" href="/auth/google" aria-label="Get started with Julion">
    Get started free
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>
</section>

<!-- ── Flow diagram ── -->
<section class="lp-diagram" id="how-it-works" aria-label="How Julion works">
  <svg class="lp-diagram-svg" viewBox="0 0 880 240" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flow: Your Project seals into .on, then restores Anywhere">

    <!-- Left column: inputs -->
    <g>
      <rect x="0" y="40"  width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="80" y="63" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">Node.js project</text>

      <rect x="0" y="96"  width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="80" y="119" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">Python app</text>

      <rect x="0" y="152" width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="80" y="175" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">Any codebase</text>

      <text x="80" y="22" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="600" fill="#999" letter-spacing="2">YOUR PROJECT</text>
    </g>

    <!-- Curved lines from left → center -->
    <path d="M160 58 C260 58, 280 120, 360 120"  stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>
    <path d="M160 114 C240 114, 280 120, 360 120" stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>
    <path d="M160 170 C260 170, 280 120, 360 120" stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>

    <!-- Center box -->
    <rect x="360" y="88" width="160" height="64" rx="16" fill="#6b7bff"/>
    <text x="440" y="117" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="17" font-weight="800" fill="#fff">.on</text>
    <text x="440" y="137" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="10" fill="rgba(255,255,255,0.72)" letter-spacing="1">Seals · Stores · Restores</text>

    <!-- Curved lines center → right -->
    <path d="M520 120 C600 120, 620 58, 720 58"  stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>
    <path d="M520 120 C600 120, 620 114, 720 114" stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>
    <path d="M520 120 C600 120, 620 170, 720 170" stroke="#6b7bff" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>

    <!-- Right column: outputs -->
    <g>
      <rect x="720" y="40"  width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="800" y="63" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">Your laptop</text>

      <rect x="720" y="96"  width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="800" y="119" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">Team server</text>

      <rect x="720" y="152" width="160" height="36" rx="18" fill="#fff" stroke="#e0e0e8" stroke-width="1.5"/>
      <text x="800" y="175" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#333">CI / cloud VM</text>

      <text x="800" y="22" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="600" fill="#999" letter-spacing="2">ANYWHERE</text>
    </g>
  </svg>
</section>

<!-- ── Feature cards ── -->
<section class="lp-features" id="features" aria-labelledby="features-heading">
  <h2 class="lp-features-heading" id="features-heading">Everything you need, nothing you don't</h2>
  <div class="lp-cards">
    <div class="lp-card">
      <div class="lp-card-icon" aria-hidden="true">&#x1F4E6;</div>
      <h3 class="lp-card-title">julion seal</h3>
      <p class="lp-card-desc">Compress your entire project — files, metadata, checksums — into a single portable <code>.on</code> container in seconds.</p>
      <span class="lp-card-arrow">&#x2192; Snapshot in one command</span>
    </div>
    <div class="lp-card">
      <div class="lp-card-icon" aria-hidden="true">&#x2601;&#xFE0F;</div>
      <h3 class="lp-card-title">julion deposit</h3>
      <p class="lp-card-desc">Push your snapshot to Google Drive automatically. Organised under your JULION folder by repository and version.</p>
      <span class="lp-card-arrow">&#x2192; Backed up to Drive</span>
    </div>
    <div class="lp-card">
      <div class="lp-card-icon" aria-hidden="true">&#x1F504;</div>
      <h3 class="lp-card-title">julion unseal</h3>
      <p class="lp-card-desc">Restore any snapshot to any directory on any machine. Full file tree, exact checksums, zero dependencies beyond the CLI.</p>
      <span class="lp-card-arrow">&#x2192; Restore anywhere</span>
    </div>
  </div>
</section>

<!-- ── Footer ── -->
<footer class="lp-footer" role="contentinfo">
  <span>Julion &copy; ${year}</span>
  <div class="lp-footer-links">
    <a href="/sitemap.xml">Sitemap</a>
    <a href="/robots.txt">Robots</a>
    <a href="https://github.com/JulioOxalis/julion" rel="noopener">GitHub</a>
  </div>
</footer>
    `
  ));
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/dashboard', requireLogin, async (req, res) => {
  const user        = req.session.user;
  const projectRoot = path.join(__dirname, '..', '..');
  let driveConnected = false;
  let repoCount      = 0;

  try {
    const drive = await getDriveForUser(user.email, projectRoot);
    driveConnected = true;
    repoCount = (await listRepositories(drive)).length;
  } catch { /* token missing or Drive unreachable */ }

  const avatarImg = user.picture
    ? `<img class="avatar" src="${esc(user.picture)}" alt="${esc(user.name || '')}" width="56" height="56" loading="lazy"/>`
    : `<div class="avatar avatar-fallback" aria-hidden="true">${(user.name || user.email)[0].toUpperCase()}</div>`;

  const driveSection = driveConnected
    ? `<p><span class="badge badge-green">Connected</span> Google Drive is linked.</p>
       <p class="stat-detail">You have <strong>${repoCount}</strong> ${repoCount === 1 ? 'repository' : 'repositories'} on Drive.
       <a class="inline-link" href="/repositories">View all</a></p>`
    : `<p><span class="badge">Not connected</span> Connect Google Drive to use deposit and fetch.</p>
       <div class="button-row"><a class="button" href="/auth/google">Connect Google Drive</a></div>`;

  res.send(dashboardLayout(
    { title: 'Overview', path: '/dashboard' },
    user, 'dashboard',
    `
    <div class="page-header">
      <h1 class="page-title">Overview</h1>
      <p class="page-subtitle">Welcome back, ${esc(user.name ? user.name.split(' ')[0] : user.email)}</p>
    </div>
    <div class="overview-grid">
      <div class="info-card info-card-highlight">
        <div class="profile-row">
          ${avatarImg}
          <div>
            <h2 style="font-size:1.1rem;font-weight:700;margin:0 0 4px">${esc(user.name || user.email)}</h2>
            <p class="status-text" style="margin:0;font-size:0.82rem">${esc(user.email)}</p>
          </div>
        </div>
      </div>
      <div class="info-card">
        <h3 class="card-label">Google Drive</h3>
        ${driveConnected
          ? `<p class="dash-stat-num">${repoCount}</p>
             <p class="stat-detail"><span class="badge badge-green">Connected</span>
             &nbsp;<a class="inline-link" href="/repositories">${repoCount === 1 ? '1 repository' : repoCount + ' repositories'} &rarr;</a></p>`
          : `<p><span class="badge">Not connected</span> Link your Drive to start depositing snapshots.</p>
             <div class="button-row"><a class="button" href="/auth/google">Connect Google Drive</a></div>`}
      </div>
      <div class="info-card">
        <h3 class="card-label">Quick commands</h3>
        <div class="dash-quick-cmd">
          <div class="dash-cmd-pill"><span class="dash-cmd-dot"></span>julion seal --ultra --deposit --repository my-repo</div>
          <div class="dash-cmd-pill"><span class="dash-cmd-dot"></span>julion fetch my-repo snapshot.on -o ./out</div>
        </div>
      </div>
    </div>
    `
  ));
});

// ─── Repositories list ────────────────────────────────────────────────────────

app.get('/repositories', requireLogin, async (req, res) => {
  const user        = req.session.user;
  const projectRoot = path.join(__dirname, '..', '..');

  let drive;
  try {
    drive = await getDriveForUser(user.email, projectRoot);
  } catch {
    return res.send(dashboardLayout(
      { title: 'Repositories', path: '/repositories' },
      user, 'repositories',
      `<div class="page-header"><h1 class="page-title">Repositories</h1></div>
       <div class="empty-state">
         <p>Google Drive is not connected.</p>
         <div class="button-row"><a class="button" href="/auth/google">Connect Google Drive</a></div>
       </div>`
    ));
  }

  let repos = [];
  try {
    repos = await listRepositories(drive);
  } catch (err) {
    return res.send(dashboardLayout(
      { title: 'Repositories', path: '/repositories' },
      user, 'repositories',
      `<div class="page-header"><h1 class="page-title">Repositories</h1></div>
       <div class="empty-state"><p>Failed to load repositories: ${esc(err.message)}</p></div>`
    ));
  }

  const counts = await Promise.all(
    repos.map(r => listSnapshots(drive, r.name).then(f => f.length).catch(() => 0))
  );

  const rows = repos.length === 0
    ? `<tr><td colspan="3" class="empty-cell">No repositories found. Run <code>julion seal --deposit</code> to create one.</td></tr>`
    : repos.map((r, i) => `
        <tr>
          <td><a class="table-link" href="/repositories/${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>
          <td>${counts[i]} ${counts[i] === 1 ? 'snapshot' : 'snapshots'}</td>
          <td>${formatDate(r.modifiedTime)}</td>
        </tr>`).join('');

  res.send(dashboardLayout(
    { title: 'Repositories', path: '/repositories' },
    user, 'repositories',
    `<div class="page-header">
       <h1 class="page-title">Repositories</h1>
       <p class="page-subtitle">All .on snapshot repositories on your Google Drive.</p>
     </div>
     <table class="data-table" aria-label="Repositories">
       <thead><tr><th scope="col">Name</th><th scope="col">Snapshots</th><th scope="col">Last modified</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`
  ));
});

// ─── Snapshots inside a repository ───────────────────────────────────────────

app.get('/repositories/:repo', requireLogin, async (req, res) => {
  const user        = req.session.user;
  const projectRoot = path.join(__dirname, '..', '..');
  const repoName    = req.params.repo;

  if (!isValidName(repoName)) return res.status(400).send('Invalid repository name.');

  let drive;
  try {
    drive = await getDriveForUser(user.email, projectRoot);
  } catch {
    return res.redirect('/repositories');
  }

  let snapshots = [];
  try {
    snapshots = await listSnapshots(drive, repoName);
  } catch (err) {
    return res.send(dashboardLayout(
      { title: esc(repoName), path: `/repositories/${encodeURIComponent(repoName)}` },
      user, 'repositories',
      `<a class="back-link" href="/repositories">← Repositories</a>
       <div class="page-header"><h1 class="page-title">${esc(repoName)}</h1></div>
       <div class="empty-state"><p>Failed to load snapshots: ${esc(err.message)}</p></div>`
    ));
  }

  const rows = snapshots.length === 0
    ? `<tr><td colspan="3" class="empty-cell">No snapshots in this repository.</td></tr>`
    : snapshots.map(f => `
        <tr>
          <td><a class="table-link" href="/repositories/${encodeURIComponent(repoName)}/${encodeURIComponent(f.name)}">${esc(f.name)}</a></td>
          <td>${formatBytes(f.size)}</td>
          <td>${formatDate(f.modifiedTime)}</td>
        </tr>`).join('');

  res.send(dashboardLayout(
    {
      title:       esc(repoName),
      description: `Snapshot repository ${repoName} on Julion — ${snapshots.length} snapshots stored on Google Drive.`,
      path:        `/repositories/${encodeURIComponent(repoName)}`
    },
    user, 'repositories',
    `<a class="back-link" href="/repositories">← Repositories</a>
     <div class="page-header">
       <h1 class="page-title">${esc(repoName)}</h1>
       <p class="page-subtitle">${snapshots.length} ${snapshots.length === 1 ? 'snapshot' : 'snapshots'}</p>
     </div>
     <table class="data-table" aria-label="Snapshots in ${esc(repoName)}">
       <thead><tr><th scope="col">Snapshot</th><th scope="col">Size</th><th scope="col">Uploaded</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`
  ));
});

// ─── Snapshot viewer + embedded Monaco editor ─────────────────────────────────

app.get('/repositories/:repo/:snapshot', requireLogin, async (req, res) => {
  const user         = req.session.user;
  const projectRoot  = path.join(__dirname, '..', '..');
  const repoName     = req.params.repo;
  const snapshotName = req.params.snapshot;

  if (!isValidName(repoName) || !isValidName(snapshotName)) {
    return res.status(400).send('Invalid name.');
  }

  let drive;
  try {
    drive = await getDriveForUser(user.email, projectRoot);
  } catch {
    return res.redirect('/repositories');
  }

  let archive, file;
  try {
    ({ archive, file } = await downloadAndReadSnapshot(drive, repoName, snapshotName));
  } catch (err) {
    return res.send(dashboardLayout(
      { title: esc(snapshotName), path: `/repositories/${encodeURIComponent(repoName)}/${encodeURIComponent(snapshotName)}` },
      user, 'repositories',
      `<a class="back-link" href="/repositories/${encodeURIComponent(repoName)}">← ${esc(repoName)}</a>
       <div class="page-header"><h1 class="page-title">${esc(snapshotName)}</h1></div>
       <div class="empty-state"><p>Failed to read snapshot: ${esc(err.message)}</p></div>`
    ));
  }

  const m        = archive.manifest || {};
  const meta     = archive.metadata || {};
  const fileList = archive.index?.files || [];
  const checksums = archive.checksums || {};

  const manifestRows = [
    ['Name',      m.name      || '—'],
    ['Framework', m.framework || '—'],
    ['Language',  m.language  || '—'],
    ['Adapter',   m.adapter   || '—'],
    ['Version',   archive.header?.version  || '—'],
    ['Created',   formatDate(archive.header?.created_at)]
  ].map(([k, v]) => `<tr><td class="meta-key">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');

  const statsRows = [
    ['Files',         meta.file_count ?? fileList.length],
    ['Total size',    formatBytes(meta.total_size)],
    ['Snapshot size', formatBytes(file.size)]
  ].map(([k, v]) => `<tr><td class="meta-key">${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('');

  const fileItems = fileList.map(f => {
    const checksum  = checksums[f] ? `<span class="checksum">${esc(checksums[f].slice(0, 16))}…</span>` : '';
    const canEdit   = !isBinaryExtension(f) && archive.files?.[f] !== undefined;
    const dataAttr  = canEdit ? ` data-file="${f.replace(/"/g, '&quot;')}"` : '';
    const cls       = `file-tree-item${canEdit ? ' file-editable' : ''}`;
    return `<div class="${cls}"${dataAttr} role="${canEdit ? 'button' : 'listitem'}" ${canEdit ? 'tabindex="0"' : ''}>
              <span class="file-name">${esc(f)}</span>${checksum}
            </div>`;
  }).join('');

  res.send(dashboardLayout(
    {
      title:       `${esc(snapshotName)} — ${esc(repoName)}`,
      description: `View snapshot ${snapshotName} from repository ${repoName} on Julion. Framework: ${m.framework || 'unknown'}, ${fileList.length} files.`,
      path:        `/repositories/${encodeURIComponent(repoName)}/${encodeURIComponent(snapshotName)}`
    },
    user, 'repositories',
    `
    <a class="back-link" href="/repositories/${encodeURIComponent(repoName)}">← ${esc(repoName)}</a>
    <div class="page-header">
      <h1 class="page-title">${esc(snapshotName)}</h1>
      <p class="page-subtitle">Repository: ${esc(repoName)}</p>
    </div>
    <div class="snapshot-grid">
      <div>
        <h2 class="section-label">Manifest</h2>
        <table class="data-table meta-table" aria-label="Manifest"><tbody>${manifestRows}</tbody></table>
      </div>
      <div>
        <h2 class="section-label">Stats</h2>
        <table class="data-table meta-table" aria-label="Stats"><tbody>${statsRows}</tbody></table>
      </div>
    </div>
    <h2 class="section-label" style="margin-top:28px">Files (${fileList.length})</h2>
    <p class="file-hint">Click any file to open it in the editor.</p>
    <div class="file-tree" role="list" aria-label="Snapshot files">${fileItems || '<div class="file-tree-item" style="color:rgba(247,248,251,0.4)">No files indexed.</div>'}</div>

    <!-- ── Monaco editor modal ── -->
    <div id="editor-modal" class="editor-modal" role="dialog" aria-modal="true" aria-label="File editor">
      <div class="editor-bar">
        <div class="editor-bar-left">
          <span class="editor-dot dot-red"   aria-hidden="true"></span>
          <span class="editor-dot dot-yellow" aria-hidden="true"></span>
          <span class="editor-dot dot-green"  aria-hidden="true"></span>
          <span id="editor-path" class="editor-path"></span>
        </div>
        <div class="editor-bar-right">
          <span id="editor-status" class="editor-status" aria-live="polite"></span>
          <button id="save-btn" class="editor-save-btn" disabled>Save &amp; Push to Drive</button>
          <button id="close-btn" class="editor-close-btn" aria-label="Close editor (Esc)">✕</button>
        </div>
      </div>
      <div id="monaco-container" aria-label="Code editor"></div>
    </div>

    <script>
    (function () {
      var REPO     = ${JSON.stringify(repoName)};
      var SNAPSHOT = ${JSON.stringify(snapshotName)};
      var editor   = null;
      var currFile = null;
      var dirty    = false;

      function detectLang(filename) {
        var ext = (filename.split('.').pop() || '').toLowerCase();
        return ({
          ts:'typescript',tsx:'typescript',
          js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',
          py:'python',json:'json',jsonc:'json',
          css:'css',scss:'scss',less:'less',
          html:'html',htm:'html',md:'markdown',mdx:'markdown',
          go:'go',rs:'rust',php:'php',java:'java',kt:'kotlin',swift:'swift',
          c:'c',cpp:'cpp',h:'c',hpp:'cpp',
          sh:'shell',bash:'shell',yaml:'yaml',yml:'yaml',
          toml:'ini',ini:'ini',env:'ini',xml:'xml',svg:'xml',sql:'sql'
        })[ext] || 'plaintext';
      }

      /* load Monaco from CDN once */
      var loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js';
      loaderScript.onload = function () {
        require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
      };
      document.head.appendChild(loaderScript);

      function setStatus(msg) { document.getElementById('editor-status').textContent = msg; }

      function openFile(filePath) {
        currFile = filePath;
        dirty    = false;
        document.getElementById('editor-path').textContent = filePath;
        document.getElementById('save-btn').disabled = true;
        document.getElementById('editor-modal').classList.add('editor-open');
        setStatus('Loading…');

        fetch('/api/file-content?' + new URLSearchParams({ repo: REPO, snapshot: SNAPSHOT, file: filePath }))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error)  { setStatus('Error: ' + data.error); return; }
            if (data.binary) { setStatus('Binary file — cannot edit'); return; }
            setStatus('');
            mountEditor(data.content, detectLang(filePath));
          })
          .catch(function() { setStatus('Network error'); });
      }

      function mountEditor(content, language) {
        if (editor) { editor.dispose(); editor = null; }
        require(['vs/editor/editor.main'], function () {
          editor = monaco.editor.create(document.getElementById('monaco-container'), {
            value:                 content,
            language:              language,
            theme:                 'vs-dark',
            fontSize:              13,
            lineNumbers:           'on',
            minimap:               { enabled: true },
            scrollBeyondLastLine:  false,
            automaticLayout:       true,
            tabSize:               2,
            wordWrap:              'off',
            smoothScrolling:       true,
            cursorBlinking:        'smooth',
            renderLineHighlight:   'all',
            fontFamily:            "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
            fontLigatures:         true,
            bracketPairColorization: { enabled: true },
            renderWhitespace:      'selection',
            suggest:               { showKeywords: true }
          });
          editor.onDidChangeModelContent(function() {
            if (!dirty) {
              dirty = true;
              document.getElementById('save-btn').disabled = false;
              setStatus('● Unsaved changes');
            }
          });
        });
      }

      function closeEditor() {
        document.getElementById('editor-modal').classList.remove('editor-open');
        if (editor) { editor.dispose(); editor = null; }
        currFile = null;
        dirty    = false;
        document.getElementById('save-btn').disabled = true;
        setStatus('');
        document.getElementById('editor-path').textContent = '';
      }

      function saveFile() {
        if (!editor || !currFile) return;
        var btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.textContent = 'Pushing…';
        setStatus('Uploading to Drive…');
        fetch('/api/file-save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ repo: REPO, snapshot: SNAPSHOT, file: currFile, content: editor.getValue() })
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            btn.textContent = 'Save & Push to Drive';
            if (data.ok) {
              dirty = false;
              btn.disabled = false;
              setStatus('✓ Saved to Drive');
              setTimeout(function() { if (!dirty) setStatus(''); }, 3000);
            } else {
              btn.disabled = false;
              setStatus('Error: ' + (data.error || 'Failed'));
            }
          })
          .catch(function() {
            btn.textContent = 'Save & Push to Drive';
            btn.disabled    = false;
            setStatus('Network error');
          });
      }

      document.getElementById('close-btn').addEventListener('click', closeEditor);
      document.getElementById('save-btn').addEventListener('click',  saveFile);

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('editor-modal').classList.contains('editor-open')) {
          closeEditor();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          if (!document.getElementById('save-btn').disabled) saveFile();
        }
      });

      document.querySelectorAll('.file-editable').forEach(function(el) {
        el.addEventListener('click',   function() { openFile(this.dataset.file); });
        el.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') openFile(this.dataset.file); });
      });
    })();
    </script>
    `
  ));
});

// ─── API: read file content ───────────────────────────────────────────────────

app.get('/api/file-content', requireLogin, async (req, res) => {
  const repo     = typeof req.query.repo     === 'string' ? req.query.repo     : '';
  const snapshot = typeof req.query.snapshot === 'string' ? req.query.snapshot : '';
  const file     = typeof req.query.file     === 'string' ? req.query.file     : '';

  if (!isValidName(repo) || !isValidName(snapshot) || !file) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  if (isBinaryExtension(file)) return res.json({ binary: true });

  const projectRoot = path.join(__dirname, '..', '..');
  let drive;
  try {
    drive = await getDriveForUser(req.session.user.email, projectRoot);
  } catch {
    return res.status(401).json({ error: 'Drive not connected' });
  }

  try {
    const { archive } = await downloadAndReadSnapshot(drive, repo, snapshot);
    if (!archive.index?.files?.includes(file)) {
      return res.status(404).json({ error: 'File not found in snapshot' });
    }
    const b64 = archive.files?.[file];
    if (b64 === undefined) return res.status(404).json({ error: 'File content not stored' });
    const decoded = Buffer.from(b64, 'base64');
    if (decoded.includes(0)) return res.json({ binary: true });
    res.json({ content: decoded.toString('utf8'), language: detectLanguage(file) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: save file back to Drive ─────────────────────────────────────────────

app.post('/api/file-save', requireLogin, async (req, res) => {
  const { repo, snapshot, file, content } = req.body || {};

  if (!isValidName(repo) || !isValidName(snapshot)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  if (typeof file !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing file or content' });
  }

  const projectRoot = path.join(__dirname, '..', '..');
  let drive;
  try {
    drive = await getDriveForUser(req.session.user.email, projectRoot);
  } catch {
    return res.status(401).json({ error: 'Drive not connected' });
  }

  let archive, driveFile;
  try {
    ({ archive, file: driveFile } = await downloadAndReadSnapshot(drive, repo, snapshot));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to download snapshot: ' + err.message });
  }

  if (!archive.index?.files?.includes(file)) {
    return res.status(404).json({ error: 'File not found in snapshot' });
  }

  archive.files[file]     = Buffer.from(content, 'utf8').toString('base64');
  archive.checksums[file] = 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex');

  const tmpPath = path.join(os.tmpdir(), `julion-save-${Date.now()}.on`);
  try {
    await writeOnArchive(archive, tmpPath);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to repack archive: ' + err.message });
  }

  try {
    await drive.files.update({
      fileId: driveFile.id,
      media:  { mimeType: 'application/octet-stream', body: createReadStream(tmpPath) }
    });
  } catch (err) {
    await fsPromises.unlink(tmpPath).catch(() => {});
    return res.status(500).json({ error: 'Drive upload failed: ' + err.message });
  }

  await fsPromises.unlink(tmpPath).catch(() => {});
  res.json({ ok: true });
});

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.post('/logout', requireLogin, async (req, res) => {
  const email = req.session.user.email;
  try { await deleteUserDriveToken(email, path.join(__dirname, '..', '..')); } catch { /* ignore */ }
  req.session.destroy(() => res.redirect('/'));
});

app.get('/auth/google', async (req, res) => {
  const projectRoot = path.join(__dirname, '..', '..');
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig(projectRoot);
  const cliSession = typeof req.query.session === 'string' ? req.query.session.trim() : '';
  if (cliSession) await createAuthSession(cliSession, projectRoot);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = Buffer.from(JSON.stringify({ cliSession: cliSession || null, siteLogin: !cliSession })).toString('base64url');
  res.redirect(oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope:       GOOGLE_DRIVE_SCOPES,
    prompt:      'consent',
    state
  }));
});

app.get('/auth/google/callback', async (req, res) => {
  const code     = typeof req.query.code  === 'string' ? req.query.code  : '';
  const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code) {
    return res.status(400).send(publicLayout(
      { title: 'Login failed', robots: 'noindex, nofollow', path: '/auth/google/callback' },
      '<main><section class="card card-primary"><h1>Missing authorization code</h1></section></main>'
    ));
  }

  let statePayload = { cliSession: null, siteLogin: true };
  if (stateRaw) {
    try { statePayload = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')); } catch { /* keep defaults */ }
  }

  const projectRoot = path.join(__dirname, '..', '..');
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig(projectRoot);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const tokenResponse = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokenResponse.tokens);

  const oauth2  = google.oauth2({ version: 'v2', auth: oauth2Client });
  const profile = await oauth2.userinfo.get();
  const email   = profile.data.email;
  const name    = profile.data.name    || email;
  const picture = profile.data.picture || undefined;

  if (!email) {
    return res.status(400).send(publicLayout(
      { title: 'Login failed', robots: 'noindex, nofollow', path: '/auth/google/callback' },
      '<main><section class="card card-primary"><h1>Google did not return an email address.</h1></section></main>'
    ));
  }

  const user = { email, name, picture };
  await upsertUser(user, projectRoot);

  if (statePayload.cliSession) {
    await completeAuthSession(statePayload.cliSession, tokenResponse.tokens, user, projectRoot);
    return res.redirect(`/auth/complete?session=${encodeURIComponent(statePayload.cliSession)}`);
  }

  await saveUserDriveToken(email, tokenResponse.tokens, projectRoot);
  req.session.user = user;
  return res.redirect('/dashboard');
});

app.get('/auth/complete', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth-complete.html'));
});

app.get('/auth-google', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(`/auth/google${query}`);
});

// ─── API: auth session polling + status ──────────────────────────────────────

app.get('/api/auth/session/:sessionId', async (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId || sessionId.length > 64) {
    return res.status(400).json({ status: 'invalid', message: 'Invalid session id.' });
  }
  const projectRoot = path.join(__dirname, '..', '..');
  try {
    const status = await getAuthSessionStatus(sessionId, projectRoot);
    if (status === 'pending') return res.status(202).json({ status: 'pending' });
    if (status === 'complete') {
      const claimed = await claimAuthSession(sessionId, projectRoot);
      if (!claimed) return res.status(202).json({ status: 'pending' });
      return res.json({ status: 'complete', sessionId: claimed.sessionId, token: claimed.token, user_email: claimed.user_email, user_name: claimed.user_name, user_picture: claimed.user_picture });
    }
    if (status === 'claimed') return res.status(410).json({ status: 'claimed', message: 'Session already used.' });
    return res.status(404).json({ status: status === 'expired' ? 'expired' : 'missing' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : 'Auth session lookup failed.' });
  }
});

app.get('/api/status', async (req, res) => {
  const env = await getEnv();
  let database = 'not_configured';
  try {
    const connection = await getDbConnection(path.join(__dirname, '..', '..'));
    await connection.ping();
    await connection.end();
    database = 'connected';
  } catch (error) {
    database = error instanceof Error ? error.message : 'error';
  }
  res.json({ name: 'JULION Web', status: 'ready', baseUrl: resolvePublicBaseUrl(env), database, loggedIn: Boolean(req.session?.user?.email) });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(port, async () => {
  const env = await getEnv();
  siteBaseUrl = resolvePublicBaseUrl(env);
  console.log(`Julion web running at ${siteBaseUrl}`);
  console.log(`Local: http://localhost:${port}`);
  console.log(`Google callback: ${env.GOOGLE_REDIRECT_URI || siteBaseUrl + '/auth/google/callback'}`);
});
