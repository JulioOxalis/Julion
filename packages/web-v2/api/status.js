import clientPromise from "../db/client.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  let dbStatus = "disconnected";
  try {
    const client = await clientPromise;
    await client.db(process.env.DB_NAME).command({ ping: 1 });
    dbStatus = "connected";
  } catch { /* db unreachable */ }

  return res.status(200).json({
    success: true,
    data: {
      status:    "ok",
      database:  dbStatus,
      timestamp: new Date().toISOString(),
    },
    error: null,
  });
}
