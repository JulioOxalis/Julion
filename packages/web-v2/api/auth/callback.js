import { google } from "googleapis";
import { getGoogleOAuthClient } from "../../lib/drive.js";
import { signToken, setAuthCookie } from "../../lib/auth.js";
import clientPromise from "../../db/client.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const { code, state } = req.query;
  if (!code) {
    return res.status(400).json({ success: false, data: null, error: "Missing code parameter" });
  }

  let statePayload = {};
  try {
    statePayload = JSON.parse(Buffer.from(state || "", "base64url").toString("utf8"));
  } catch { /* state is optional */ }

  try {
    // Exchange code for tokens
    const auth = getGoogleOAuthClient();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    // Fetch Google user info
    const oauth2 = google.oauth2({ version: "v2", auth });
    const { data: gUser } = await oauth2.userinfo.get();
    if (!gUser.email) {
      return res.status(400).json({ success: false, data: null, error: "No email from Google" });
    }

    const user = {
      email:   gUser.email,
      name:    gUser.name || gUser.email,
      picture: gUser.picture || null,
    };

    // Issue JWT immediately — embed Drive tokens so Drive ops never need MongoDB
    const jwtToken = signToken({
      email:      user.email,
      name:       user.name,
      picture:    user.picture,
      driveToken: JSON.stringify(tokens),
    });
    setAuthCookie(res, jwtToken);

    // CLI session: MUST be written before redirect — Vercel kills the function on res.redirect()
    if (statePayload.cliSession) {
      try {
        const db = (await clientPromise).db(process.env.DB_NAME);
        await db.collection("auth_sessions").updateOne(
          { sessionId: statePayload.cliSession },
          {
            $set: {
              status:      "complete",
              tokenJson:   JSON.stringify(tokens),
              userEmail:   user.email,
              userName:    user.name,
              userPicture: user.picture,
            },
            $setOnInsert: {
              sessionId: statePayload.cliSession,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
          },
          { upsert: true }
        );
      } catch (err) {
        console.error("[auth/callback] cli session write failed:", err);
      }
    }

    // Non-critical MongoDB ops — best-effort, background
    (async () => {
      try {
        const db = (await clientPromise).db(process.env.DB_NAME);
        await db.collection("members").updateOne(
          { email: user.email },
          {
            $set:         { name: user.name, picture: user.picture, lastLoginAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        );
        await db.collection("user_tokens").updateOne(
          { userEmail: user.email },
          { $set: { tokenJson: JSON.stringify(tokens), updatedAt: new Date() } },
          { upsert: true }
        );
      } catch { /* non-fatal */ }
    })();

    return res.redirect(statePayload.cliSession ? "/auth-complete" : "/dashboard");
  } catch (err) {
    console.error("[auth/callback]", err);
    return res.status(500).json({ success: false, data: null, error: err.message || "Authentication failed", stack: err.stack?.split("\n").slice(0,3) });
  }
}
