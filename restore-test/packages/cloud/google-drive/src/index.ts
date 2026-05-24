import { createReadStream, createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const STORAGE_DIR = path.join(os.homedir(), '.julion');
const TOKEN_PATH = path.join(STORAGE_DIR, 'google-drive-token.json');
const CREDENTIALS_PATH = path.join(STORAGE_DIR, 'google-client.json');
const ROOT_FOLDER_NAME = 'JULION';

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
  const envRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (envClientId && envClientSecret && envRedirectUri) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      redirectUri: envRedirectUri
    };
  }

  const credentials = await readJson(CREDENTIALS_PATH);
  if (!credentials) {
    throw new Error(
      'Google client credentials not found. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI or create a file at ~/.julion/google-client.json.'
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
  await ensureStorageDirectory();
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

async function loadToken() {
  return readJson(TOKEN_PATH);
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
