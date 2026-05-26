export declare const GOOGLE_DRIVE_SCOPES: string[];
export interface GoogleClientConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}
export declare function loadGoogleClientConfig(startDir?: string): Promise<GoogleClientConfig>;
//# sourceMappingURL=google-config.d.ts.map