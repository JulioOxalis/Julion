import { clearAuthCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, data: null, error: "Method not allowed" });
  }
  clearAuthCookie(res);
  return res.redirect("/");
}
