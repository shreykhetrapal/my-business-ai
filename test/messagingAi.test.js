import assert from "node:assert/strict";
import test from "node:test";
import { buildMessagingAiPrompt, createMessagingAiReply, parseAiReply } from "../src/messagingAi.js";

test("parseAiReply reads structured output JSON", () => {
  const result = parseAiReply({
    output_text: JSON.stringify({
      replyText: "It starts at 4 PM.",
      canAnswer: true,
      followUpRequired: false,
      handoffRequired: false,
      optOut: false
    })
  });

  assert.equal(result.replyText, "It starts at 4 PM.");
  assert.equal(result.canAnswer, true);
  assert.equal(result.handoffRequired, false);
});

test("parseAiReply falls back to handoff on invalid JSON", () => {
  const result = parseAiReply("not json");

  assert.equal(result.canAnswer, false);
  assert.equal(result.followUpRequired, true);
  assert.equal(result.handoffRequired, true);
});

test("buildMessagingAiPrompt includes campaign facts and handoff guidance", () => {
  const prompt = buildMessagingAiPrompt({
    business: { name: "Cafe" },
    campaign: { id: "campaign_1", name: "Popup", location: "18 Oak" },
    contact: { name: "Ava" },
    knowledgeBase: [{ scope: "campaign_1", topic: "parking", question: "Parking?", answer: "Street parking is available." }],
    inboundText: "Where is it?"
  });

  assert.match(prompt, /Cafe/);
  assert.match(prompt, /18 Oak/);
  assert.match(prompt, /Street parking/);
  assert.match(prompt, /Return only valid JSON/);
});

test("createMessagingAiReply posts Responses API request and parses answer", async () => {
  let receivedBody = null;
  const result = await createMessagingAiReply({
    apiKey: "sk-test",
    business: { name: "Cafe" },
    campaign: { id: "campaign_1", name: "Popup" },
    contact: { name: "Ava" },
    knowledgeBase: [],
    inboundText: "When?",
    env: { OPENAI_TEXT_MODEL: "gpt-test" },
    fetchImpl: async (url, options) => {
      receivedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            replyText: "It starts at 4 PM.",
            canAnswer: true,
            followUpRequired: false,
            handoffRequired: false,
            optOut: false
          })
        })
      };
    }
  });

  assert.equal(receivedBody.model, "gpt-test");
  assert.equal(receivedBody.text.format.type, "json_schema");
  assert.equal(result.replyText, "It starts at 4 PM.");
  assert.equal(result.canAnswer, true);
});

test("createMessagingAiReply handoffs when OpenAI key is missing", async () => {
  const result = await createMessagingAiReply({
    apiKey: "",
    business: { name: "Cafe" },
    campaign: { id: "campaign_1", name: "Popup" },
    contact: { name: "Ava" },
    knowledgeBase: [],
    inboundText: "Can you call me back?"
  });

  assert.equal(result.followUpRequired, true);
  assert.equal(result.handoffRequired, true);
  assert.match(result.error, /Missing OpenAI API key/);
});
