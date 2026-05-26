import { Connection } from 'mysql2/promise';
export interface DatabaseConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}
export interface JulionUser {
    email: string;
    name: string;
    picture?: string;
}
export interface AuthSessionGoogleConfig {
    client_id: string | null;
    client_secret: string | null;
    redirect_uri: string | null;
}
export interface AuthSessionResult {
    sessionId: string;
    token: Record<string, unknown>;
    user_email: string;
    user_name: string;
    user_picture?: string;
    google_config?: AuthSessionGoogleConfig;
}
export declare function loadDatabaseConfig(startDir?: string): Promise<DatabaseConfig | null>;
export declare function getDbConnection(startDir?: string): Promise<Connection>;
export declare function ensureAuthTables(connection: Connection): Promise<void>;
export declare function createSessionId(): string;
export declare function createAuthSession(sessionId: string, startDir?: string): Promise<void>;
export declare function upsertUser(user: JulionUser, startDir?: string): Promise<void>;
export declare function saveUserDriveToken(userEmail: string, token: unknown, startDir?: string): Promise<void>;
export declare function loadUserDriveToken(userEmail: string, startDir?: string): Promise<Record<string, unknown> | null>;
export declare function deleteUserDriveToken(userEmail: string, startDir?: string): Promise<void>;
export declare function completeAuthSession(sessionId: string, token: unknown, user: JulionUser, startDir?: string): Promise<void>;
export declare function claimAuthSession(sessionId: string, startDir?: string): Promise<AuthSessionResult | null>;
export declare function getAuthSessionStatus(sessionId: string, startDir?: string): Promise<'pending' | 'complete' | 'claimed' | 'missing' | 'expired'>;
export declare function getAuthSession(sessionId: string, startDir?: string): Promise<AuthSessionResult | null>;
export declare function waitForAuthSession(sessionId: string, timeoutMs?: number, startDir?: string): Promise<AuthSessionResult>;
//# sourceMappingURL=auth-store.d.ts.map