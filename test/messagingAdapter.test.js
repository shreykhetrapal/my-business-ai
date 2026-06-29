import assert from "node:assert/strict";
import test from "node:test";
import { MessagingAdapter } from "../src/messaging.js";

test("MessagingAdapter dry-run queues locally", async () => {
  const adapter = new MessagingAdapter({ env: { MESSAGING_MODE: "dry-run" } });
  const result = await adapter.sendMessage({
    channel: "sms",
    to: "+14155550101",
    body: "Hello",
    sender: { fromAddress: "+14155550199" },
    messageLogId: "msg_123"
  });

  assert.equal(result.status, "queued_local");
  assert.equal(result.providerMessageId, "dry_msg_msg_123");
});

test("MessagingAdapter live SMS payload uses From, Body, and StatusCallback", async () => {
  let receivedUrl = "";
  let receivedBody = "";
  const adapter = new MessagingAdapter({
    env: {
      MESSAGING_MODE: "live",
      MESSAGING_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      PUBLIC_BASE_URL: "https://calls.example.com/"
    },
    fetchImpl: async (url, options) => {
      receivedUrl = url;
      receivedBody = String(options.body);
      return { ok: true, json: async () => ({ sid: "SM123", status: "queued" }) };
    }
  });

  const result = await adapter.sendMessage({
    channel: "sms",
    to: "+14155550101",
    body: "Hello Ava",
    sender: { fromAddress: "+14155550199" },
    messageLogId: "msg_456"
  });

  assert.match(receivedUrl, /AC123\/Messages\.json/);
  assert.match(receivedBody, /To=%2B14155550101/);
  assert.match(receivedBody, /From=%2B14155550199/);
  assert.match(receivedBody, /Body=Hello\+Ava/);
  assert.match(receivedBody, /StatusCallback=https%3A%2F%2Fcalls.example.com%2Fmessaging%2Fstatus%2Fmsg_456/);
  assert.equal(result.providerMessageId, "SM123");
});

test("MessagingAdapter live WhatsApp payload uses ContentSid and ContentVariables", async () => {
  let receivedBody = "";
  const adapter = new MessagingAdapter({
    env: {
      MESSAGING_MODE: "live",
      MESSAGING_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      PUBLIC_BASE_URL: "https://calls.example.com"
    },
    fetchImpl: async (url, options) => {
      receivedBody = String(options.body);
      return { ok: true, json: async () => ({ sid: "SM456", status: "queued" }) };
    }
  });

  await adapter.sendMessage({
    channel: "whatsapp",
    to: "+14155550101",
    contentSid: "HX123",
    contentVariables: { 1: "Ava" },
    sender: { messagingServiceSid: "MG123" },
    messageLogId: "msg_789"
  });

  assert.match(receivedBody, /To=whatsapp%3A%2B14155550101/);
  assert.match(receivedBody, /MessagingServiceSid=MG123/);
  assert.match(receivedBody, /ContentSid=HX123/);
  assert.match(receivedBody, /ContentVariables=%7B%221%22%3A%22Ava%22%7D/);
  assert.doesNotMatch(receivedBody, /Body=/);
});
