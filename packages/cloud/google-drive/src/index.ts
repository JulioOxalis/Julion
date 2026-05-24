import { createReadStream, createWriteStream, promises as fs, statSync } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { google } from 'googleapis';
import mysql, { Connection } from 'mysql2/promise';
import type { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const STORAGE_DIR = path.join(os.homedir(), '.julion');
const TOKEN_PATH = path.join(STORAGE_DIR, 'google-drive-token.json');
const CREDENTIALS_PATH = path.join(STORAGE_DIR, 'google-client.json');
const ROOT_FOLDER_NAME = 'JULION';

const BUILT_IN_GOOGLE_CLIENT = {
  clientId: '',
  clientSecret: '',
  redirectUri: 'urn:ietf:wg:oauth:2.0:oob'
};

async function readJson(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseDotEnv(content: string) {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function findDotEnvPath(startDir: string) {
  let currentDir = startDir;
  while (true) {
    const candidate = path.join(currentDir, '.env');
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore missing files
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
}

interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

async function loadDotEnvFile() {
  const envPath = findDotEnvPath(process.cwd());
  if (!envPath) {
    return null;
  }

  try {
    const raw = await fs.readFile(envPath, 'utf8');
    return parseDotEnv(raw);
  } catch {
    return null;
  }
}

async function loadDatabaseConfig() {
  const envFile = await loadDotEnvFile();
  const env = { ...process.env, ...(envFile ?? {}) } as Record<string, string>;
  const host = env.DB_HOST || env.MYSQL_HOST || 'localhost';
  const user = env.DB_USER || env.MYSQL_USER;
  const password = env.DB_PASSWORD || env.MYSQL_PASSWORD;
  const database = env.DB_DATABASE || env.MYSQL_DATABASE || 'Julion';
  const port = env.DB_PORT ? Number(env.DB_PORT) : 3306;

  if (!user || !password) {
    return null;
  }

  return { host, port, user, password, database } as MySqlConfig;
}

async function getDbConnection(): Promise<Connection | null> {
  const config = await loadDatabaseConfig();
  if (!config) {
    return null;
  }

  try {
    const connection = await mysql.createConnection(config);
    await ensureAuthTable(connection);
    return connection;
  } catch (error) {
    console.warn('MySQL auth store unavailable:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function ensureAuthTable(connection: Connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS julion_auth_tokens (
      provider VARCHAR(64) PRIMARY KEY,
      token_json LONGTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureStorageDirectory() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

function openUrl(url: string) {
  const platform = process.platform;
  const command = platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) {
      console.warn('Unable to open browser automatically, please copy the URL and open it manually.');
    }
  });
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function loadClientCredentials() {
  const envClientId = process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  let envRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!envClientId || !envClientSecret) {
    const envFile = await loadDotEnvFile();
    if (envFile) {
      Object.assign(process.env, envFile);
    }
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  envRedirectUri = process.env.GOOGLE_REDIRECT_URI || envRedirectUri;

  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      redirectUri: envRedirectUri || 'urn:ietf:wg:oauth:2.0:oob'
    };
  }

  const credentials = await readJson(CREDENTIALS_PATH);
  if (credentials) {
    const payload = credentials.installed ?? credentials.web;
    if (payload) {
      return {
        clientId: payload.client_id,
        clientSecret: payload.client_secret,
        redirectUri: payload.redirect_uris?.[0] || envRedirectUri || 'urn:ietf:wg:oauth:2.0:oob'
      };
    }
  }

  if (BUILT_IN_GOOGLE_CLIENT.clientId && BUILT_IN_GOOGLE_CLIENT.clientSecret) {
    return BUILT_IN_GOOGLE_CLIENT;
  }
  if (!credentials) {
    throw new Error(
      'Google client credentials not found. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, place credentials in a .env file, or create a file at ~/.julion/google-client.json.'
    );
  }

  const payload = credentials.installed ?? credentials.web;
  if (!payload) {
    throw new Error('Invalid Google client credentials format. Expected installed or web credentials.');
  }

  return {
    clientId: payload.client_id,
    clientSecret: payload.client_secret,
    redirectUri: payload.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  };
}

async function saveToken(token: unknown) {
  const payload = JSON.stringify(token, null, 2);
  await ensureStorageDirectory();

  const db = await getDbConnection();
  if (db) {
    try {
      await db.execute(
        `INSERT INTO julion_auth_tokens (provider, token_json)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE token_json = VALUES(token_json), created_at = CURRENT_TIMESTAMP`,
        ['google_drive', payload]
      );
    } finally {
      await db.end();
    }
  }

  await fs.writeFile(TOKEN_PATH, payload, 'utf8');
}

async function loadToken() {
  const db = await getDbConnection();
  if (db) {
    try {
      const [rows] = await db.execute<any[]>(
        'SELECT token_json FROM julion_auth_tokens WHERE provider = ?',
        ['google_drive']
      );
      if (Array.isArray(rows) && rows.length > 0 && rows[0].token_json) {
        try {
          return JSON.parse(rows[0].token_json);
        } catch {
          // fall back to file
        }
      }
    } finally {
      await db.end();
    }
  }

  return readJson(TOKEN_PATH);
}

async function loadTokenFromDbOnly() {
  const db = await getDbConnection();
  if (!db) {
    return null;
  }

  try {
    const [rows] = await db.execute<any[]>(
      'SELECT token_json FROM julion_auth_tokens WHERE provider = ?',
      ['google_drive']
    );
    if (Array.isArray(rows) && rows.length > 0 && rows[0].token_json) {
      try {
        return JSON.parse(rows[0].token_json);
      } catch {
        return null;
      }
    }
    return null;
  } finally {
    await db.end();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebsiteToken(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = await loadTokenFromDbOnly();
    if (token) {
      return token;
    }
    await sleep(2000);
  }
  return null;
}

async function getOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret, redirectUri } = await loadClientCredentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const token = await loadToken();
  if (token) {
    auth.setCredentials(token);
    return auth;
  }

  throw new Error('No stored Google Drive credentials found. Run `julion auth google` first.');
}

async function getDrive() {
  const auth = await getOAuthClient();
  return google.drive({ version: 'v3', auth });
}

function escapeQueryValue(value: string) {
  return value.replace(/'/g, "\\'");
}

async function getOrCreateFolder(drive: any, name: string, parentId?: string) {
  const queryParts = [
    `name='${escapeQueryValue(name)}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false'
  ];

  if (parentId) {
    queryParts.push(`'${parentId}' in parents`);
  } else {
    queryParts.push("'root' in parents");
  }

  const response = await drive.files.list({
    q: queryParts.join(' and '),
    fields: 'files(id,name)',
    spaces: 'drive'
  });

  const existingFolder = response.data.files?.[0];
  if (existingFolder?.id) {
    return existingFolder.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id'
  });

  return created.data.id as string;
}

export async function authenticate() {
  const { clientId, clientSecret, redirectUri } = await loadClientCredentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('Open this URL in your browser to authorize JULION Google Drive access:');
  console.log(authUrl);
  openUrl(authUrl);

  const code = await prompt('Paste the authorization code here: ');
  const tokenResponse = await auth.getToken(code);
  auth.setCredentials(tokenResponse.tokens);
  await saveToken(tokenResponse.tokens);

  console.log('Google Drive authorization complete. Token saved to', TOKEN_PATH);
}

export async function authenticateViaWebsite() {
  const authUrl =
    process.env.JULION_WEBSITE_AUTH_URL || process.env.JULION_AUTH_URL || process.env.JULION_SITE_URL;

  if (!authUrl) {
    throw new Error(
      'Website auth URL is not configured. Set JULION_WEBSITE_AUTH_URL in your environment or .env file.'
    );
  }

  console.log('Opening your Julion website login page...');
  console.log(authUrl);
  openUrl(authUrl);
  console.log('After signing in on the website, the site should write your Google Drive auth token into the Julion MySQL database.');
  console.log('Waiting for website-issued auth token...');

  const token = await waitForWebsiteToken();
  if (!token) {
    throw new Error(
      'No website-issued Google Drive auth token was found in MySQL. Complete the login on the website and try again.'
    );
  }

  await saveToken(token);
  console.log('Website-issued Google Drive auth token loaded and saved.');
}

export async function uploadSnapshot(snapshotPath: string, repositoryName?: string) {
  const drive = await getDrive();
  const rootFolderId = await getOrCreateFolder(drive, ROOT_FOLDER_NAME);
  const repoName = repositoryName || path.basename(snapshotPath, '.on');
  const repoFolderId = await getOrCreateFolder(drive, repoName, rootFolderId);

  const media = {
    mimeType: 'application/octet-stream',
    body: createReadStream(snapshotPath)
  };

  const response = await drive.files.create({
    requestBody: {
      name: path.basename(snapshotPath),
      parents: [repoFolderId]
    },
    media,
    fields: 'id,name'
  });

  return {
    fileId: response.data.id,
    fileName: response.data.name,
    repositoryName: repoName,
    repositoryFolderId: repoFolderId
  };
}

export async function downloadSnapshot(snapshotName: string, downloadPath: string, repositoryName?: string) {
  const drive = await getDrive();
  const rootFolderId = await getOrCreateFolder(drive, ROOT_FOLDER_NAME);
  let folderId = rootFolderId;

  if (repositoryName) {
    folderId = await getOrCreateFolder(drive, repositoryName, rootFolderId);
  }

  const queryParts = [
    `name='${escapeQueryValue(snapshotName)}'`,
    'trashed=false'
  ];

  if (repositoryName) {
    queryParts.push(`'${folderId}' in parents`);
  }

  let response = await drive.files.list({
    q: queryParts.join(' and '),
    fields: 'files(id,name,parents)',
    spaces: 'drive'
  });

  if (!response.data.files?.length) {
    response = await drive.files.list({
      q: `name='${escapeQueryValue(snapshotName)}' and trashed=false`,
      fields: 'files(id,name,parents)',
      spaces: 'drive'
    });
  }

  const file = response.data.files?.[0];
  if (!file?.id) {
    throw new Error(`Snapshot ${snapshotName} not found on Google Drive.`);
  }

  await fs.mkdir(path.dirname(downloadPath), { recursive: true });
  const dest = createWriteStream(downloadPath);
  const stream = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });

  await new Promise<void>((resolve, reject) => {
    (stream.data as any)
      .on('end', resolve)
      .on('error', reject)
      .pipe(dest);
  });

  return {
    fileId: file.id,
    fileName: file.name,
    downloadedTo: downloadPath
  };
}
