import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { answerQuestion, renderCallScript } from "./assistant.js";
import {
  authEnabled,
  clearSessionCookie,
  createSessionCookie,
  getSession,
  hashPassword,
  isAuthenticated,
  verifyLogin
} from "./auth.js";
import { setContactCallPermission } from "./contactPermissions.js";
import { decryptSecret, encryptSecret, maskSecret } from "./cryptoSecrets.js";
import { importContactsFromCsv } from "./csv.js";
import { ensureFollowUp } from "./followUps.js";
import { handleRealtimeMediaStream, isCustomerEndIntent } from "./realtimeBridge.js";
import { createId, nowIso, scopeStateToWorkspace, SQLiteStore, workspaceCallReadinessError } from "./store.js";
import { TelephonyAdapter } from "./telephony.js";
import { appendTranscriptEntry, transcriptEntries } from "./transcripts.js";
import { acceptWebSocketUpgrade } from "./websocket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");
let defaultStore = null;
let defaultTelephony = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendJsonWithHeaders(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(payload);
}

function notFound(response) {
  sendJson(response, 404, { error: "Not found" });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = request.headers["content-type"] || "";

  if (type.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

function createHandlers({ store, telephony }) {
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    workspaceId: user.workspaceId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function workspaceById(workspaceId) {
  return store.state.workspaces.find((workspace) => workspace.id === workspaceId) || store.state.workspaces[0] || null;
}

function exactWorkspaceById(workspaceId) {
  return store.state.workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

function businessForWorkspace(workspaceId) {
  return workspaceById(workspaceId)?.business || store.state.business;
}

function assignedNumberForWorkspace(workspaceId) {
  const workspace = workspaceById(workspaceId);
  if (!workspace?.assignedTwilioNumberId) return null;
  return store.state.twilioNumbers.find((number) => number.id === workspace.assignedTwilioNumberId && number.active !== false) || null;
}

function decryptWorkspaceOpenAiKey(workspace) {
  if (!workspace?.openAiKeyEncrypted) return "";
  try {
    return decryptSecret(workspace.openAiKeyEncrypted, process.env.KEY_ENCRYPTION_SECRET);
  } catch {
    return "";
  }
}

function hasWorkspaceOpenAiKey(workspace) {
  return Boolean(decryptWorkspaceOpenAiKey(workspace));
}

function userFromRequest(request) {
  if (!authEnabled()) {
    return store.state.users.find((user) => user.role === "admin") || store.state.users[0] || null;
  }
  const session = getSession(request);
  if (!session) return null;
  return store.state.users.find((user) => user.id === session.userId) || null;
}

function effectiveWorkspaceId(request, user) {
  const fallback = user?.workspaceId || store.state.workspaces[0]?.id || "";
  if (!user) return fallback;
  const url = new URL(request.url, "http://localhost");
  const requestedWorkspaceId = url.searchParams.get("workspaceId") || request.headers["x-workspace-id"];
  if (user.role === "admin" && requestedWorkspaceId && exactWorkspaceById(requestedWorkspaceId)) {
    return requestedWorkspaceId;
  }
  return fallback;
}

function requireUser(request, response) {
  const user = userFromRequest(request);
  if (!user || !isAuthenticated(request, store.state.users)) {
    sendJson(response, 401, { error: "Login required." });
    return null;
  }
  return user;
}

function requireAdmin(request, response) {
  const user = requireUser(request, response);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(response, 403, { error: "Admin access required." });
    return null;
  }
  return user;
}

function adminState() {
  return {
    users: store.state.users.map(sanitizeUser),
    workspaces: store.state.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      business: workspace.business,
      assignedTwilioNumberId: workspace.assignedTwilioNumberId || "",
      assignedTwilioNumber: assignedNumberForWorkspace(workspace.id)?.phoneNumber || "",
      openAiKeyMasked: workspace.openAiKeyMasked || "",
      hasOpenAiKey: hasWorkspaceOpenAiKey(workspace),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    })),
    twilioNumbers: store.state.twilioNumbers,
    auditLogs: store.state.auditLogs.slice(0, 100)
  };
}

function publicState(request) {
  const user = userFromRequest(request);
  const workspaceId = effectiveWorkspaceId(request, user);
  const workspace = workspaceById(workspaceId);
  const assignedNumber = assignedNumberForWorkspace(workspaceId);
  const telephonyStatus = telephony.status();
  const scoped = scopeStateToWorkspace(store.state, workspaceId);
  return {
    business: scoped.business,
    contacts: scoped.contacts,
    campaigns: scoped.campaigns,
    knowledgeBase: scoped.knowledgeBase,
    callLogs: scoped.callLogs,
    followUps: scoped.followUps,
    currentUser: sanitizeUser(user),
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          assignedTwilioNumber: assignedNumber?.phoneNumber || "",
          assignedTwilioNumberId: workspace.assignedTwilioNumberId || "",
          openAiKeyMasked: workspace.openAiKeyMasked || "",
          hasOpenAiKey: hasWorkspaceOpenAiKey(workspace)
        }
      : null,
    admin: user?.role === "admin" ? adminState() : null,
    telephony: {
      ...telephonyStatus,
      assignedFromNumber: assignedNumber?.phoneNumber || "",
      liveReady: telephonyStatus.liveReady && Boolean(assignedNumber)
    }
  };
}

function recordAudit({ user, workspaceId, action, entityType = "", entityId = "", details = {} }) {
  store.state.auditLogs ||= [];
  store.state.auditLogs.unshift({
    id: createId("audit"),
    workspaceId: workspaceId || "",
    userId: user?.id || "",
    action,
    entityType,
    entityId,
    details,
    createdAt: nowIso()
  });
  store.state.auditLogs = store.state.auditLogs.slice(0, 500);
}

function assignTwilioNumberToWorkspace(numberId, workspaceId) {
  if (!numberId) return;
  const number = store.state.twilioNumbers.find((item) => item.id === numberId);
  const workspace = exactWorkspaceById(workspaceId);
  if (!number || !workspace) return;

  store.state.twilioNumbers.forEach((item) => {
    if (item.workspaceId === workspaceId || item.id === numberId) {
      item.workspaceId = "";
      item.updatedAt = nowIso();
    }
  });
  store.state.workspaces.forEach((item) => {
    if (item.assignedTwilioNumberId === numberId || item.id === workspaceId) {
      item.assignedTwilioNumberId = "";
      item.updatedAt = nowIso();
    }
  });

  number.workspaceId = workspaceId;
  number.updatedAt = nowIso();
  workspace.assignedTwilioNumberId = numberId;
  workspace.updatedAt = nowIso();
}

function normalizeRole(value) {
  return value === "admin" ? "admin" : "user";
}

function findCampaign(id, workspaceId = "") {
  return store.state.campaigns.find((campaign) => campaign.id === id && (!workspaceId || campaign.workspaceId === workspaceId));
}

function findContact(id, workspaceId = "") {
  return store.state.contacts.find((contact) => contact.id === id && (!workspaceId || contact.workspaceId === workspaceId));
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twiml(lines) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${lines.join("")}</Response>`;
}

function mediaStreamUrl(callLogId) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || "";
  if (!publicBaseUrl) return "";
  return `${publicBaseUrl.replace(/^http/i, "ws").replace(/\/$/, "")}/media/${callLogId}`;
}

function realtimeVoiceEnabled(workspaceId) {
  return Boolean(hasWorkspaceOpenAiKey(workspaceById(workspaceId)) && process.env.PUBLIC_BASE_URL);
}

function isPublicStaticPath(pathname) {
  return pathname === "/login.html" || pathname === "/login.js" || pathname === "/app.js" || pathname === "/styles.css";
}

function eligibleContacts(campaign) {
  const targetContactIds = Array.isArray(campaign.targetContactIds) ? campaign.targetContactIds : [];
  const targetTags = campaign.targetTags || [];
  return store.state.contacts.filter((contact) => {
    if (contact.workspaceId !== campaign.workspaceId) {
      return false;
    }
    if (contact.optedOut || !contact.consentSource) {
      return false;
    }
    if (targetContactIds.length > 0) {
      return targetContactIds.includes(contact.id);
    }
    if (targetTags.length === 0) {
      return true;
    }
    return targetTags.some((tag) => contact.tags.includes(tag));
  });
}

function normalizeCallMode(value) {
  return ["conversational", "message", "message_then_conversation"].includes(value) ? value : "conversational";
}

function normalizeDispatchMode(value) {
  return value === "one_by_one" ? "one_by_one" : "batch";
}

function normalizeLanguageMode(value) {
  return ["english", "hindi", "hinglish", "custom"].includes(value) ? value : "english";
}

function normalizeTargetContactIds(value, workspaceId) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const contactIds = new Set(store.state.contacts.filter((contact) => contact.workspaceId === workspaceId).map((contact) => contact.id));
  return raw.map((id) => String(id).trim()).filter((id) => id && contactIds.has(id));
}

function isFinalCallStatus(status) {
  return ["completed", "busy", "no-answer", "failed", "canceled", "cancelled"].includes(status);
}

function isActiveProviderStatus(status) {
  return ["creating", "queued", "initiated", "ringing", "answered", "in-progress", "in_progress", "ending"].includes(status);
}

function twilioEndStatus(status) {
  return ["queued", "initiated", "ringing", "creating", "waiting_to_call"].includes(status) ? "canceled" : "completed";
}

function createCallLog({ campaign, contact, dispatchMode, sequenceIndex = null, status = "creating" }) {
  return {
    id: createId("call"),
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    contactId: contact.id,
    status,
    dispatchMode,
    sequenceIndex,
    provider: telephony.status().provider,
    providerCallId: null,
    transcript: [],
    rawTranscript: [],
    summary: "",
    unansweredQuestions: [],
    followUpRequired: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function callReadinessError(workspaceId) {
  const workspace = workspaceById(workspaceId);
  return workspaceCallReadinessError(store.state, workspaceId, {
    telephonyMode: telephony.status().mode,
    hasOpenAiKey: hasWorkspaceOpenAiKey(workspace)
  });
}

async function startProviderCall(callLog) {
  const workspace = workspaceById(callLog.workspaceId);
  const contact = findContact(callLog.contactId, callLog.workspaceId);
  if (!contact) {
    callLog.status = "failed";
    callLog.error = "Missing contact for call.";
    callLog.updatedAt = nowIso();
    store.save();
    return { contactId: callLog.contactId, callLogId: callLog.id, status: "failed", error: callLog.error };
  }
  const assignedNumber = assignedNumberForWorkspace(callLog.workspaceId);
  if (!assignedNumber) {
    callLog.status = "failed";
    callLog.error = "Assign a Twilio caller number to this workspace before scheduling calls.";
    callLog.updatedAt = nowIso();
    store.save();
    return { contactId: contact.id, callLogId: callLog.id, status: "failed", error: callLog.error };
  }
  if (telephony.status().mode === "live" && !hasWorkspaceOpenAiKey(workspace)) {
    callLog.status = "failed";
    callLog.error = "Add an OpenAI API key in workspace settings before scheduling live Realtime calls.";
    callLog.updatedAt = nowIso();
    store.save();
    return { contactId: contact.id, callLogId: callLog.id, status: "failed", error: callLog.error };
  }

  callLog.status = "creating";
  callLog.provider = telephony.status().provider;
  callLog.startedAt = nowIso();
  callLog.updatedAt = nowIso();
  store.save();

  try {
    const providerResult = await telephony.createCall({ contact, callLogId: callLog.id, fromNumber: assignedNumber.phoneNumber });
    callLog.status = providerResult.status;
    callLog.provider = providerResult.provider;
    callLog.providerCallId = providerResult.providerCallId;
    callLog.providerNote = providerResult.note || "";
    callLog.webhookUrl = providerResult.webhookUrl || "";
    callLog.updatedAt = nowIso();
    store.save();
    return { contactId: contact.id, callLogId: callLog.id, status: callLog.status };
  } catch (error) {
    callLog.status = "failed";
    callLog.error = error.message;
    callLog.updatedAt = nowIso();
    store.save();
    return { contactId: contact.id, callLogId: callLog.id, status: "failed", error: error.message };
  }
}

async function startNextSequentialCall(campaignId) {
  const hasActiveCall = store.state.callLogs.some(
    (log) => log.campaignId === campaignId && log.dispatchMode === "one_by_one" && isActiveProviderStatus(log.status)
  );
  if (hasActiveCall) return null;

  const nextCall = store.state.callLogs
    .filter((log) => log.campaignId === campaignId && log.dispatchMode === "one_by_one" && log.status === "waiting_to_call")
    .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0))[0];

  if (!nextCall) {
    const campaign = findCampaign(campaignId);
    if (campaign?.status === "scheduled") {
      campaign.status = "completed";
      campaign.completedAt = nowIso();
      store.save();
    }
    return null;
  }

  return startProviderCall(nextCall);
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/auth/status") {
    const user = userFromRequest(request);
    sendJson(response, 200, {
      authEnabled: authEnabled(),
      authenticated: Boolean(user) || !authEnabled(),
      user: sanitizeUser(user)
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(request);
    const user = verifyLogin({
      email: body.email,
      password: String(body.password || ""),
      users: store.state.users
    });
    if (!user) {
      sendJson(response, 401, { error: "Invalid email or password." });
      return;
    }
    sendJsonWithHeaders(response, 200, { ok: true, user: sanitizeUser(user) }, { "Set-Cookie": createSessionCookie(user) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    sendJsonWithHeaders(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  const user = requireUser(request, response);
  if (!user) return;
  const workspaceId = effectiveWorkspaceId(request, user);
  const workspace = workspaceById(workspaceId);
  if (!workspace) {
    sendJson(response, 400, { error: "No workspace is available for this user." });
    return;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, publicState(request));
    return;
  }

  if (request.method === "PUT" && pathname === "/api/business") {
    const body = await readBody(request);
    const currentBusiness = businessForWorkspace(workspaceId);
    const business = {
      ...currentBusiness,
      name: String(body.name || "").trim(),
      callerId: String(body.callerId || "").trim(),
      phone: String(body.phone || "").trim(),
      timezone: String(body.timezone || "").trim() || "America/Los_Angeles",
      defaultCallWindow: {
        start: String(body.callWindowStart || currentBusiness.defaultCallWindow?.start || "10:00").trim(),
        end: String(body.callWindowEnd || currentBusiness.defaultCallWindow?.end || "18:00").trim()
      },
      updatedAt: nowIso()
    };

    if (!business.name) {
      sendJson(response, 400, { error: "Business name is required." });
      return;
    }

    workspace.business = business;
    workspace.name = body.workspaceName ? String(body.workspaceName).trim() : workspace.name;
    workspace.updatedAt = nowIso();
    store.state.business = business;
    store.save();
    recordAudit({ user, workspaceId, action: "business.updated", entityType: "workspace", entityId: workspaceId });
    store.save();
    sendJson(response, 200, { business, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/contacts/import") {
    const body = await readBody(request);
    const workspaceContacts = store.state.contacts.filter((contact) => contact.workspaceId === workspaceId);
    const { contacts, errors } = importContactsFromCsv(body.csv || "", workspaceContacts);
    contacts.forEach((contact) => {
      contact.workspaceId = workspaceId;
    });
    store.state.contacts.push(...contacts);
    recordAudit({
      user,
      workspaceId,
      action: "contacts.imported",
      entityType: "contact",
      details: { count: contacts.length, errors: errors.length }
    });
    store.save();
    sendJson(response, 200, { contacts, errors, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/contacts\/[^/]+\/opt-out$/)) {
    const contactId = pathname.split("/")[3];
    const contact = findContact(contactId, workspaceId);
    if (!contact) {
      notFound(response);
      return;
    }
    contact.optedOut = true;
    contact.optedOutAt = nowIso();
    recordAudit({ user, workspaceId, action: "contact.opted_out", entityType: "contact", entityId: contact.id });
    store.save();
    sendJson(response, 200, { contact, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/contacts\/[^/]+\/call-permission$/)) {
    const contactId = pathname.split("/")[3];
    const contact = findContact(contactId, workspaceId);
    if (!contact) {
      notFound(response);
      return;
    }

    const body = await readBody(request);
    const optedOut = Boolean(body.optedOut);
    if (!optedOut && !contact.consentSource) {
      sendJson(response, 400, { error: "Cannot opt in a contact without a consent source." });
      return;
    }

    setContactCallPermission(contact, optedOut);
    recordAudit({
      user,
      workspaceId,
      action: optedOut ? "contact.opted_out" : "contact.opted_in",
      entityType: "contact",
      entityId: contact.id
    });
    store.save();
    sendJson(response, 200, { contact, state: publicState(request) });
    return;
  }

  if (request.method === "DELETE" && pathname.match(/^\/api\/contacts\/[^/]+$/)) {
    const contactId = pathname.split("/")[3];
    const contact = findContact(contactId, workspaceId);
    if (!contact) {
      notFound(response);
      return;
    }

    store.state.contacts = store.state.contacts.filter((item) => !(item.id === contactId && item.workspaceId === workspaceId));
    store.state.callLogs = store.state.callLogs.filter((log) => !(log.contactId === contactId && log.workspaceId === workspaceId));
    store.state.followUps = store.state.followUps.filter((item) => !(item.contactId === contactId && item.workspaceId === workspaceId));
    recordAudit({ user, workspaceId, action: "contact.deleted", entityType: "contact", entityId: contact.id });
    store.save();
    sendJson(response, 200, { contact, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/campaigns") {
    const body = await readBody(request);
    const campaign = {
      id: createId("campaign"),
      workspaceId,
      name: String(body.name || "").trim(),
      type: body.type || "event",
      callMode: normalizeCallMode(body.callMode),
      dispatchMode: normalizeDispatchMode(body.dispatchMode),
      languageMode: normalizeLanguageMode(body.languageMode),
      languageInstructions: String(body.languageInstructions || "").trim(),
      status: "draft",
      eventDate: body.eventDate || "",
      location: String(body.location || "").trim(),
      offer: String(body.offer || "").trim(),
      objective: String(body.objective || "").trim(),
      scriptNotes: String(body.scriptNotes || "").trim(),
      scriptOverride: String(body.scriptOverride || "").trim(),
      targetTags: String(body.targetTags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      targetContactIds: normalizeTargetContactIds(body.targetContactIds, workspaceId),
      createdAt: nowIso()
    };

    if (!campaign.name || !campaign.eventDate || !campaign.location) {
      sendJson(response, 400, { error: "Campaign name, event date, and location are required." });
      return;
    }

    store.state.campaigns.unshift(campaign);
    recordAudit({ user, workspaceId, action: "campaign.created", entityType: "campaign", entityId: campaign.id });
    store.save();
    sendJson(response, 201, { campaign, state: publicState(request) });
    return;
  }

  if (request.method === "PUT" && pathname.match(/^\/api\/campaigns\/[^/]+$/)) {
    const campaignId = pathname.split("/")[3];
    const campaign = findCampaign(campaignId, workspaceId);
    if (!campaign) {
      notFound(response);
      return;
    }

    const body = await readBody(request);
    const next = {
      name: String(body.name || "").trim(),
      type: body.type || "event",
      callMode: normalizeCallMode(body.callMode),
      dispatchMode: normalizeDispatchMode(body.dispatchMode),
      languageMode: normalizeLanguageMode(body.languageMode),
      languageInstructions: String(body.languageInstructions || "").trim(),
      eventDate: body.eventDate || "",
      location: String(body.location || "").trim(),
      offer: String(body.offer || "").trim(),
      objective: String(body.objective || "").trim(),
      scriptNotes: String(body.scriptNotes || "").trim(),
      scriptOverride: String(body.scriptOverride || "").trim(),
      targetTags: String(body.targetTags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      targetContactIds: normalizeTargetContactIds(body.targetContactIds, workspaceId)
    };

    if (!next.name || !next.eventDate || !next.location) {
      sendJson(response, 400, { error: "Campaign name, event date, and location are required." });
      return;
    }

    Object.assign(campaign, next, { updatedAt: nowIso() });
    recordAudit({ user, workspaceId, action: "campaign.updated", entityType: "campaign", entityId: campaign.id });
    store.save();
    sendJson(response, 200, { campaign, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/knowledge") {
    const body = await readBody(request);
    const requestedScope = body.scope || "global";
    if (requestedScope !== "global" && !findCampaign(requestedScope, workspaceId)) {
      sendJson(response, 400, { error: "Knowledge scope must be a campaign in this workspace or global." });
      return;
    }
    const item = {
      id: createId("kb"),
      workspaceId,
      scope: requestedScope,
      topic: String(body.topic || "").trim(),
      question: String(body.question || "").trim(),
      answer: String(body.answer || "").trim(),
      createdAt: nowIso()
    };

    if (!item.topic || !item.question || !item.answer) {
      sendJson(response, 400, { error: "Topic, question, and answer are required." });
      return;
    }

    store.state.knowledgeBase.unshift(item);
    recordAudit({ user, workspaceId, action: "knowledge.created", entityType: "knowledge", entityId: item.id });
    store.save();
    sendJson(response, 201, { item, state: publicState(request) });
    return;
  }

  if (request.method === "PUT" && pathname.match(/^\/api\/knowledge\/[^/]+$/)) {
    const knowledgeId = pathname.split("/")[3];
    const item = store.state.knowledgeBase.find((entry) => entry.id === knowledgeId && entry.workspaceId === workspaceId);
    if (!item) {
      notFound(response);
      return;
    }

    const body = await readBody(request);
    const requestedScope = body.scope || "global";
    if (requestedScope !== "global" && !findCampaign(requestedScope, workspaceId)) {
      sendJson(response, 400, { error: "Knowledge scope must be a campaign in this workspace or global." });
      return;
    }
    const next = {
      scope: requestedScope,
      topic: String(body.topic || "").trim(),
      question: String(body.question || "").trim(),
      answer: String(body.answer || "").trim()
    };

    if (!next.topic || !next.question || !next.answer) {
      sendJson(response, 400, { error: "Topic, question, and answer are required." });
      return;
    }

    Object.assign(item, next, { updatedAt: nowIso() });
    recordAudit({ user, workspaceId, action: "knowledge.updated", entityType: "knowledge", entityId: item.id });
    store.save();
    sendJson(response, 200, { item, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/answer") {
    const body = await readBody(request);
    const campaign = findCampaign(body.campaignId, workspaceId);
    if (!campaign) {
      notFound(response);
      return;
    }
    const answer = answerQuestion({
      business: businessForWorkspace(workspaceId),
      campaign,
      knowledgeBase: store.state.knowledgeBase.filter((item) => item.workspaceId === workspaceId),
      question: body.question
    });
    sendJson(response, 200, { answer });
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/campaigns\/[^/]+\/preview$/)) {
    const campaignId = pathname.split("/")[3];
    const campaign = findCampaign(campaignId, workspaceId);
    if (!campaign) {
      notFound(response);
      return;
    }
    const sampleContact = eligibleContacts(campaign)[0] || store.state.contacts.find((contact) => contact.workspaceId === workspaceId) || { name: "there" };
    const script = renderCallScript({
      business: businessForWorkspace(workspaceId),
      campaign,
      contact: sampleContact
    });
    sendJson(response, 200, { script, sampleContact });
    return;
  }

  if (request.method === "PUT" && pathname.match(/^\/api\/campaigns\/[^/]+\/script$/)) {
    const campaignId = pathname.split("/")[3];
    const campaign = findCampaign(campaignId, workspaceId);
    if (!campaign) {
      notFound(response);
      return;
    }

    const body = await readBody(request);
    const script = String(body.script || "").trim();
    if (!script) {
      sendJson(response, 400, { error: "Script cannot be empty." });
      return;
    }

    campaign.scriptOverride = script;
    campaign.scriptUpdatedAt = nowIso();
    recordAudit({ user, workspaceId, action: "campaign.script_updated", entityType: "campaign", entityId: campaign.id });
    store.save();
    sendJson(response, 200, { campaign, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/campaigns\/[^/]+\/schedule$/)) {
    const campaignId = pathname.split("/")[3];
    const campaign = findCampaign(campaignId, workspaceId);
    if (!campaign) {
      notFound(response);
      return;
    }

    const readinessError = callReadinessError(workspaceId);
    if (readinessError) {
      sendJson(response, 400, { error: readinessError });
      return;
    }

    const contacts = eligibleContacts(campaign);
    const results = [];
    const dispatchMode = normalizeDispatchMode(campaign.dispatchMode);

    if (dispatchMode === "one_by_one") {
      contacts.forEach((contact, index) => {
        const callLog = createCallLog({
          campaign,
          contact,
          dispatchMode,
          sequenceIndex: index,
          status: index === 0 ? "creating" : "waiting_to_call"
        });
        store.state.callLogs.unshift(callLog);
        results.push({ contactId: contact.id, callLogId: callLog.id, status: callLog.status });
      });

      const firstCall = store.state.callLogs.find(
        (log) => log.campaignId === campaign.id && log.dispatchMode === "one_by_one" && log.sequenceIndex === 0 && log.status === "creating"
      );
      if (firstCall) {
        const result = await startProviderCall(firstCall);
        const existing = results.find((item) => item.callLogId === firstCall.id);
        if (existing) Object.assign(existing, result);
      }
    } else {
      for (const contact of contacts) {
        const callLog = createCallLog({ campaign, contact, dispatchMode });
        store.state.callLogs.unshift(callLog);
        results.push(await startProviderCall(callLog));
      }
    }

    campaign.status = "scheduled";
    campaign.scheduledAt = nowIso();
    campaign.scheduleDispatchMode = dispatchMode;
    recordAudit({
      user,
      workspaceId,
      action: "campaign.calls_scheduled",
      entityType: "campaign",
      entityId: campaign.id,
      details: { count: results.length, dispatchMode }
    });
    store.save();
    sendJson(response, 200, { results, state: publicState(request) });
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/calls\/[^/]+\/end$/)) {
    const callLogId = pathname.split("/")[3];
    const callLog = store.state.callLogs.find((log) => log.id === callLogId && log.workspaceId === workspaceId);
    if (!callLog) {
      notFound(response);
      return;
    }

    if (isFinalCallStatus(callLog.status)) {
      sendJson(response, 200, { callLog, state: publicState(request) });
      return;
    }

    const requestedEndStatus = twilioEndStatus(callLog.status);
    callLog.endedByUserAt = nowIso();
    callLog.endReason = "manual_hangup";

    if (!callLog.providerCallId) {
      callLog.status = "canceled";
      callLog.updatedAt = nowIso();
      store.save();
      if (callLog.dispatchMode === "one_by_one") {
        await startNextSequentialCall(callLog.campaignId);
      }
      recordAudit({ user, workspaceId, action: "call.ended", entityType: "call", entityId: callLog.id, details: { status: callLog.status } });
      store.save();
      sendJson(response, 200, { callLog, state: publicState(request) });
      return;
    }

    callLog.status = "ending";
    callLog.updatedAt = nowIso();
    store.save();

    try {
      const result = await telephony.endCall({ providerCallId: callLog.providerCallId, status: requestedEndStatus });
      callLog.status = result.status;
      callLog.provider = result.provider;
      callLog.providerNote = result.note || callLog.providerNote || "";
      callLog.updatedAt = nowIso();
      store.save();
      if (callLog.dispatchMode === "one_by_one" && isFinalCallStatus(callLog.status)) {
        await startNextSequentialCall(callLog.campaignId);
      }
      recordAudit({ user, workspaceId, action: "call.ended", entityType: "call", entityId: callLog.id, details: { status: callLog.status } });
      store.save();
      sendJson(response, 200, { callLog, state: publicState(request) });
    } catch (error) {
      callLog.status = "ending_failed";
      callLog.error = error.message;
      callLog.updatedAt = nowIso();
      store.save();
      sendJson(response, 500, { error: error.message, state: publicState(request) });
    }
    return;
  }

  if (request.method === "POST" && pathname.match(/^\/api\/calls\/[^/]+\/call-again$/)) {
    const originalCallId = pathname.split("/")[3];
    const originalCall = store.state.callLogs.find((log) => log.id === originalCallId && log.workspaceId === workspaceId);
    if (!originalCall) {
      notFound(response);
      return;
    }

    const campaign = findCampaign(originalCall.campaignId, workspaceId);
    const contact = findContact(originalCall.contactId, workspaceId);
    if (!campaign || !contact) {
      sendJson(response, 404, { error: "Campaign or contact not found for this call." });
      return;
    }
    if (contact.optedOut || !contact.consentSource) {
      sendJson(response, 400, { error: "This contact cannot be called again without active consent." });
      return;
    }
    const readinessError = callReadinessError(workspaceId);
    if (readinessError) {
      sendJson(response, 400, { error: readinessError });
      return;
    }

    const callLog = createCallLog({
      campaign,
      contact,
      dispatchMode: "manual_retry",
      status: "creating"
    });
    callLog.retryOfCallId = originalCall.id;
    callLog.summary = `Manual call again for ${contact.name}.`;
    store.state.callLogs.unshift(callLog);
    recordAudit({ user, workspaceId, action: "call.retry_scheduled", entityType: "call", entityId: callLog.id });
    store.save();

    const result = await startProviderCall(callLog);
    sendJson(response, 200, { callLog, result, state: publicState(request) });
    return;
  }

  if (request.method === "GET" && pathname.match(/^\/api\/calls\/[^/]+\/transcript$/)) {
    const callLogId = pathname.split("/")[3];
    const callLog = store.state.callLogs.find((log) => log.id === callLogId && log.workspaceId === workspaceId);
    if (!callLog) {
      notFound(response);
      return;
    }

    const transcript = transcriptEntries(callLog);
    const customerTranscriptCount = transcript.filter((entry) => entry.role === "customer").length;
    const assistantTranscriptCount = transcript.filter((entry) => entry.role === "assistant").length;
    sendJson(response, 200, {
      callLogId: callLog.id,
      campaignId: callLog.campaignId,
      contactId: callLog.contactId,
      status: callLog.status,
      providerCallId: callLog.providerCallId,
      createdAt: callLog.createdAt,
      updatedAt: callLog.updatedAt,
      inputTranscriptionEnabledAt: callLog.inputTranscriptionEnabledAt || null,
      inputTranscriptionAccepted: callLog.inputTranscriptionAccepted ?? null,
      inputTranscriptionError: callLog.lastInputTranscriptionError || null,
      transcriptCounts: {
        customer: customerTranscriptCount,
        assistant: assistantTranscriptCount
      },
      transcriptWarning:
        customerTranscriptCount === 0
          ? "No customer transcript was captured for this call. Older calls before input transcription was enabled may only contain assistant lines."
          : "",
      transcript
    });
    return;
  }

  if (request.method === "PUT" && pathname === "/api/workspace/openai-key") {
    const body = await readBody(request);
    const apiKey = String(body.apiKey || "").trim();
    if (!apiKey) {
      sendJson(response, 400, { error: "OpenAI API key is required." });
      return;
    }
    workspace.openAiKeyEncrypted = encryptSecret(apiKey, process.env.KEY_ENCRYPTION_SECRET);
    workspace.openAiKeyMasked = maskSecret(apiKey);
    workspace.updatedAt = nowIso();
    recordAudit({ user, workspaceId, action: "credentials.openai_key_saved", entityType: "workspace", entityId: workspaceId });
    store.save();
    sendJson(response, 200, { workspace: publicState(request).workspace, state: publicState(request) });
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/workspace/openai-key") {
    workspace.openAiKeyEncrypted = "";
    workspace.openAiKeyMasked = "";
    workspace.updatedAt = nowIso();
    recordAudit({ user, workspaceId, action: "credentials.openai_key_removed", entityType: "workspace", entityId: workspaceId });
    store.save();
    sendJson(response, 200, { workspace: publicState(request).workspace, state: publicState(request) });
    return;
  }

  if (pathname.startsWith("/api/admin")) {
    const adminUser = requireAdmin(request, response);
    if (!adminUser) return;

    if (request.method === "GET" && pathname === "/api/admin") {
      sendJson(response, 200, adminState());
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/workspaces") {
      const body = await readBody(request);
      const name = String(body.name || "").trim();
      if (!name) {
        sendJson(response, 400, { error: "Workspace name is required." });
        return;
      }
      const now = nowIso();
      const workspaceRecord = {
        id: createId("workspace"),
        name,
        business: {
          id: createId("biz"),
          name: String(body.businessName || name).trim(),
          callerId: String(body.callerId || body.businessName || name).trim(),
          phone: String(body.phone || "").trim(),
          timezone: String(body.timezone || "America/Los_Angeles").trim(),
          defaultCallWindow: { start: "10:00", end: "18:00" },
          updatedAt: now
        },
        assignedTwilioNumberId: "",
        openAiKeyEncrypted: "",
        openAiKeyMasked: "",
        createdAt: now,
        updatedAt: now
      };
      store.state.workspaces.push(workspaceRecord);
      if (body.assignedTwilioNumberId) assignTwilioNumberToWorkspace(String(body.assignedTwilioNumberId), workspaceRecord.id);
      recordAudit({ user: adminUser, workspaceId: workspaceRecord.id, action: "workspace.created", entityType: "workspace", entityId: workspaceRecord.id });
      store.save();
      sendJson(response, 201, { workspace: workspaceRecord, state: publicState(request) });
      return;
    }

    if (request.method === "PUT" && pathname.match(/^\/api\/admin\/workspaces\/[^/]+$/)) {
      const targetWorkspaceId = pathname.split("/")[4];
      const targetWorkspace = exactWorkspaceById(targetWorkspaceId);
      if (!targetWorkspace) {
        notFound(response);
        return;
      }
      const body = await readBody(request);
      if (body.name !== undefined) targetWorkspace.name = String(body.name || "").trim() || targetWorkspace.name;
      if (body.businessName !== undefined) targetWorkspace.business.name = String(body.businessName || "").trim() || targetWorkspace.business.name;
      if (body.callerId !== undefined) targetWorkspace.business.callerId = String(body.callerId || "").trim();
      if (body.phone !== undefined) targetWorkspace.business.phone = String(body.phone || "").trim();
      if (body.timezone !== undefined) targetWorkspace.business.timezone = String(body.timezone || "America/Los_Angeles").trim();
      if (Object.hasOwn(body, "assignedTwilioNumberId")) {
        const previousNumber = store.state.twilioNumbers.find((number) => number.id === targetWorkspace.assignedTwilioNumberId);
        if (previousNumber) previousNumber.workspaceId = "";
        targetWorkspace.assignedTwilioNumberId = "";
        if (body.assignedTwilioNumberId) assignTwilioNumberToWorkspace(String(body.assignedTwilioNumberId), targetWorkspace.id);
      }
      targetWorkspace.business.updatedAt = nowIso();
      targetWorkspace.updatedAt = nowIso();
      recordAudit({ user: adminUser, workspaceId: targetWorkspace.id, action: "workspace.updated", entityType: "workspace", entityId: targetWorkspace.id });
      store.save();
      sendJson(response, 200, { workspace: targetWorkspace, state: publicState(request) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/users") {
      const body = await readBody(request);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const targetWorkspaceId = String(body.workspaceId || "").trim();
      if (!email || !password || !exactWorkspaceById(targetWorkspaceId)) {
        sendJson(response, 400, { error: "Email, password, and workspace are required." });
        return;
      }
      if (store.state.users.some((item) => item.email.toLowerCase() === email)) {
        sendJson(response, 409, { error: "A user with that email already exists." });
        return;
      }
      const now = nowIso();
      const newUser = {
        id: createId("user"),
        email,
        passwordHash: hashPassword(password),
        role: normalizeRole(body.role),
        workspaceId: targetWorkspaceId,
        createdAt: now,
        updatedAt: now
      };
      store.state.users.push(newUser);
      recordAudit({ user: adminUser, workspaceId: targetWorkspaceId, action: "user.created", entityType: "user", entityId: newUser.id });
      store.save();
      sendJson(response, 201, { user: sanitizeUser(newUser), state: publicState(request) });
      return;
    }

    if (request.method === "PUT" && pathname.match(/^\/api\/admin\/users\/[^/]+$/)) {
      const targetUserId = pathname.split("/")[4];
      const targetUser = store.state.users.find((item) => item.id === targetUserId);
      if (!targetUser) {
        notFound(response);
        return;
      }
      const body = await readBody(request);
      if (body.email !== undefined) targetUser.email = String(body.email || "").trim().toLowerCase() || targetUser.email;
      if (body.role !== undefined) targetUser.role = normalizeRole(body.role);
      if (body.workspaceId !== undefined) {
        if (!exactWorkspaceById(body.workspaceId)) {
          sendJson(response, 400, { error: "Workspace not found." });
          return;
        }
        targetUser.workspaceId = String(body.workspaceId);
      }
      if (body.password) targetUser.passwordHash = hashPassword(String(body.password));
      targetUser.updatedAt = nowIso();
      recordAudit({ user: adminUser, workspaceId: targetUser.workspaceId, action: "user.updated", entityType: "user", entityId: targetUser.id });
      store.save();
      sendJson(response, 200, { user: sanitizeUser(targetUser), state: publicState(request) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/twilio-numbers") {
      const body = await readBody(request);
      const phoneNumber = String(body.phoneNumber || "").trim();
      if (!phoneNumber) {
        sendJson(response, 400, { error: "Twilio phone number is required." });
        return;
      }
      if (store.state.twilioNumbers.some((item) => item.phoneNumber === phoneNumber)) {
        sendJson(response, 409, { error: "That Twilio number already exists." });
        return;
      }
      const now = nowIso();
      const number = {
        id: createId("twilio"),
        phoneNumber,
        label: String(body.label || "").trim(),
        workspaceId: "",
        active: body.active === undefined ? true : Boolean(body.active),
        createdAt: now,
        updatedAt: now
      };
      store.state.twilioNumbers.push(number);
      if (body.workspaceId) assignTwilioNumberToWorkspace(number.id, String(body.workspaceId));
      recordAudit({ user: adminUser, workspaceId: number.workspaceId, action: "twilio_number.added", entityType: "twilio_number", entityId: number.id });
      store.save();
      sendJson(response, 201, { number, state: publicState(request) });
      return;
    }

    if (request.method === "PUT" && pathname.match(/^\/api\/admin\/twilio-numbers\/[^/]+$/)) {
      const numberId = pathname.split("/")[4];
      const number = store.state.twilioNumbers.find((item) => item.id === numberId);
      if (!number) {
        notFound(response);
        return;
      }
      const body = await readBody(request);
      if (body.phoneNumber !== undefined) number.phoneNumber = String(body.phoneNumber || "").trim() || number.phoneNumber;
      if (body.label !== undefined) number.label = String(body.label || "").trim();
      if (body.active !== undefined) number.active = Boolean(body.active);
      if (Object.hasOwn(body, "workspaceId")) {
        const previousWorkspace = exactWorkspaceById(number.workspaceId);
        if (previousWorkspace?.assignedTwilioNumberId === number.id) previousWorkspace.assignedTwilioNumberId = "";
        number.workspaceId = "";
        if (body.workspaceId) assignTwilioNumberToWorkspace(number.id, String(body.workspaceId));
      }
      number.updatedAt = nowIso();
      recordAudit({ user: adminUser, workspaceId: number.workspaceId, action: "twilio_number.updated", entityType: "twilio_number", entityId: number.id });
      store.save();
      sendJson(response, 200, { number, state: publicState(request) });
      return;
    }
  }

  notFound(response);
}

async function handleVoice(request, response, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const callLogId = parts[1];
  const callLog = store.state.callLogs.find((log) => log.id === callLogId);
  if (!callLog) {
    sendText(response, 404, twiml(["<Say>Call log not found.</Say>"]), "text/xml; charset=utf-8");
    return;
  }

  const campaign = findCampaign(callLog.campaignId);
  const contact = findContact(callLog.contactId);
  const callWorkspaceId = callLog.workspaceId || campaign?.workspaceId || contact?.workspaceId || "";
  const business = businessForWorkspace(callWorkspaceId);
  const knowledgeBase = store.state.knowledgeBase.filter((item) => item.workspaceId === callWorkspaceId);
  if (!campaign || !contact) {
    sendText(response, 404, twiml(["<Say>Campaign or contact not found.</Say>"]), "text/xml; charset=utf-8");
    return;
  }

  if (parts[2] === "status") {
    const body = await readBody(request);
    callLog.status = body.CallStatus || callLog.status;
    callLog.updatedAt = nowIso();
    store.save();
    if (callLog.dispatchMode === "one_by_one" && isFinalCallStatus(callLog.status)) {
      await startNextSequentialCall(callLog.campaignId);
    }
    sendText(response, 200, "ok");
    return;
  }

  if (parts[2] === "answer") {
    const body = await readBody(request);
    const question = body.SpeechResult || "";
    appendTranscriptEntry(callLog, {
      role: "customer",
      text: question,
      at: nowIso(),
      source: "twilio_speech_result",
      eventType: "SpeechResult"
    });
    if (isCustomerEndIntent(question)) {
      const goodbye = "Thank you. Goodbye.";
      appendTranscriptEntry(callLog, {
        role: "assistant",
        text: goodbye,
        at: nowIso(),
        source: "local_answer",
        eventType: "end_intent_goodbye"
      });
      callLog.endReason = "customer_done";
      callLog.endIntentDetectedAt = nowIso();
      callLog.status = "completed";
      callLog.updatedAt = nowIso();
      store.save();
      sendText(response, 200, twiml([`<Say>${escapeXml(goodbye)}</Say>`, "<Hangup />"]), "text/xml; charset=utf-8");
      return;
    }

    const result = answerQuestion({
      business,
      campaign,
      knowledgeBase,
      question
    });

    appendTranscriptEntry(callLog, {
      role: "assistant",
      text: result.answer,
      at: nowIso(),
      source: "local_answer",
      eventType: "answerQuestion"
    });
    if (result.action === "opt_out") {
      contact.optedOut = true;
      contact.optedOutAt = nowIso();
    }
    if (result.followUpRequired) {
      ensureFollowUp({
        store,
        callLog,
        campaign,
        contact,
        question,
        source: "twilio_speech_result"
      });
    }
    callLog.updatedAt = nowIso();
    store.save();

    const responseXml = twiml([
      `<Say>${escapeXml(result.answer)}</Say>`,
      `<Gather input="speech" action="/voice/${escapeXml(callLog.id)}/answer" method="POST" timeout="4" speechTimeout="auto">`,
      "<Say>Is there anything else I can help answer?</Say>",
      "</Gather>",
      "<Say>Thank you. We hope to see you soon.</Say>"
    ]);
    sendText(response, 200, responseXml, "text/xml; charset=utf-8");
    return;
  }

  callLog.status = "in_progress";
  callLog.updatedAt = nowIso();
  const script = renderCallScript({ business, campaign, contact });
  appendTranscriptEntry(callLog, {
    role: "assistant",
    text: script,
    at: nowIso(),
    source: realtimeVoiceEnabled(callWorkspaceId) ? "openai_realtime_opening_request" : "twilio_say",
    eventType: "opening_script"
  });
  store.save();

  if (realtimeVoiceEnabled(callWorkspaceId)) {
    const streamUrl = mediaStreamUrl(callLog.id);
    const responseXml = twiml([
      "<Connect>",
      `<Stream url="${escapeXml(streamUrl)}" />`,
      "</Connect>"
    ]);
    sendText(response, 200, responseXml, "text/xml; charset=utf-8");
    return;
  }

  const responseXml = twiml([
    `<Say>${escapeXml(script)}</Say>`,
    `<Gather input="speech" action="/voice/${escapeXml(callLog.id)}/answer" method="POST" timeout="4" speechTimeout="auto">`,
    "<Say>What question can I answer for you?</Say>",
    "</Gather>",
    "<Say>Thank you. We hope to see you soon.</Say>"
  ]);
  sendText(response, 200, responseXml, "text/xml; charset=utf-8");
}

function handleUpgrade(request, socket, head) {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith("/media/")) {
    socket.destroy();
    return;
  }

  const callLogId = url.pathname.split("/")[2];
  acceptWebSocketUpgrade(request, socket, head, (twilioSocket) => {
    handleRealtimeMediaStream(twilioSocket, {
      callLogId,
      store,
      findCampaign,
      findContact,
      getOpenAiApiKey: (workspaceId) => decryptWorkspaceOpenAiKey(exactWorkspaceById(workspaceId)),
      getBusiness: businessForWorkspace,
      getKnowledgeBase: (workspaceId) => store.state.knowledgeBase.filter((item) => item.workspaceId === workspaceId)
    });
  });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

function createServerInstance() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url.pathname);
        return;
      }
      if (url.pathname.startsWith("/voice/")) {
        await handleVoice(request, response, url.pathname);
        return;
      }
      if (authEnabled() && !userFromRequest(request) && !isPublicStaticPath(url.pathname)) {
        response.writeHead(302, { Location: "/login.html" });
        response.end();
        return;
      }
      serveStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
  server.on("upgrade", handleUpgrade);
  return server;
}

return createServerInstance();
}

export function createAppServer(options = {}) {
  return createHandlers({
    store: options.store || (defaultStore ||= new SQLiteStore()),
    telephony: options.telephony || (defaultTelephony ||= new TelephonyAdapter())
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5174);
  createAppServer().listen(port, () => {
    console.log(`Voice marketing MVP running at http://localhost:${port}`);
  });
}
