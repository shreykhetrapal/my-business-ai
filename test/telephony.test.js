import assert from "node:assert/strict";
import test from "node:test";
import { getTelephonyConfig, TelephonyAdapter } from "../src/telephony.js";

test("getTelephonyConfig defaults to dry-run", () => {
  const config = getTelephonyConfig({});
  assert.equal(config.mode, "dry-run");
  assert.equal(config.liveReady, false);
});

test("getTelephonyConfig marks Twilio live as ready when required env exists", () => {
  const config = getTelephonyConfig({
    TELEPHONY_MODE: "live",
    TELEPHONY_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "secret",
    TWILIO_FROM_NUMBER: "+14155550199",
    PUBLIC_BASE_URL: "https://calls.example.com"
  });

  assert.equal(config.liveReady, true);
});

test("TelephonyAdapter dry-run queues locally", async () => {
  const adapter = new TelephonyAdapter({ env: { TELEPHONY_MODE: "dry-run" } });
  const result = await adapter.createCall({
    contact: { phone: "+14155550101" },
    callLogId: "call_123"
  });

  assert.equal(result.status, "queued_local");
  assert.equal(result.providerCallId, "dry_call_123");
});

test("TelephonyAdapter live mode posts Twilio call request", async () => {
  let receivedUrl = "";
  let receivedBody = "";
  const adapter = new TelephonyAdapter({
    env: {
      TELEPHONY_MODE: "live",
      TELEPHONY_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM_NUMBER: "+14155550199",
      PUBLIC_BASE_URL: "https://calls.example.com/"
    },
    fetchImpl: async (url, options) => {
      receivedUrl = url;
      receivedBody = String(options.body);
      return {
        ok: true,
        json: async () => ({ sid: "CA123", status: "queued" })
      };
    }
  });

  const result = await adapter.createCall({
    contact: { phone: "+14155550101" },
    callLogId: "call_456"
  });

  assert.match(receivedUrl, /AC123\/Calls\.json/);
  assert.match(receivedBody, /To=%2B14155550101/);
  assert.match(receivedBody, /Url=https%3A%2F%2Fcalls.example.com%2Fvoice%2Fcall_456/);
  assert.equal(result.providerCallId, "CA123");
});

test("TelephonyAdapter live mode uses workspace assigned from number", async () => {
  let receivedBody = "";
  const adapter = new TelephonyAdapter({
    env: {
      TELEPHONY_MODE: "live",
      TELEPHONY_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM_NUMBER: "+14155550000",
      PUBLIC_BASE_URL: "https://calls.example.com/"
    },
    fetchImpl: async (url, options) => {
      receivedBody = String(options.body);
      return {
        ok: true,
        json: async () => ({ sid: "CA456", status: "queued" })
      };
    }
  });

  await adapter.createCall({
    contact: { phone: "+14155550101" },
    callLogId: "call_789",
    fromNumber: "+14155559999"
  });

  assert.match(receivedBody, /From=%2B14155559999/);
  assert.doesNotMatch(receivedBody, /From=%2B14155550000/);
});

test("TelephonyAdapter live mode requires a from number", async () => {
  const adapter = new TelephonyAdapter({
    env: {
      TELEPHONY_MODE: "live",
      TELEPHONY_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      PUBLIC_BASE_URL: "https://calls.example.com/"
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    }
  });

  await assert.rejects(
    () => adapter.createCall({ contact: { phone: "+14155550101" }, callLogId: "call_missing_from" }),
    /workspace Twilio caller number/
  );
});

test("TelephonyAdapter live mode can end a Twilio call", async () => {
  let receivedUrl = "";
  let receivedBody = "";
  const adapter = new TelephonyAdapter({
    env: {
      TELEPHONY_MODE: "live",
      TELEPHONY_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM_NUMBER: "+14155550199",
      PUBLIC_BASE_URL: "https://calls.example.com/"
    },
    fetchImpl: async (url, options) => {
      receivedUrl = url;
      receivedBody = String(options.body);
      return {
        ok: true,
        json: async () => ({ sid: "CA123", status: "completed" })
      };
    }
  });

  const result = await adapter.endCall({ providerCallId: "CA123" });

  assert.match(receivedUrl, /AC123\/Calls\/CA123\.json/);
  assert.match(receivedBody, /Status=completed/);
  assert.equal(result.status, "completed");
});
