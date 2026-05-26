import clientPromise from "../../../db/client.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, data: null, error: "Missing session ID" });
  }

  try {
    const db      = (await clientPromise).db(process.env.DB_NAME);
    const session = await db.collection("auth_sessions").findOne({ sessionId: id });

    if (!session) {
      return res.status(404).json({ success: false, data: null, error: "Session not found" });
    }

    if (new Date(session.expiresAt) <= new Date()) {
      return res.status(410).json({ success: false, data: null, error: "Session expired" });
    }

    if (session.status === "pending") {
      return res.status(202).json({ success: true, data: { status: "pending" }, error: null });
    }

    if (session.status === "claimed") {
      return res.status(410).json({ success: false, data: null, error: "Session already claimed" });
    }

    if (session.status === "complete" && session.tokenJson && session.userEmail) {
      // Atomically mark as claimed
      const updated = await db.collection("auth_sessions").findOneAndUpdate(
        { sessionId: id, status: "complete" },
        { $set: { status: "claimed" } },
        { returnDocument: "after" }
      );
      if (!updated) {
        return res.status(410).json({ success: false, data: null, error: "Session already claimed" });
      }
      return res.status(200).json({
        success: true,
        data: {
          sessionId:    id,
          token:        JSON.parse(session.tokenJson),
          user_email:   session.userEmail,
          user_name:    session.userName || session.userEmail,
          user_picture: session.userPicture || null,
          google_config: {
            client_id:     process.env.GOOGLE_CLIENT_ID     || null,
            client_secret: process.env.GOOGLE_CLIENT_SECRET || null,
            redirect_uri:  process.env.GOOGLE_REDIRECT_URI  || null,
          },
        },
        error: null,
      });
    }

    return res.status(202).json({ success: true, data: { status: "pending" }, error: null });
  } catch (err) {
    console.error("[auth/session]", err);
    return res.status(500).json({ success: false, data: null, error: "Internal error" });
  }
}
