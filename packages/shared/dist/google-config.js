"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOOGLE_DRIVE_SCOPES = void 0;
exports.loadGoogleClientConfig = loadGoogleClientConfig;
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./env");
exports.GOOGLE_DRIVE_SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
];
const CREDENTIALS_PATH = path_1.default.join(os_1.default.homedir(), '.julion', 'google-client.json');
async function readJson(filePath) {
    try {
        const raw = await fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function loadGoogleClientConfig(startDir) {
    const env = await (0, env_1.loadMergedEnv)(startDir);
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const redirectUri = (0, env_1.resolveGoogleRedirectUri)(env);
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
    throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.');
}
//# sourceMappingURL=google-config.js.map