import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpeningResponseInstructions,
  buildRealtimeInstructions,
  getRealtimeSilenceTimeoutMs,
  isCustomerEndIntent,
  shouldIgnoreCustomerAudio
} from "../src/realtimeBridge.js";

test("buildRealtimeInstructions forbids generic first-call greeting", () => {
  const instructions = buildRealtimeInstructions({
    business: { name: "Trip Crew", callerId: "Trip Crew", timezone: "America/Los_Angeles" },
    campaign: {
      id: "hawaii",
      name: "Hawaii Hype Up",
      eventDate: "2026-05-21T09:00",
      location: "Hawaii",
      offer: "",
      objective: "",
      scriptOverride: "Aloha, {{customer_name}}! We see each other in Hawaii TOMORROW!"
    },
    contact: { name: "Shrey" },
    knowledgeBase: []
  });

  assert.match(instructions, /first assistant response must be the approved invitation script/i);
  assert.match(instructions, /Do not start with a generic greeting/i);
  assert.match(instructions, /Aloha, Shrey/);
});

test("buildOpeningResponseInstructions uses campaign script notes for delivery style", () => {
  const instructions = buildOpeningResponseInstructions({
    business: { name: "Trip Crew", callerId: "Trip Crew", timezone: "America/Los_Angeles" },
    campaign: {
      id: "hawaii",
      name: "Hawaii Hype Up",
      scriptNotes: "Sound bright, excited, and celebratory.",
      scriptOverride: "Aloha, {{customer_name}}!"
    },
    contact: { name: "Shrey" }
  });

  assert.match(instructions, /Delivery\/style notes from the campaign: Sound bright, excited, and celebratory\./);
  assert.match(instructions, /Aloha, Shrey!/);
  assert.doesNotMatch(instructions, /Use a bright, excited, celebratory delivery while preserving the wording\./);
});

test("buildOpeningResponseInstructions supports one-way message delivery", () => {
  const instructions = buildOpeningResponseInstructions({
    business: { name: "Trip Crew", callerId: "Trip Crew", timezone: "America/Los_Angeles" },
    campaign: {
      id: "hawaii",
      name: "Hawaii Hype Up",
      callMode: "message",
      scriptNotes: "High energy.",
      scriptOverride: "Aloha, {{customer_name}}!"
    },
    contact: { name: "Shrey" }
  });

  assert.match(instructions, /After the script is complete, stop speaking/);
  assert.match(instructions, /Do not ask for questions/);
});

test("buildOpeningResponseInstructions supports message then Q&A", () => {
  const instructions = buildOpeningResponseInstructions({
    business: { name: "Trip Crew", callerId: "Trip Crew", timezone: "America/Los_Angeles" },
    campaign: {
      id: "hawaii",
      name: "Hawaii Hype Up",
      callMode: "message_then_conversation",
      scriptNotes: "High energy.",
      scriptOverride: "Aloha, {{customer_name}}!"
    },
    contact: { name: "Shrey" }
  });

  assert.match(instructions, /I can answer quick questions now/);
  assert.match(instructions, /Then pause for the customer to reply/);
});

test("buildOpeningResponseInstructions includes campaign language guidance", () => {
  const instructions = buildOpeningResponseInstructions({
    business: { name: "Trip Crew", callerId: "Trip Crew", timezone: "America/Los_Angeles" },
    campaign: {
      id: "hawaii",
      name: "Hawaii Hype Up",
      languageMode: "hinglish",
      languageInstructions: "Use [Hindi] for the greeting and [English] for place names.",
      scriptOverride: "[Hindi] Namaste {{customer_name}}. [English] Hawaii tomorrow."
    },
    contact: { name: "Shrey" }
  });

  assert.match(instructions, /Campaign language mode: Hinglish/);
  assert.match(instructions, /Campaign language notes: Use \[Hindi\]/);
  assert.match(instructions, /do not read bracketed language markers aloud/i);
});

test("message then Q&A ignores customer audio until Twilio finishes playback", () => {
  assert.equal(
    shouldIgnoreCustomerAudio({
      callMode: "message_then_conversation",
      greetingFinished: false,
      lastAudioMarkSent: "openai-audio-1",
      lastAudioMarkReceived: null
    }),
    true
  );

  assert.equal(
    shouldIgnoreCustomerAudio({
      callMode: "message_then_conversation",
      greetingFinished: true,
      lastAudioMarkSent: "openai-audio-2",
      lastAudioMarkReceived: "openai-audio-1"
    }),
    true
  );

  assert.equal(
    shouldIgnoreCustomerAudio({
      callMode: "message_then_conversation",
      greetingFinished: true,
      lastAudioMarkSent: "openai-audio-2",
      lastAudioMarkReceived: "openai-audio-2"
    }),
    false
  );
});

test("realtime silence timeout defaults to 20 seconds", () => {
  assert.equal(getRealtimeSilenceTimeoutMs({}), 20_000);
  assert.equal(getRealtimeSilenceTimeoutMs({ REALTIME_SILENCE_TIMEOUT_MS: "12000" }), 12_000);
});

test("customer end intent catches closings without catching follow-up questions", () => {
  assert.equal(isCustomerEndIntent("thank you"), true);
  assert.equal(isCustomerEndIntent("ok that's all"), true);
  assert.equal(isCustomerEndIntent("ok bye"), true);
  assert.equal(isCustomerEndIntent("bas itna"), true);
  assert.equal(isCustomerEndIntent("shukriya"), true);
  assert.equal(isCustomerEndIntent("thank you, I have another question"), false);
});
