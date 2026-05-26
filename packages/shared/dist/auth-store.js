"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDatabaseConfig = loadDatabaseConfig;
exports.getDbConnection = getDbConnection;
exports.ensureAuthTables = ensureAuthTables;
exports.createSessionId = createSessionId;
exports.createAuthSession = createAuthSession;
exports.upsertUser = upsertUser;
exports.saveUserDriveToken = saveUserDriveToken;
exports.loadUserDriveToken = loadUserDriveToken;
exports.deleteUserDriveToken = deleteUserDriveToken;
exports.completeAuthSession = completeAuthSession;
exports.claimAuthSession = claimAuthSession;
exports.getAuthSessionStatus = getAuthSessionStatus;
exports.getAuthSession = getAuthSession;
exports.waitForAuthSession = waitForAuthSession;
const crypto_1 = __importDefault(require("crypto"));
const promise_1 = __importDefault(require("mysql2/promise"));
const env_1 = require("./env");
const SESSION_TTL_MINUTES = 15;
async function loadDatabaseConfig(startDir) {
    const env = await (0, env_1.loadMergedEnv)(startDir);
    const host = env.DB_HOST || env.MYSQL_HOST;
    const user = env.DB_USER || env.MYSQL_USER;
    const password = env.DB_PASSWORD ?? env.MYSQL_PASSWORD ?? '';
    const database = env.DB_DATABASE || env.MYSQL_DATABASE;
    const port = env.DB_PORT ? Number(env.DB_PORT) : 3306;
    if (!user || !database) {
        return null;
    }
    return { host: host || '127.0.0.1', port, user, password, database };
}
async function getDbConnection(startDir) {
    const config = await loadDatabaseConfig(startDir);
    if (!config) {
        throw new Error('MySQL is not configured. Set DB_USER and DB_DATABASE in your .env file.');
    }
    const connection = await promise_1.default.createConnection(config);
    await ensureAuthTables(connection);
    return connection;
}
async function ensureAuthTables(connection) {
    await connection.execute(`
    CREATE TABLE IF NOT EXISTS julion_users (
      email VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      picture VARCHAR(512) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
    await connection.execute(`
    CREATE TABLE IF NOT EXISTS julion_auth_sessions (
      session_id VARCHAR(64) PRIMARY KEY,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      token_json LONGTEXT NULL,
      user_email VARCHAR(255) NULL,
      user_name VARCHAR(255) NULL,
      user_picture VARCHAR(512) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      INDEX idx_status_expires (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
    await connection.execute(`
    CREATE TABLE IF NOT EXISTS julion_user_tokens (
      user_email VARCHAR(255) PRIMARY KEY,
      token_json LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
function createSessionId() {
    return crypto_1.default.randomBytes(24).toString('hex');
}
async function createAuthSession(sessionId, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        await connection.execute(`INSERT INTO julion_auth_sessions (session_id, status, expires_at)
       VALUES (?, 'pending', DATE_ADD(NOW(), INTERVAL ? MINUTE))
       ON DUPLICATE KEY UPDATE
         status = 'pending',
         token_json = NULL,
         user_email = NULL,
         user_name = NULL,
         user_picture = NULL,
         expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)`, [sessionId, SESSION_TTL_MINUTES, SESSION_TTL_MINUTES]);
    }
    finally {
        await connection.end();
    }
}
async function upsertUser(user, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        await connection.execute(`INSERT INTO julion_users (email, name, picture, last_login_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         picture = VALUES(picture),
         last_login_at = NOW()`, [user.email, user.name, user.picture ?? null]);
    }
    finally {
        await connection.end();
    }
}
async function saveUserDriveToken(userEmail, token, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        const payload = JSON.stringify(token);
        await connection.execute(`INSERT INTO julion_user_tokens (user_email, token_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE token_json = VALUES(token_json), updated_at = CURRENT_TIMESTAMP`, [userEmail, payload]);
    }
    finally {
        await connection.end();
    }
}
async function loadUserDriveToken(userEmail, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        const [rows] = await connection.execute('SELECT token_json FROM julion_user_tokens WHERE user_email = ? LIMIT 1', [userEmail]);
        if (!rows.length || !rows[0].token_json) {
            return null;
        }
        return JSON.parse(String(rows[0].token_json));
    }
    catch {
        return null;
    }
    finally {
        await connection.end();
    }
}
async function deleteUserDriveToken(userEmail, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        await connection.execute('DELETE FROM julion_user_tokens WHERE user_email = ?', [userEmail]);
    }
    finally {
        await connection.end();
    }
}
async function completeAuthSession(sessionId, token, user, startDir) {
    await upsertUser(user, startDir);
    await saveUserDriveToken(user.email, token, startDir);
    const connection = await getDbConnection(startDir);
    try {
        await connection.execute(`UPDATE julion_auth_sessions
       SET status = 'complete',
           token_json = ?,
           user_email = ?,
           user_name = ?,
           user_picture = ?
       WHERE session_id = ? AND status = 'pending' AND expires_at > NOW()`, [JSON.stringify(token), user.email, user.name, user.picture ?? null, sessionId]);
    }
    finally {
        await connection.end();
    }
}
async function claimAuthSession(sessionId, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(`SELECT session_id, status, token_json, user_email, user_name, user_picture
       FROM julion_auth_sessions
       WHERE session_id = ? AND status = 'complete' AND expires_at > NOW()
       LIMIT 1
       FOR UPDATE`, [sessionId]);
        const row = rows[0];
        if (!row || !row.token_json || !row.user_email) {
            await connection.rollback();
            return null;
        }
        await connection.execute(`UPDATE julion_auth_sessions SET status = 'claimed' WHERE session_id = ?`, [sessionId]);
        await connection.commit();
        return {
            sessionId: row.session_id,
            token: JSON.parse(row.token_json),
            user_email: row.user_email,
            user_name: row.user_name || row.user_email,
            user_picture: row.user_picture || undefined
        };
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        await connection.end();
    }
}
async function getAuthSessionStatus(sessionId, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        const [rows] = await connection.execute(`SELECT status, expires_at
       FROM julion_auth_sessions
       WHERE session_id = ?
       LIMIT 1`, [sessionId]);
        const row = rows[0];
        if (!row) {
            return 'missing';
        }
        if (row.status === 'claimed') {
            return 'claimed';
        }
        if (new Date(row.expires_at) <= new Date()) {
            return 'expired';
        }
        if (row.status === 'complete') {
            return 'complete';
        }
        return 'pending';
    }
    finally {
        await connection.end();
    }
}
async function getAuthSession(sessionId, startDir) {
    const connection = await getDbConnection(startDir);
    try {
        const [rows] = await connection.execute(`SELECT session_id, status, token_json, user_email, user_name, user_picture
       FROM julion_auth_sessions
       WHERE session_id = ? AND expires_at > NOW()
       LIMIT 1`, [sessionId]);
        const row = rows[0];
        if (!row || row.status !== 'complete' || !row.token_json || !row.user_email) {
            return null;
        }
        return {
            sessionId: row.session_id,
            token: JSON.parse(row.token_json),
            user_email: row.user_email,
            user_name: row.user_name || row.user_email,
            user_picture: row.user_picture || undefined
        };
    }
    catch {
        return null;
    }
    finally {
        await connection.end();
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForAuthSessionHttp(baseUrl, sessionId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/api/auth/session/${encodeURIComponent(sessionId)}`;
    while (Date.now() < deadline) {
        const response = await fetch(endpoint, { method: 'GET' });
        if (response.status === 202) {
            await sleep(2000);
            continue;
        }
        if (response.status === 410 || response.status === 404) {
            throw new Error('Login session expired or not found. Run `julion connect google --website` again.');
        }
        if (response.ok) {
            const json = (await response.json());
            // Unwrap {success, data} envelope if present
            const payload = json?.data ?? json;
            if (payload?.token && payload?.user_email) {
                return {
                    sessionId: payload.sessionId || sessionId,
                    token: payload.token,
                    user_email: payload.user_email,
                    user_name: payload.user_name || payload.user_email,
                    user_picture: payload.user_picture || undefined,
                    google_config: payload.google_config || undefined,
                };
            }
        }
        await sleep(2000);
    }
    throw new Error('Timed out waiting for website login. Open the browser, sign in with Google, and try again.');
}
async function waitForAuthSession(sessionId, timeoutMs = 180000, startDir) {
    const env = await (0, env_1.loadMergedEnv)(startDir);
    const baseUrl = (0, env_1.resolvePublicBaseUrl)(env);
    try {
        return await waitForAuthSessionHttp(baseUrl, sessionId, timeoutMs);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const canUseDatabase = message.includes('fetch failed') ||
            message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND');
        if (!canUseDatabase) {
            throw error;
        }
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await claimAuthSession(sessionId, startDir);
        if (result) {
            return result;
        }
        const status = await getAuthSessionStatus(sessionId, startDir);
        if (status === 'claimed' || status === 'expired' || status === 'missing') {
            break;
        }
        await sleep(2000);
    }
    throw new Error('Timed out waiting for website login. Open the browser, sign in with Google, and try again.');
}
//# sourceMappingURL=auth-store.js.map