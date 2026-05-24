import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadMergedEnv, resolveGoogleRedirectUri } from './env';

export const GOOGLE_DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file'
];

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const CREDENTIALS_PATH = path.join(os.homedir(), '.julion', 'google-client.json');

async function readJson(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadGoogleClientConfig(startDir?: string): Promise<GoogleClientConfig> {
  const env = await loadMergedEnv(startDir);
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveGoogleRedirectUri(env);

  if (clientId && clientSecret) {
    return { clientId, clientSecret, redirectUri };
  }

  const credentials = await readJson(CREDENTIALS_PATH);
  if (credentials) {
    const payload = credentials.installed ?? credentials.web;
    if (payload?.client_id && payload?.client_secret) {
      return {
        clientId: payload.client_id,
        clientSecret: payload.client_secret,
        redirectUri: payload.redirect_uris?.[0] || redirectUri
      };
    }
  }

  throw new Error(
    'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.'
  );
}
