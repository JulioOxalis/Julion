import { getUserFromRequest } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: "Unauthorized" });
  }

  return res.status(200).json({
    success: true,
    data: { email: user.email, name: user.name, picture: user.picture || null },
    error: null,
  });
}
