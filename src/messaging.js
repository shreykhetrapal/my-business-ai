import crypto from "node:crypto";

const supportedChannels = new Set(["sms", "whatsapp"]);
const supportedFallbackChannels = new Set(["sms", "call"]);
const whatsappCampaignTypes = new Set(["event", "sale", "appointment", "followup", "order", "custom"]);
const whatsappTemplateCategories = new Set(["marketing", "utility", "authentication"]);

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeChannel(value) {
  const channel = text(value).toLowerCase();
  return supportedChannels.has(channel) ? channel : "";
}

export function normalizeWhatsappCampaignType(value, fallback = "event") {
  const type = text(value).toLowerCase().replaceAll("-", "_");
  if (whatsappCampaignTypes.has(type)) return type;
  if (type === "requested_followup" || type === "follow_up") return "followup";
  if (type === "booking" || type === "appointment_booking") return "appointment";
  if (type === "reservation" || type === "pickup") return "order";
  return whatsappCampaignTypes.has(fallback) ? fallback : "event";
}

export function normalizeWhatsappTemplateCategory(value) {
  const category = text(value).toLowerCase();
  return whatsappTemplateCategories.has(category) ? category : "marketing";
}

export function normalizeFallbackChannels(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((item) => text(item).toLowerCase()).filter((item) => supportedFallbackChannels.has(item)))];
}

export function normalizePhoneAddress(value) {
  const raw = text(value);
  if (!raw) return "";
  return raw.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
}

export function countryCodeForPhone(value) {
  const address = normalizePhoneAddress(value);
  if (address.startsWith("+91")) return "IN";
  if (address.startsWith("+1")) return "US";
  return address ? "OTHER" : "";
}

export function countryLabelForPhone(value) {
  const country = countryCodeForPhone(value);
  if (country === "US") return "US";
  if (country === "IN") return "India";
  if (country === "OTHER") return "International";
  return "Unknown";
}

export function formatAddress(channel, value) {
  const normalizedChannel = normalizeChannel(channel);
  const address = text(value);
  if (normalizedChannel === "whatsapp") {
    return address.toLowerCase().startsWith("whatsapp:") ? address : `whatsapp:${address}`;
  }
  return address.replace(/^whatsapp:/i, "");
}

export function renderMessageTemplate(template, { business = {}, campaign = {}, contact = {} } = {}) {
  const replacements = {
    customer_name: contact.name || "there",
    customer_phone: contact.phone || "",
    business_name: business.name || "",
    caller_id: business.callerId || business.name || "",
    campaign_name: campaign.name || "",
    event_time: campaign.eventDate || "",
    location: campaign.location || "",
    offer: campaign.offer || ""
  };

  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return Object.hasOwn(replacements, key) ? replacements[key] : match;
  });
}

export function parseTemplateVariables(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function renderContentVariables(mapping, context) {
  return Object.fromEntries(
    Object.entries(parseTemplateVariables(mapping)).map(([key, value]) => [key, renderMessageTemplate(value, context)])
  );
}

export function normalizeSupportedCountries(value) {
  const raw = Array.isArray(value) ? value : String(value || "ALL").split(",");
  const countries = raw
    .map((item) => text(item).toUpperCase().replace(/\s+/g, "_"))
    .filter(Boolean);
  return [...new Set(countries.length ? countries : ["ALL"])];
}

export function templateSupportsCountry(template, countryCode) {
  const countries = normalizeSupportedCountries(template?.supportedCountries || ["ALL"]);
  if (countries.includes("ALL")) return true;
  if (countryCode && countries.includes(countryCode)) return true;
  if (countryCode && countryCode !== "US" && countries.includes("NON_US")) return true;
  return false;
}

export function resolveWhatsappTemplate(templates = [], { workspaceId = "", campaignType = "event", templateId = "", countryCode = "" } = {}) {
  const normalizedType = normalizeWhatsappCampaignType(campaignType);
  const candidates = (templates || []).filter((template) => template.workspaceId === workspaceId && template.active !== false);
  if (templateId) {
    return candidates.find((template) => template.id === templateId) || null;
  }
  return (
    candidates.find((template) => {
      const types = Array.isArray(template.campaignTypes) && template.campaignTypes.length ? template.campaignTypes : [template.campaignType || "custom"];
      return types.map((type) => normalizeWhatsappCampaignType(type)).includes(normalizedType) && templateSupportsCountry(template, countryCode);
    }) || null
  );
}

export function isWhatsappTemplateBlockedForRecipient(template, contact = {}) {
  if (!template) return false;
  return normalizeWhatsappTemplateCategory(template.category) === "marketing" && countryCodeForPhone(contact.phone) === "US";
}

export function serviceWindowExpiryFrom(value = new Date()) {
  const base = value instanceof Date ? value : new Date(value);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(safeBase.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function isWhatsappServiceWindowOpen(thread = {}, value = new Date()) {
  if (!thread || thread.channel !== "whatsapp" || !thread.serviceWindowExpiresAt) return false;
  const now = value instanceof Date ? value : new Date(value);
  const expires = new Date(thread.serviceWindowExpiresAt);
  return !Number.isNaN(now.getTime()) && !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
}

export function friendlyMessagingError(codeOrMessage = "") {
  const value = String(codeOrMessage || "");
  if (value === "63049" || value.includes("63049")) {
    return "Meta limited or blocked this WhatsApp marketing template. Use calls/SMS for US marketing, or retry non-US marketing later.";
  }
  return value;
}

export function isMessagingOptOut(value) {
  const lower = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!lower) return false;

  const exact = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", " बंद", "band", "nahi"]);
  if (exact.has(lower)) return true;

  return [
    /\bstop\b/,
    /\bunsubscribe\b/,
    /\bopt\s*out\b/,
    /\bdo not (text|message|whatsapp|contact)\b/,
    /\bdon'?t (text|message|whatsapp|contact)\b/,
    /\bno more (texts|messages|whatsapp)\b/,
    /\bremove me\b/,
    /\bwhatsapp mat\b/,
    /\bmessage mat\b/,
    /\bcall mat\b/,
    /मत भेज/,
    /बंद करो/
  ].some((pattern) => pattern.test(lower));
}

export function channelOptedOut(contact, channel) {
  if (!contact || contact.optedOut) return true;
  const normalizedChannel = normalizeChannel(channel);
  return Boolean(normalizedChannel && contact.channelOptOuts?.[normalizedChannel]);
}

export function setChannelOptOut(contact, channel, optedOut = true) {
  if (!contact) return contact;
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel) return contact;
  contact.channelOptOuts ||= {};
  if (optedOut) {
    contact.channelOptOuts[normalizedChannel] = true;
  } else {
    delete contact.channelOptOuts[normalizedChannel];
  }
  return contact;
}

export function resolveMessagingSender(state, workspaceId, channel) {
  const normalizedChannel = normalizeChannel(channel);
  const candidates = (state.messagingSenders || []).filter(
    (sender) => sender.workspaceId === workspaceId && sender.channel === normalizedChannel && sender.active !== false
  );
  return candidates.find((sender) => sender.isDefault) || candidates[0] || null;
}

export function getMessagingConfig(env = process.env) {
  const mode = env.MESSAGING_MODE || env.TELEPHONY_MODE || "dry-run";
  const provider = env.MESSAGING_PROVIDER || env.TELEPHONY_PROVIDER || "twilio";
  const publicBaseUrl = env.PUBLIC_BASE_URL || "";
  return {
    mode,
    provider,
    publicBaseUrl,
    liveReady:
      mode === "live" &&
      provider === "twilio" &&
      Boolean(env.TWILIO_ACCOUNT_SID) &&
      Boolean(env.TWILIO_AUTH_TOKEN) &&
      Boolean(publicBaseUrl)
  };
}

export class MessagingAdapter {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.env = env;
    this.fetch = fetchImpl;
    this.config = getMessagingConfig(env);
  }

  status() {
    return {
      mode: this.config.mode,
      provider: this.config.provider,
      liveReady: this.config.liveReady,
      publicBaseUrl: this.config.publicBaseUrl || null
    };
  }

  statusCallbackUrl(messageLogId) {
    if (!this.config.publicBaseUrl || !messageLogId) return "";
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/messaging/status/${messageLogId}`;
  }

  async sendMessage({ channel, to, body = "", contentSid = "", contentVariables = {}, sender, messageLogId }) {
    const normalizedChannel = normalizeChannel(channel);
    if (!normalizedChannel) throw new Error("A valid messaging channel is required.");
    if (!sender) throw new Error(`No ${normalizedChannel.toUpperCase()} sender is assigned to this workspace.`);
    if (!sender.fromAddress && !sender.messagingServiceSid) {
      throw new Error("Messaging sender needs either a From address or Messaging Service SID.");
    }

    if (this.config.mode !== "live") {
      return {
        provider: this.config.provider,
        providerMessageId: `dry_msg_${messageLogId || crypto.randomUUID()}`,
        status: "queued_local",
        note: "Dry-run mode queued the message without contacting Twilio."
      };
    }

    if (this.config.provider !== "twilio") {
      throw new Error(`Unsupported messaging provider: ${this.config.provider}`);
    }
    if (!this.config.liveReady) {
      throw new Error("Live messaging requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and PUBLIC_BASE_URL.");
    }

    const accountSid = this.env.TWILIO_ACCOUNT_SID;
    const authToken = this.env.TWILIO_AUTH_TOKEN;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const payload = new URLSearchParams({
      To: formatAddress(normalizedChannel, to)
    });

    if (sender.messagingServiceSid) payload.set("MessagingServiceSid", sender.messagingServiceSid);
    else payload.set("From", formatAddress(normalizedChannel, sender.fromAddress));

    const callbackUrl = this.statusCallbackUrl(messageLogId);
    if (callbackUrl) payload.set("StatusCallback", callbackUrl);

    if (normalizedChannel === "whatsapp" && contentSid) {
      payload.set("ContentSid", contentSid);
      payload.set("ContentVariables", JSON.stringify(contentVariables || {}));
    } else {
      const messageBody = text(body);
      if (!messageBody) throw new Error("Message body is required.");
      payload.set("Body", messageBody);
    }

    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `Twilio message request failed with ${response.status}.`);
    }

    return {
      provider: "twilio",
      providerMessageId: result.sid,
      status: result.status || "queued"
    };
  }
}
