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
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
  "profile",
];

export async function getDriveForUser(userEmail) {
  const db = (await clientPromise).db(process.env.DB_NAME);
  const tokenDoc = await db.collection("user_tokens").findOne({ userEmail });
  if (!tokenDoc?.tokenJson) throw new Error("no_token");

  const auth = getGoogleOAuthClient();
  const token = JSON.parse(tokenDoc.tokenJson);
  auth.setCredentials(token);

  // Persist refreshed tokens automatically
  auth.on("tokens", async (refreshed) => {
    const merged = { ...token, ...refreshed };
    await db
      .collection("user_tokens")
      .updateOne(
        { userEmail },
        { $set: { tokenJson: JSON.stringify(merged), updatedAt: new Date() } }
      )
      .catch(() => {});
  });

  return google.drive({ version: "v3", auth });
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
