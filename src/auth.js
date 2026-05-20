import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const cookieName = "callerdesk_session";
const sessionTtlSeconds = 60 * 60 * 24 * 7;

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-session-secret";
}

function sign(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function authEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(String(password), salt, 32).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPasswordHash(password, passwordHash) {
  if (!passwordHash) return false;
  const [scheme, salt, expectedHash] = String(passwordHash).split(":");
  if (scheme !== "scrypt" || !salt || !expectedHash) return false;
  const actual = scryptSync(String(password), salt, 32).toString("base64url");
  return safeEqual(actual, expectedHash);
}

export function createSessionCookie(user = {}) {
  const payload = encodePayload({
    userId: user.id || "admin",
    role: user.role || "admin",
    workspaceId: user.workspaceId || "",
    exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds
  });
  const value = `${payload}.${sign(payload)}`;
  return `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionTtlSeconds}`;
}

export function clearSessionCookie() {
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function getSession(request) {
  if (!authEnabled()) return true;

  const value = parseCookies(request.headers.cookie)[cookieName];
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;

  const session = decodePayload(payload);
  if (!session || !session.userId || !session.exp) return null;
  if (session.exp < Math.floor(Date.now() / 1000)) return null;
  return session;
}

export function isAuthenticated(request, users = []) {
  if (!authEnabled()) return true;
  const session = getSession(request);
  if (!session) return false;
  return users.length === 0 || users.some((user) => user.id === session.userId);
}

export function verifyPassword(password) {
  if (!authEnabled()) return true;
  return safeEqual(password, process.env.ADMIN_PASSWORD);
}

export function verifyLogin({ email, password, users = [] }) {
  if (!authEnabled()) {
    return users.find((user) => user.role === "admin") || users[0] || null;
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = users.find((item) => String(item.email || "").toLowerCase() === normalizedEmail);
  if (user && verifyPasswordHash(password, user.passwordHash)) {
    return user;
  }

  const admin = users.find((item) => item.role === "admin");
  if (!normalizedEmail && admin && verifyPassword(password)) {
    return admin;
  }

  return null;
}
