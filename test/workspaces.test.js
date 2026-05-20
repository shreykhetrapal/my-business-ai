import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashPassword } from "../src/auth.js";
import { encryptSecret, maskSecret } from "../src/cryptoSecrets.js";
import {
  canAccessWorkspace,
  scopeStateToWorkspace,
  SQLiteStore,
  nowIso,
  workspaceCallReadinessError
} from "../src/store.js";

function baseState({ assignSecondNumber = true, secondOpenAiKey = true } = {}) {
  const now = nowIso();
  const workspaceOne = {
    id: "workspace_one",
    name: "Cafe One",
    business: {
      id: "biz_one",
      name: "Cafe One",
      callerId: "Cafe One",
      phone: "",
      timezone: "America/Los_Angeles",
      defaultCallWindow: { start: "10:00", end: "18:00" }
    },
    assignedTwilioNumberId: "twilio_one",
    openAiKeyEncrypted: encryptSecret("sk-workspace-one", "test-key-secret"),
    openAiKeyMasked: maskSecret("sk-workspace-one"),
    createdAt: now,
    updatedAt: now
  };
  const workspaceTwo = {
    id: "workspace_two",
    name: "Cafe Two",
    business: {
      id: "biz_two",
      name: "Cafe Two",
      callerId: "Cafe Two",
      phone: "",
      timezone: "America/Los_Angeles",
      defaultCallWindow: { start: "10:00", end: "18:00" }
    },
    assignedTwilioNumberId: assignSecondNumber ? "twilio_two" : "",
    openAiKeyEncrypted: secondOpenAiKey ? encryptSecret("sk-workspace-two", "test-key-secret") : "",
    openAiKeyMasked: secondOpenAiKey ? maskSecret("sk-workspace-two") : "",
    createdAt: now,
    updatedAt: now
  };

  return {
    business: workspaceOne.business,
    workspaces: [workspaceOne, workspaceTwo],
    users: [
      {
        id: "admin",
        email: "admin@example.com",
        passwordHash: hashPassword("adminpass"),
        role: "admin",
        workspaceId: "workspace_one",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "user_one",
        email: "one@example.com",
        passwordHash: hashPassword("pass-one"),
        role: "user",
        workspaceId: "workspace_one",
        createdAt: now,
        updatedAt: now
      }
    ],
    twilioNumbers: [
      {
        id: "twilio_one",
        phoneNumber: "+14155550111",
        label: "Cafe One line",
        workspaceId: "workspace_one",
        active: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "twilio_two",
        phoneNumber: "+14155550222",
        label: "Cafe Two line",
        workspaceId: assignSecondNumber ? "workspace_two" : "",
        active: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    contacts: [
      {
        id: "contact_one",
        workspaceId: "workspace_one",
        name: "Ava One",
        phone: "+14155551001",
        consentSource: "signup",
        tags: ["regular"],
        optedOut: false,
        createdAt: now
      },
      {
        id: "contact_two",
        workspaceId: "workspace_two",
        name: "Noah Two",
        phone: "+14155552002",
        consentSource: "signup",
        tags: ["regular"],
        optedOut: false,
        createdAt: now
      }
    ],
    campaigns: [
      {
        id: "campaign_one",
        workspaceId: "workspace_one",
        name: "Cafe One Event",
        type: "event",
        status: "draft",
        eventDate: "2026-05-23T10:00",
        location: "Cafe One",
        offer: "",
        objective: "Invite customers.",
        scriptNotes: "",
        targetTags: [],
        targetContactIds: ["contact_one"],
        createdAt: now
      },
      {
        id: "campaign_two",
        workspaceId: "workspace_two",
        name: "Cafe Two Event",
        type: "event",
        status: "draft",
        eventDate: "2026-05-23T10:00",
        location: "Cafe Two",
        offer: "",
        objective: "Invite customers.",
        scriptNotes: "",
        targetTags: [],
        targetContactIds: ["contact_two"],
        createdAt: now
      }
    ],
    knowledgeBase: [],
    callLogs: [],
    followUps: [],
    auditLogs: []
  };
}

function createStore(state) {
  const dir = mkdtempSync(join(tmpdir(), "callerdesk-test-"));
  const store = new SQLiteStore(join(dir, "app.db"), {
    jsonPath: join(dir, "missing.json"),
    env: { ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "adminpass", KEY_ENCRYPTION_SECRET: "test-key-secret" }
  });
  store.replace(state);
  return store;
}

test("SQLiteStore persists workspace-scoped records", () => {
  const store = createStore(baseState());
  const reloaded = new SQLiteStore(store.filePath, {
    jsonPath: join(tmpdir(), "missing-callerdesk.json"),
    env: { KEY_ENCRYPTION_SECRET: "test-key-secret" }
  });

  assert.equal(reloaded.state.workspaces.length, 2);
  assert.deepEqual(scopeStateToWorkspace(reloaded.state, "workspace_one").contacts.map((contact) => contact.id), ["contact_one"]);
  assert.deepEqual(scopeStateToWorkspace(reloaded.state, "workspace_two").contacts.map((contact) => contact.id), ["contact_two"]);
});

test("workspace access policy allows admin across workspaces and limits users", () => {
  const state = baseState();
  const admin = state.users.find((user) => user.role === "admin");
  const user = state.users.find((item) => item.id === "user_one");

  assert.equal(canAccessWorkspace(admin, "workspace_two"), true);
  assert.equal(canAccessWorkspace(user, "workspace_one"), true);
  assert.equal(canAccessWorkspace(user, "workspace_two"), false);
});

test("call readiness requires assigned numbers and live OpenAI keys", () => {
  assert.match(workspaceCallReadinessError(baseState({ assignSecondNumber: false }), "workspace_two"), /Assign a Twilio caller number/);
  assert.match(
    workspaceCallReadinessError(baseState({ secondOpenAiKey: false }), "workspace_two", { telephonyMode: "live", hasOpenAiKey: false }),
    /OpenAI API key/
  );
  assert.equal(workspaceCallReadinessError(baseState(), "workspace_one", { telephonyMode: "live", hasOpenAiKey: true }), "");
});
