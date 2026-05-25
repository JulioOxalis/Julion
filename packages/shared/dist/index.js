'use strict';

// ─── julion-shared dist/index.js ─────────────────────────────────────────────
// MongoDB Atlas implementation — replaces the previous MySQL version.
// All public API signatures are identical so CLI and web server need no changes.

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ──────────────────────────────────────────────────────────────────────────────
// env.js helpers
// ──────────────────────────────────────────────────────────────────────────────

function parseDotEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function findDotEnvPath(startDir) {
  let cur = startDir || process.cwd();
  while (true) {
    const candidate = path.join(cur, '.env');
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

async function loadMergedEnv(startDir) {
  const envPath = findDotEnvPath(startDir);
  let fileEnv = {};
  if (envPath) {
    try { fileEnv = parseDotEnv(fs.readFileSync(envPath, 'utf8')); } catch { /* */ }
  }
  return Object.assign({}, fileEnv, process.env);
}

function resolveWebsiteAuthUrl(env) {
  const explicit = env.JULION_WEBSITE_AUTH_URL || env.JULION_AUTH_URL || env.JULION_SITE_URL || env.JULION_WEB_URL;
  if (explicit) {
    const t = explicit.replace(/\/$/, '');
    if (t.endsWith('/auth/google') || t.includes('/auth/google')) return t;
    // serverless path
    if (t.includes('/api/auth')) return t;
    return `${t}/auth/google`;
  }
  const port = env.PORT || '3000';
  return `http://localhost:${port}/auth/google`;
}

function resolveGoogleRedirectUri(env) {
  const configured = env.GOOGLE_REDIRECT_URI || '';
  if (configured.includes('/auth/google/callback') || configured.includes('/api/auth/callback')) {
    return configured.replace(/\/$/, '');
  }
  if (configured) {
    // serverless: append /api/auth/callback
    return `${configured.replace(/\/$/, '')}/api/auth/callback`;
  }
  const site = env.JULION_SITE_URL || env.JULION_WEB_URL || `http://localhost:${env.PORT || '3000'}`;
  return `${site.replace(/\/$/, '')}/api/auth/callback`;
}

function resolvePublicBaseUrl(env) {
  if (env.JULION_SITE_URL || env.JULION_WEB_URL) {
    return (env.JULION_SITE_URL || env.JULION_WEB_URL || '').replace(/\/$/, '');
  }
  if (env.GOOGLE_REDIRECT_URI) {
    const r = env.GOOGLE_REDIRECT_URI.replace(/\/$/, '');
    if (r.endsWith('/auth/google/callback')) return r.slice(0, -'/auth/google/callback'.length);
    if (r.endsWith('/api/auth/callback'))   return r.slice(0, -'/api/auth/callback'.length);
    return r;
  }
  return `http://localhost:${env.PORT || '3000'}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Google config helpers
// ──────────────────────────────────────────────────────────────────────────────

const GOOGLE_DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file'
];

const CREDENTIALS_PATH = path.join(os.homedir(), '.julion', 'google-client.json');

async function loadGoogleClientConfig(startDir) {
  const env = await loadMergedEnv(startDir);
  const clientId     = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = resolveGoogleRedirectUri(env);

  if (clientId && clientSecret) return { clientId, clientSecret, redirectUri };

  try {
    const raw  = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const creds = JSON.parse(raw);
    const payload = creds.installed || creds.web;
    if (payload?.client_id && payload?.client_secret) {
      return {
        clientId:    payload.client_id,
        clientSecret: payload.client_secret,
        redirectUri: payload.redirect_uris?.[0] || redirectUri
      };
    }
  } catch { /* */ }

  throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.');
}

// ──────────────────────────────────────────────────────────────────────────────
// MongoDB connection management
// ──────────────────────────────────────────────────────────────────────────────

let _mongoClient = null;
let _mongoPromise = null;

async function getMongoClient(startDir) {
  if (_mongoClient) return _mongoClient;
  if (_mongoPromise) return _mongoPromise;

  const env = await loadMergedEnv(startDir);
  const uri = env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to your .env file.');
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  _mongoPromise = client.connect().then((c) => { _mongoClient = c; return c; });
  return _mongoPromise;
}

async function getDb(startDir) {
  const client = await getMongoClient(startDir);
  const env    = await loadMergedEnv(startDir);
  const dbName = env.DB_NAME || 'julion';
  return client.db(dbName);
}

// Keep getDbConnection name for backward compat — now returns Mongo db object
async function getDbConnection(startDir) {
  return getDb(startDir);
}

// ──────────────────────────────────────────────────────────────────────────────
// Collection bootstrap
// ──────────────────────────────────────────────────────────────────────────────

async function ensureCollections(startDir) {
  const db = await getDb(startDir);

  for (const name of ['users', 'user_tokens', 'auth_sessions']) {
    await db.createCollection(name).catch(() => {});
  }

  await db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await db.collection('user_tokens').createIndex({ userEmail: 1 }, { unique: true }).catch(() => {});
  await db.collection('auth_sessions').createIndex({ sessionId: 1 }, { unique: true }).catch(() => {});
  await db.collection('auth_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  await db.collection('auth_sessions').createIndex({ status: 1, expiresAt: 1 }).catch(() => {});
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth session helpers
// ──────────────────────────────────────────────────────────────────────────────

const SESSION_TTL_MINUTES = 15;

function createSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

async function createAuthSession(sessionId, startDir) {
  const db = await getDb(startDir);
  await db.collection('auth_sessions').updateOne(
    { sessionId },
    {
      $set: {
        sessionId,
        status:      'pending',
        tokenJson:   null,
        userEmail:   null,
        userName:    null,
        userPicture: null,
        createdAt:   new Date(),
        expiresAt:   new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000)
      }
    },
    { upsert: true }
  );
}

async function upsertUser(user, startDir) {
  const db = await getDb(startDir);
  await db.collection('users').updateOne(
    { email: user.email },
    {
      $set:         { name: user.name, picture: user.picture || null, lastLoginAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
}

async function saveUserDriveToken(userEmail, token, startDir) {
  const db = await getDb(startDir);
  await db.collection('user_tokens').updateOne(
    { userEmail },
    { $set: { tokenJson: JSON.stringify(token), updatedAt: new Date() } },
    { upsert: true }
  );
}

async function loadUserDriveToken(userEmail, startDir) {
  const db = await getDb(startDir);
  try {
    const doc = await db.collection('user_tokens').findOne({ userEmail });
    if (!doc?.tokenJson) return null;
    return JSON.parse(doc.tokenJson);
  } catch { return null; }
}

async function deleteUserDriveToken(userEmail, startDir) {
  const db = await getDb(startDir);
  await db.collection('user_tokens').deleteOne({ userEmail });
}

async function completeAuthSession(sessionId, token, user, startDir) {
  await upsertUser(user, startDir);
  await saveUserDriveToken(user.email, token, startDir);

  const db = await getDb(startDir);
  await db.collection('auth_sessions').updateOne(
    { sessionId, status: 'pending' },
    {
      $set: {
        status:      'complete',
        tokenJson:   JSON.stringify(token),
        userEmail:   user.email,
        userName:    user.name,
        userPicture: user.picture || null
      }
    }
  );
}

async function claimAuthSession(sessionId, startDir) {
  const db = await getDb(startDir);
  const session = await db.collection('auth_sessions').findOneAndUpdate(
    { sessionId, status: 'complete', expiresAt: { $gt: new Date() } },
    { $set: { status: 'claimed' } },
    { returnDocument: 'after' }
  );

  if (!session?.tokenJson || !session?.userEmail) return null;

  return {
    sessionId:    session.sessionId,
    token:        JSON.parse(session.tokenJson),
    user_email:   session.userEmail,
    user_name:    session.userName || session.userEmail,
    user_picture: session.userPicture || undefined
  };
}

async function getAuthSessionStatus(sessionId, startDir) {
  const db  = await getDb(startDir);
  const doc = await db.collection('auth_sessions').findOne({ sessionId });
  if (!doc) return 'missing';
  if (doc.status === 'claimed') return 'claimed';
  if (new Date(doc.expiresAt) <= new Date()) return 'expired';
  if (doc.status === 'complete') return 'complete';
  return 'pending';
}

async function getAuthSession(sessionId, startDir) {
  const db  = await getDb(startDir);
  const doc = await db.collection('auth_sessions').findOne({
    sessionId,
    status: 'complete',
    expiresAt: { $gt: new Date() }
  });
  if (!doc?.tokenJson || !doc?.userEmail) return null;
  return {
    sessionId:    doc.sessionId,
    token:        JSON.parse(doc.tokenJson),
    user_email:   doc.userEmail,
    user_name:    doc.userName || doc.userEmail,
    user_picture: doc.userPicture || undefined
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// waitForAuthSession — used by CLI after julion connect google --website
// ──────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForAuthSessionHttp(baseUrl, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/auth/session/${encodeURIComponent(sessionId)}`;

  while (Date.now() < deadline) {
    let response;
    try { response = await fetch(endpoint); } catch { await sleep(2000); continue; }

    if (response.status === 202) { await sleep(2000); continue; }
    if (response.ok) {
      const payload = await response.json();
      if (payload?.data?.token && payload?.data?.user_email) return payload.data;
      if (payload?.token && payload?.user_email) return payload;
    }
    if (response.status === 410 || response.status === 404) {
      throw new Error('Login session expired or not found. Run `julion connect google --website` again.');
    }
    await sleep(2000);
  }
  throw new Error('Timed out waiting for website login.');
}

async function waitForAuthSession(sessionId, timeoutMs, startDir) {
  if (timeoutMs === undefined) timeoutMs = 180000;
  const env     = await loadMergedEnv(startDir);
  const baseUrl = resolvePublicBaseUrl(env);

  try {
    return await waitForAuthSessionHttp(baseUrl, sessionId, timeoutMs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isNetworkError = msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND');
    if (!isNetworkError) throw error;
  }

  // Fallback: poll MongoDB directly
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await claimAuthSession(sessionId, startDir);
    if (result) return result;
    const status = await getAuthSessionStatus(sessionId, startDir);
    if (status === 'claimed' || status === 'expired' || status === 'missing') break;
    await sleep(2000);
  }
  throw new Error('Timed out waiting for website login.');
}

// ──────────────────────────────────────────────────────────────────────────────
// Misc
// ──────────────────────────────────────────────────────────────────────────────

function sanitizeIgnoreList(files) {
  const defaults = ['vendor/', 'node_modules/', '.git/', '.env', 'storage/logs/', 'cache/', 'tmp/', 'dist/', 'build/'];
  return Array.from(new Set([...defaults, ...(files || [])]));
}

// Backward-compat stub — was MySQL-specific, not needed for MongoDB
async function loadDatabaseConfig(startDir) {
  const env = await loadMergedEnv(startDir);
  return env.MONGODB_URI ? { uri: env.MONGODB_URI, dbName: env.DB_NAME || 'julion' } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports — identical surface to the old MySQL version
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  // env
  parseDotEnv,
  findDotEnvPath,
  loadMergedEnv,
  resolveWebsiteAuthUrl,
  resolveGoogleRedirectUri,
  resolvePublicBaseUrl,
  // google
  GOOGLE_DRIVE_SCOPES,
  loadGoogleClientConfig,
  // db (compat)
  loadDatabaseConfig,
  getDbConnection,
  ensureCollections,
  // auth
  createSessionId,
  createAuthSession,
  upsertUser,
  saveUserDriveToken,
  loadUserDriveToken,
  deleteUserDriveToken,
  completeAuthSession,
  claimAuthSession,
  getAuthSessionStatus,
  getAuthSession,
  waitForAuthSession,
  // misc
  sanitizeIgnoreList,
};
