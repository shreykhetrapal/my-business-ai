import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptSecret, maskSecret } from "./cryptoSecrets.js";
import { hashPassword } from "./auth.js";
import { initialState } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultStatePath = resolve(__dirname, "../data/app-state.json");
const defaultDbPath = resolve(__dirname, "../data/app.db");
const defaultWorkspaceId = "workspace_default";

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export class JsonStore {
  constructor(filePath = defaultStatePath) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    if (!existsSync(this.filePath)) {
      return clone(initialState);
    }

    const raw = readFileSync(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  snapshot() {
    return clone(this.state);
  }

  save() {
    writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  replace(nextState) {
    this.state = clone(nextState);
    this.save();
  }
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function defaultBusiness(business = {}) {
  return {
    id: business.id || "biz_default",
    name: business.name || "Default Business",
    phone: business.phone || "",
    timezone: business.timezone || "America/Los_Angeles",
    callerId: business.callerId || business.name || "CallerDesk",
    defaultCallWindow: {
      start: business.defaultCallWindow?.start || "10:00",
      end: business.defaultCallWindow?.end || "18:00"
    },
    updatedAt: business.updatedAt || nowIso()
  };
}

function withWorkspace(items = [], workspaceId = defaultWorkspaceId) {
  return items.map((item) => ({ ...item, workspaceId: item.workspaceId || workspaceId }));
}

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function initialWorkspaceState(sourceState = initialState, env = process.env) {
  const now = nowIso();
  const business = defaultBusiness(sourceState.business);
  const workspace = {
    id: defaultWorkspaceId,
    name: business.name || "Default Workspace",
    business,
    assignedTwilioNumberId: "",
    openAiKeyEncrypted: "",
    openAiKeyMasked: "",
    createdAt: now,
    updatedAt: now
  };

  if (env.OPENAI_API_KEY) {
    workspace.openAiKeyEncrypted = encryptSecret(env.OPENAI_API_KEY, env.KEY_ENCRYPTION_SECRET);
    workspace.openAiKeyMasked = maskSecret(env.OPENAI_API_KEY);
  }

  const twilioNumbers = [];
  if (env.TWILIO_FROM_NUMBER) {
    const number = {
      id: "twilio_default",
      phoneNumber: env.TWILIO_FROM_NUMBER,
      label: "Default caller number",
      workspaceId: workspace.id,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    twilioNumbers.push(number);
    workspace.assignedTwilioNumberId = number.id;
  }

  const adminPassword = env.ADMIN_PASSWORD || "admin123456";
  const adminEmail = sanitizeEmail(env.ADMIN_EMAIL) || "admin@local.test";
  return {
    business,
    contacts: withWorkspace(sourceState.contacts || [], workspace.id),
    campaigns: withWorkspace(sourceState.campaigns || [], workspace.id),
    knowledgeBase: withWorkspace(sourceState.knowledgeBase || [], workspace.id),
    callLogs: withWorkspace(sourceState.callLogs || [], workspace.id),
    followUps: withWorkspace(sourceState.followUps || [], workspace.id),
    messagingSenders: withWorkspace(sourceState.messagingSenders || [], workspace.id),
    whatsappTemplates: withWorkspace(sourceState.whatsappTemplates || [], workspace.id),
    messageThreads: withWorkspace(sourceState.messageThreads || [], workspace.id),
    messageLogs: withWorkspace(sourceState.messageLogs || [], workspace.id),
    users: [
      {
        id: "user_admin",
        email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        role: "admin",
        workspaceId: workspace.id,
        createdAt: now,
        updatedAt: now
      }
    ],
    workspaces: [workspace],
    twilioNumbers,
    auditLogs: []
  };
}

export function normalizeWorkspaceState(state = {}, env = process.env) {
  const seeded = initialWorkspaceState(state, env);
  const workspaces = (state.workspaces?.length ? state.workspaces : seeded.workspaces).map((workspace) => ({
    ...workspace,
    business: defaultBusiness(workspace.business || state.business || seeded.business),
    assignedTwilioNumberId: workspace.assignedTwilioNumberId || "",
    openAiKeyEncrypted: workspace.openAiKeyEncrypted || "",
    openAiKeyMasked: workspace.openAiKeyMasked || "",
    createdAt: workspace.createdAt || nowIso(),
    updatedAt: workspace.updatedAt || nowIso()
  }));
  const fallbackWorkspaceId = workspaces[0]?.id || defaultWorkspaceId;

  return {
    business: workspaces[0]?.business || defaultBusiness(state.business || seeded.business),
    contacts: withWorkspace(state.contacts || [], fallbackWorkspaceId),
    campaigns: withWorkspace(state.campaigns || [], fallbackWorkspaceId),
    knowledgeBase: withWorkspace(state.knowledgeBase || [], fallbackWorkspaceId),
    callLogs: withWorkspace(state.callLogs || [], fallbackWorkspaceId),
    followUps: withWorkspace(state.followUps || [], fallbackWorkspaceId),
    messagingSenders: withWorkspace(state.messagingSenders || [], fallbackWorkspaceId),
    whatsappTemplates: withWorkspace(state.whatsappTemplates || [], fallbackWorkspaceId),
    messageThreads: withWorkspace(state.messageThreads || [], fallbackWorkspaceId),
    messageLogs: withWorkspace(state.messageLogs || [], fallbackWorkspaceId),
    users: state.users?.length ? state.users : seeded.users,
    workspaces,
    twilioNumbers: state.twilioNumbers || seeded.twilioNumbers,
    auditLogs: state.auditLogs || []
  };
}

export function canAccessWorkspace(user, workspaceId) {
  if (!user || !workspaceId) return false;
  return user.role === "admin" || user.workspaceId === workspaceId;
}

export function scopeStateToWorkspace(state, workspaceId) {
  return {
    business: state.workspaces?.find((workspace) => workspace.id === workspaceId)?.business || state.business,
    contacts: (state.contacts || []).filter((item) => item.workspaceId === workspaceId),
    campaigns: (state.campaigns || []).filter((item) => item.workspaceId === workspaceId),
    knowledgeBase: (state.knowledgeBase || []).filter((item) => item.workspaceId === workspaceId),
    callLogs: (state.callLogs || []).filter((item) => item.workspaceId === workspaceId),
    followUps: (state.followUps || []).filter((item) => item.workspaceId === workspaceId),
    messagingSenders: (state.messagingSenders || []).filter((item) => item.workspaceId === workspaceId),
    whatsappTemplates: (state.whatsappTemplates || []).filter((item) => item.workspaceId === workspaceId),
    messageThreads: (state.messageThreads || []).filter((item) => item.workspaceId === workspaceId),
    messageLogs: (state.messageLogs || []).filter((item) => item.workspaceId === workspaceId)
  };
}

export function workspaceCallReadinessError(state, workspaceId, { telephonyMode = "dry-run", hasOpenAiKey } = {}) {
  const workspace = (state.workspaces || []).find((item) => item.id === workspaceId);
  const assignedNumber = (state.twilioNumbers || []).find(
    (number) => number.id === workspace?.assignedTwilioNumberId && number.active !== false
  );
  if (!assignedNumber) {
    return "Assign a Twilio caller number to this workspace before scheduling calls.";
  }

  const keyIsPresent = typeof hasOpenAiKey === "boolean" ? hasOpenAiKey : Boolean(workspace?.openAiKeyEncrypted);
  if (telephonyMode === "live" && !keyIsPresent) {
    return "Add an OpenAI API key in workspace settings before scheduling live Realtime calls.";
  }

  return "";
}

export class SQLiteStore {
  constructor(filePath = defaultDbPath, { jsonPath = defaultStatePath, env = process.env } = {}) {
    this.filePath = filePath;
    this.jsonPath = jsonPath;
    this.env = env;
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.ensureSchema();
    this.state = this.load();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        workspaceId TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        businessJson TEXT NOT NULL,
        assignedTwilioNumberId TEXT,
        openAiKeyEncrypted TEXT,
        openAiKeyMasked TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS twilio_numbers (
        id TEXT PRIMARY KEY,
        phoneNumber TEXT UNIQUE NOT NULL,
        label TEXT,
        workspaceId TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT,
        updatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS call_logs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS follow_ups (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messaging_senders (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_threads (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_logs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        dataJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT,
        userId TEXT,
        action TEXT NOT NULL,
        entityType TEXT,
        entityId TEXT,
        detailsJson TEXT,
        createdAt TEXT
      );
    `);
  }

  tableCount(tableName) {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
  }

  load() {
    if (this.tableCount("workspaces") === 0) {
      const sourceState = existsSync(this.jsonPath) ? JSON.parse(readFileSync(this.jsonPath, "utf8")) : initialState;
      const migrated = normalizeWorkspaceState(sourceState, this.env);
      this.state = migrated;
      this.save();
      return clone(migrated);
    }

    const workspaces = this.db
      .prepare("SELECT * FROM workspaces ORDER BY createdAt ASC")
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        business: parseJson(row.businessJson, {}),
        assignedTwilioNumberId: row.assignedTwilioNumberId || "",
        openAiKeyEncrypted: row.openAiKeyEncrypted || "",
        openAiKeyMasked: row.openAiKeyMasked || "",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }));

    const state = {
      business: workspaces[0]?.business || defaultBusiness(),
      contacts: this.readJsonTable("contacts"),
      campaigns: this.readJsonTable("campaigns"),
      knowledgeBase: this.readJsonTable("knowledge_base"),
      callLogs: this.readJsonTable("call_logs"),
      followUps: this.readJsonTable("follow_ups"),
      messagingSenders: this.readJsonTable("messaging_senders"),
      whatsappTemplates: this.readJsonTable("whatsapp_templates"),
      messageThreads: this.readJsonTable("message_threads"),
      messageLogs: this.readJsonTable("message_logs"),
      users: this.db.prepare("SELECT * FROM users ORDER BY createdAt ASC").all(),
      workspaces,
      twilioNumbers: this.db
        .prepare("SELECT * FROM twilio_numbers ORDER BY createdAt ASC")
        .all()
        .map((row) => ({ ...row, active: Boolean(row.active) })),
      auditLogs: this.db
        .prepare("SELECT * FROM audit_logs ORDER BY createdAt DESC")
        .all()
        .map((row) => ({ ...row, details: parseJson(row.detailsJson, {}) }))
    };
    return normalizeWorkspaceState(state, this.env);
  }

  readJsonTable(tableName) {
    return this.db
      .prepare(`SELECT dataJson FROM ${tableName}`)
      .all()
      .map((row) => parseJson(row.dataJson, null))
      .filter(Boolean);
  }

  snapshot() {
    return clone(this.state);
  }

  save() {
    const state = normalizeWorkspaceState(this.state, this.env);
    this.state = clone(state);
    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        DELETE FROM metadata;
        DELETE FROM users;
        DELETE FROM workspaces;
        DELETE FROM twilio_numbers;
        DELETE FROM contacts;
        DELETE FROM campaigns;
        DELETE FROM knowledge_base;
        DELETE FROM call_logs;
        DELETE FROM follow_ups;
        DELETE FROM messaging_senders;
        DELETE FROM whatsapp_templates;
        DELETE FROM message_threads;
        DELETE FROM message_logs;
        DELETE FROM audit_logs;
      `);

      this.db.prepare("INSERT INTO metadata(key, value) VALUES(?, ?)").run("schema_version", "1");

      const insertUser = this.db.prepare(
        "INSERT INTO users(id, email, passwordHash, role, workspaceId, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)"
      );
      for (const user of state.users) {
        insertUser.run(user.id, user.email, user.passwordHash, user.role, user.workspaceId || "", user.createdAt || nowIso(), user.updatedAt || "");
      }

      const insertWorkspace = this.db.prepare(
        "INSERT INTO workspaces(id, name, businessJson, assignedTwilioNumberId, openAiKeyEncrypted, openAiKeyMasked, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const workspace of state.workspaces) {
        insertWorkspace.run(
          workspace.id,
          workspace.name,
          JSON.stringify(defaultBusiness(workspace.business)),
          workspace.assignedTwilioNumberId || "",
          workspace.openAiKeyEncrypted || "",
          workspace.openAiKeyMasked || "",
          workspace.createdAt || nowIso(),
          workspace.updatedAt || ""
        );
      }

      const insertNumber = this.db.prepare(
        "INSERT INTO twilio_numbers(id, phoneNumber, label, workspaceId, active, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)"
      );
      for (const number of state.twilioNumbers) {
        insertNumber.run(
          number.id,
          number.phoneNumber,
          number.label || "",
          number.workspaceId || "",
          number.active === false ? 0 : 1,
          number.createdAt || nowIso(),
          number.updatedAt || ""
        );
      }

      this.writeJsonTable("contacts", state.contacts);
      this.writeJsonTable("campaigns", state.campaigns);
      this.writeJsonTable("knowledge_base", state.knowledgeBase);
      this.writeJsonTable("call_logs", state.callLogs);
      this.writeJsonTable("follow_ups", state.followUps);
      this.writeJsonTable("messaging_senders", state.messagingSenders);
      this.writeJsonTable("whatsapp_templates", state.whatsappTemplates);
      this.writeJsonTable("message_threads", state.messageThreads);
      this.writeJsonTable("message_logs", state.messageLogs);

      const insertAudit = this.db.prepare(
        "INSERT INTO audit_logs(id, workspaceId, userId, action, entityType, entityId, detailsJson, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const entry of state.auditLogs) {
        insertAudit.run(
          entry.id,
          entry.workspaceId || "",
          entry.userId || "",
          entry.action,
          entry.entityType || "",
          entry.entityId || "",
          JSON.stringify(entry.details || {}),
          entry.createdAt || nowIso()
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  writeJsonTable(tableName, items) {
    const insert = this.db.prepare(`INSERT INTO ${tableName}(id, workspaceId, dataJson) VALUES(?, ?, ?)`);
    for (const item of items || []) {
      insert.run(item.id, item.workspaceId || defaultWorkspaceId, JSON.stringify(item));
    }
  }

  replace(nextState) {
    this.state = normalizeWorkspaceState(clone(nextState), this.env);
    this.save();
  }
}
