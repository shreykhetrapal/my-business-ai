import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionMaterial(secret = process.env.KEY_ENCRYPTION_SECRET) {
  const source = secret || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-key-encryption-secret";
  return createHash("sha256").update(String(source)).digest();
}

export function encryptSecret(plainText, secret = process.env.KEY_ENCRYPTION_SECRET) {
  const value = String(plainText || "");
  if (!value) return "";

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionMaterial(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(encryptedValue, secret = process.env.KEY_ENCRYPTION_SECRET) {
  const value = String(encryptedValue || "");
  if (!value) return "";

  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionMaterial(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}
