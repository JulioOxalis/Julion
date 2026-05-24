import { promises as fs, statSync } from 'fs';
import path from 'path';

export function parseDotEnv(content: string): Record<string, string> {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function findDotEnvPath(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;
  while (true) {
    const candidate = path.join(currentDir, '.env');
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
}

export async function loadMergedEnv(startDir: string = process.cwd()): Promise<Record<string, string>> {
  const envPath = findDotEnvPath(startDir);
  let fileEnv: Record<string, string> = {};
  if (envPath) {
    try {
      const raw = await fs.readFile(envPath, 'utf8');
      fileEnv = parseDotEnv(raw);
    } catch {
      // ignore
    }
  }
  return { ...fileEnv, ...process.env } as Record<string, string>;
}

export function resolveWebsiteAuthUrl(env: Record<string, string>): string {
  const explicit =
    env.JULION_WEBSITE_AUTH_URL || env.JULION_AUTH_URL || env.JULION_SITE_URL || env.JULION_WEB_URL;
  if (explicit) {
    const trimmed = explicit.replace(/\/$/, '');
    if (trimmed.endsWith('/auth/google')) {
      return trimmed;
    }
    if (trimmed.includes('/auth/google')) {
      return trimmed;
    }
    return `${trimmed}/auth/google`;
  }
  const port = env.PORT || '3000';
  return `http://localhost:${port}/auth/google`;
}

export function resolveGoogleRedirectUri(env: Record<string, string>): string {
  const configured = env.GOOGLE_REDIRECT_URI || '';
  if (configured.includes('/auth/google/callback')) {
    return configured.replace(/\/$/, '');
  }
  if (configured) {
    return `${configured.replace(/\/$/, '')}/auth/google/callback`;
  }
  const site = env.JULION_SITE_URL || env.JULION_WEB_URL || `http://localhost:${env.PORT || '3000'}`;
  return `${site.replace(/\/$/, '')}/auth/google/callback`;
}

export function resolvePublicBaseUrl(env: Record<string, string>): string {
  if (env.JULION_SITE_URL || env.JULION_WEB_URL) {
    return (env.JULION_SITE_URL || env.JULION_WEB_URL || '').replace(/\/$/, '');
  }
  if (env.GOOGLE_REDIRECT_URI) {
    const redirect = env.GOOGLE_REDIRECT_URI.replace(/\/$/, '');
    if (redirect.endsWith('/auth/google/callback')) {
      return redirect.slice(0, -'/auth/google/callback'.length);
    }
    return redirect;
  }
  const port = env.PORT || '3000';
  return `http://localhost:${port}`;
}
