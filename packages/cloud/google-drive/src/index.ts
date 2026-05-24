import { createReadStream, createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import {
  createAuthSession,
  createSessionId,
  deleteUserDriveToken,
  loadUserDriveToken,
  saveUserDriveToken,
  waitForAuthSession,
  GOOGLE_DRIVE_SCOPES,
  loadGoogleClientConfig,
  resolveWebsiteAuthUrl,
  loadMergedEnv
} from 'julion-shared';

const STORAGE_DIR = path.join(os.homedir(), '.julion');
const TOKEN_PATH = path.join(STORAGE_DIR, 'google-drive-token.json');
const ROOT_FOLDER_NAME = 'JULION';

interface StoredTokenFile {
  token?: Record<string, unknown>;
  user_email?: string;
  user_name?: string;
}

async function readJson(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function ensureStorageDirectory() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

function openUrl(url: string) {
  const platform = process.platform;
  const command =
    platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) {
      console.warn('Unable to open browser automatically. Copy the URL and open it manually.');
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

function normalizeStoredToken(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as StoredTokenFile & Record<string, unknown>;
  if (payload.token && typeof payload.token === 'object') {
    return payload.token as Record<string, unknown>;
  }
  if (payload.access_token || payload.refresh_token) {
    return payload as Record<string, unknown>;
  }
  return null;
}

async function saveToken(token: unknown, user?: { email: string; name?: string }) {
  await ensureStorageDirectory();
  const payload: StoredTokenFile = {
    token: token as Record<string, unknown>,
    user_email: user?.email,
    user_name: user?.name
  };
  await fs.writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2), 'utf8');

  if (user?.email) {
    await saveUserDriveToken(user.email, token);
  }
}

async function loadToken(): Promise<Record<string, unknown> | null> {
  const filePayload = await readJson(TOKEN_PATH);
  const fromFile = normalizeStoredToken(filePayload);
  if (fromFile) {
    return fromFile;
  }

  const userEmail = (filePayload as StoredTokenFile | null)?.user_email;
  if (userEmail) {
    const fromDb = await loadUserDriveToken(userEmail);
    if (fromDb) {
      return fromDb;
    }
  }

  return null;
}

async function getOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const token = await loadToken();
  if (token) {
    auth.setCredentials(token);
    return auth;
  }

  throw new Error('No stored Google Drive credentials found. Run `julion auth google --website` first.');
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
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_DRIVE_SCOPES,
    prompt: 'consent'
  });

  console.log('Open this URL in your browser to authorize JULION Google Drive access:');
  console.log(authUrl);
  openUrl(authUrl);

  const code = await prompt('Paste the authorization code here: ');
  const tokenResponse = await auth.getToken(code);
  auth.setCredentials(tokenResponse.tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth });
  const profile = await oauth2.userinfo.get();
  const email = profile.data.email || 'unknown@user.local';
  const name = profile.data.name || email;

  await saveToken(tokenResponse.tokens, { email, name });
  console.log(`Google Drive authorization complete for ${email}.`);
}

export async function authenticateViaWebsite() {
  const env = await loadMergedEnv();
  const sessionId = createSessionId();
  await createAuthSession(sessionId);

  const baseUrl = resolveWebsiteAuthUrl(env);
  const url = new URL(baseUrl);
  url.searchParams.set('session', sessionId);

  console.log('Step 1: Opening your Julion login page in the browser...');
  console.log(url.toString());
  openUrl(url.toString());
  console.log('');
  console.log('Step 2: Sign in with Google and approve Drive access.');
  console.log('Step 3: When the page says you can return to VS Code, come back here.');
  console.log('');
  console.log('Waiting for login to complete...');

  const result = await waitForAuthSession(sessionId);
  await saveToken(result.token, { email: result.user_email, name: result.user_name });

  console.log(`Logged in as ${result.user_name} (${result.user_email}).`);
  console.log('Google Drive is ready. You can now run:');
  console.log('  julion save --ultra --push --repository my-repo');
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

  const queryParts = [`name='${escapeQueryValue(snapshotName)}'`, 'trashed=false'];

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
    (stream.data as NodeJS.ReadableStream)
      .on('end', () => resolve())
      .on('error', reject)
      .pipe(dest);
  });

  return {
    fileId: file.id,
    fileName: file.name,
    downloadedTo: downloadPath
  };
}

export { deleteUserDriveToken };
