import { google } from "googleapis";
import clientPromise from "../db/client.js";

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid",
  "email",
  "profile",
];

export async function getDriveForUser(userEmail, driveTokenJson = null) {
  let tokenJson = driveTokenJson;

  if (!tokenJson) {
    // Fallback: read from MongoDB (old sessions without embedded token)
    try {
      const db = (await clientPromise).db(process.env.DB_NAME);
      const doc = await db.collection("user_tokens").findOne({ userEmail });
      tokenJson = doc?.tokenJson || null;
    } catch { /* MongoDB unavailable */ }
  }

  if (!tokenJson) throw new Error("no_token");

  const auth  = getGoogleOAuthClient();
  const token = JSON.parse(tokenJson);
  auth.setCredentials(token);

  // Best-effort: save refreshed tokens back to MongoDB when they arrive
  auth.on("tokens", async (refreshed) => {
    const merged = JSON.stringify({ ...token, ...refreshed });
    try {
      const db = (await clientPromise).db(process.env.DB_NAME);
      await db.collection("user_tokens").updateOne(
        { userEmail },
        { $set: { tokenJson: merged, updatedAt: new Date() } }
      );
    } catch { /* non-fatal */ }
  });

  return google.drive({ version: "v3", auth });
}

// Pass the JWT user payload directly — reads driveToken from it, no MongoDB needed
export function getDriveForJWT(user) {
  if (!user) throw new Error("no_token");
  return getDriveForUser(user.email, user.driveToken || null);
}

export async function getJulionRoot(drive) {
  const res = await drive.files.list({
    q: "name='JULION' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false",
    fields: "files(id,name)",
    spaces: "drive",
  });
  const folder = res.data.files?.[0];
  if (!folder) throw new Error("JULION folder not found on Google Drive");
  return folder;
}

export async function listRepositories(drive) {
  const root = await getJulionRoot(drive);
  const res = await drive.files.list({
    q: `'${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    spaces: "drive",
    orderBy: "modifiedTime desc",
  });
  return res.data.files || [];
}

export async function listSnapshots(drive, repoName) {
  const root = await getJulionRoot(drive);
  const repoRes = await drive.files.list({
    q: `name='${repoName.replace(/'/g, "\\'")}' and '${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
  });
  const repo = repoRes.data.files?.[0];
  if (!repo) return [];

  const snapRes = await drive.files.list({
    q: `'${repo.id}' in parents and trashed=false`,
    fields: "files(id,name,size,modifiedTime,mimeType)",
    spaces: "drive",
    orderBy: "modifiedTime desc",
  });
  return snapRes.data.files || [];
}
