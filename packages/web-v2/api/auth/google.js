import crypto from "crypto";
import { getGoogleOAuthClient, DRIVE_SCOPES } from "../../lib/drive.js";
import clientPromise from "../../db/client.js";

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  try {
    const cliSession = req.query.cli_session || null;
    const state = Buffer.from(
      JSON.stringify({ nonce: crypto.randomBytes(16).toString("hex"), cliSession })
    ).toString("base64url");

    const auth = getGoogleOAuthClient();
    const url  = auth.generateAuthUrl({
      access_type: "offline",
      prompt:      "consent",
      scope:       DRIVE_SCOPES,
      state,
    });

    // Register CLI session in DB so callback can complete it
    if (cliSession) {
      const db = (await clientPromise).db(process.env.DB_NAME);
      await db.collection("auth_sessions").updateOne(
        { sessionId: cliSession },
        {
          $set: {
            sessionId:   cliSession,
            status:      "pending",
            tokenJson:   null,
            userEmail:   null,
            userName:    null,
            userPicture: null,
            createdAt:   new Date(),
            expiresAt:   new Date(Date.now() + SESSION_TTL_MS),
          },
        },
        { upsert: true }
      );
    }

    return res.redirect(url);
  } catch (err) {
    console.error("[auth/google]", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to initiate OAuth" });
  }
}
