import crypto from "node:crypto";

export function twilioSignatureUrl(request, pathname, env = process.env) {
  const configuredBase = env.PUBLIC_BASE_URL || "";
  if (configuredBase) return `${configuredBase.replace(/\/$/, "")}${pathname}`;
  const host = request.headers.host || "localhost";
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}${pathname}`;
}

export function computeTwilioSignature({ url, params = {}, authToken }) {
  const data = `${url}${Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key] ?? ""}`)
    .join("")}`;
  return crypto.createHmac("sha1", authToken).update(data).digest("base64");
}

export function validateTwilioSignature({ request, pathname, params, env = process.env }) {
  const mode = env.MESSAGING_MODE || env.TELEPHONY_MODE || "dry-run";
  if (mode !== "live") return true;
  if (env.TWILIO_VALIDATE_SIGNATURE === "false") return true;
  const authToken = env.TWILIO_AUTH_TOKEN || "";
  if (!authToken) return false;
  const provided = request.headers["x-twilio-signature"] || "";
  if (!provided) return false;
  const expected = computeTwilioSignature({
    url: twilioSignatureUrl(request, pathname, env),
    params,
    authToken
  });
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
