import jwt from "jsonwebtoken";
import { parse as parseCookies } from "cookie";

const COOKIE_NAME = "julion_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function secret() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return process.env.JWT_SECRET;
}

export function signToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: "7d" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

export function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}

export function getTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[COOKIE_NAME] || null;
}

export function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

// Returns user or sends 401 and returns null
export function requireAuth(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ success: false, data: null, error: "Unauthorized" });
    return null;
  }
  return user;
}
