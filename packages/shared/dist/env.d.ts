export declare function parseDotEnv(content: string): Record<string, string>;
export declare function findDotEnvPath(startDir?: string): string | null;
export declare function loadMergedEnv(startDir?: string): Promise<Record<string, string>>;
export declare function resolveWebsiteAuthUrl(env: Record<string, string>): string;
export declare function resolveGoogleRedirectUri(env: Record<string, string>): string;
export declare function resolvePublicBaseUrl(env: Record<string, string>): string;
//# sourceMappingURL=env.d.ts.map