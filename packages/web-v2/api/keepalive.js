import clientPromise from "../db/client.js";

export default async function handler(req, res) {
  try {
    const db = (await clientPromise).db(process.env.DB_NAME);
    await db.command({ ping: 1 });
    return res.status(200).json({ success: true, data: { status: "ok" } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
