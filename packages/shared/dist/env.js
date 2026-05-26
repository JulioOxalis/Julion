"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDotEnv = parseDotEnv;
exports.findDotEnvPath = findDotEnvPath;
exports.loadMergedEnv = loadMergedEnv;
exports.resolveWebsiteAuthUrl = resolveWebsiteAuthUrl;
exports.resolveGoogleRedirectUri = resolveGoogleRedirectUri;
exports.resolvePublicBaseUrl = resolvePublicBaseUrl;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
function parseDotEnv(content) {
    const result = {};
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
function findDotEnvPath(startDir = process.cwd()) {
    let currentDir = startDir;
    while (true) {
        const candidate = path_1.default.join(currentDir, '.env');
        try {
            if ((0, fs_1.statSync)(candidate).isFile()) {
                return candidate;
            }
        }
        catch {
            // ignore
        }
        const parentDir = path_1.default.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }
    return null;
}
async function loadMergedEnv(startDir = process.cwd()) {
    const envPath = findDotEnvPath(startDir);
    let fileEnv = {};
    if (envPath) {
        try {
            const raw = await fs_1.promises.readFile(envPath, 'utf8');
            fileEnv = parseDotEnv(raw);
        }
        catch {
            // ignore
        }
    }
    return { ...fileEnv, ...process.env };
}
function resolveWebsiteAuthUrl(env) {
    const explicit = env.JULION_WEBSITE_AUTH_URL || env.JULION_AUTH_URL || env.JULION_SITE_URL || env.JULION_WEB_URL;
    if (explicit) {
        const trimmed = explicit.replace(/\/$/, '');
        if (trimmed.endsWith('/api/auth/google'))
            return trimmed;
        if (trimmed.endsWith('/auth/google'))
            return trimmed.replace(/\/auth\/google$/, '/api/auth/google');
        return `${trimmed}/api/auth/google`;
    }
    return 'https://julion.vercel.app/api/auth/google';
}
function resolveGoogleRedirectUri(env) {
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
function resolvePublicBaseUrl(env) {
    if (env.JULION_SITE_URL || env.JULION_WEB_URL) {
        return (env.JULION_SITE_URL || env.JULION_WEB_URL || '').replace(/\/$/, '');
    }
    if (env.GOOGLE_REDIRECT_URI) {
        const redirect = env.GOOGLE_REDIRECT_URI.replace(/\/$/, '');
        if (redirect.endsWith('/auth/google/callback')) {
            return redirect.slice(0, -'/auth/google/callback'.length);
        }
        if (redirect.endsWith('/api/auth/callback')) {
            return redirect.slice(0, -'/api/auth/callback'.length);
        }
        return redirect;
    }
    return 'https://julion.vercel.app';
}
//# sourceMappingURL=env.js.map