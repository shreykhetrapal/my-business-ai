function safeText(value) {
  return String(value ?? "").trim();
}

function scopedKnowledge(knowledgeBase = [], campaignId = "") {
  return knowledgeBase.filter((item) => item.scope === "global" || item.scope === campaignId);
}

function extractOutputText(payload) {
  if (!payload) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output)) {
    return payload.output
      .flatMap((item) => item.content || [])
      .map((part) => part.text || part.output_text || "")
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(payload.choices)) {
    return payload.choices.map((choice) => choice.message?.content || choice.text || "").filter(Boolean).join("\n");
  }
  return "";
}

export function parseAiReply(payload) {
  const raw = typeof payload === "string" ? payload : extractOutputText(payload);
  const trimmed = safeText(raw).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return {
      replyText: safeText(parsed.replyText),
      canAnswer: Boolean(parsed.canAnswer),
      followUpRequired: Boolean(parsed.followUpRequired),
      handoffRequired: Boolean(parsed.handoffRequired),
      optOut: Boolean(parsed.optOut)
    };
  } catch {
    return {
      replyText: "Thanks for the message. I will have the team follow up with you.",
      canAnswer: false,
      followUpRequired: true,
      handoffRequired: true,
      optOut: false
    };
  }
}

export function buildMessagingAiPrompt({ business = {}, campaign = {}, contact = {}, knowledgeBase = [], inboundText = "" }) {
  const facts = [
    `Business: ${business.name || "Unknown"}`,
    `Campaign: ${campaign.name || "Unknown"}`,
    `When: ${campaign.eventDate || "Not provided"}`,
    `Location: ${campaign.location || "Not provided"}`,
    campaign.offer ? `Offer: ${campaign.offer}` : "",
    campaign.objective ? `Objective: ${campaign.objective}` : "",
    `Customer: ${contact.name || "Unknown"} ${contact.phone || ""}`
  ]
    .filter(Boolean)
    .join("\n");
  const knowledge = scopedKnowledge(knowledgeBase, campaign.id)
    .map((item) => `- ${item.topic}: Q: ${item.question} A: ${item.answer}`)
    .join("\n");

  return [
    "You reply for a small business campaign message thread.",
    "Answer only from the approved campaign facts and knowledge base below.",
    "If the customer asks for scheduling, appointments, callbacks, custom orders, or anything not explicitly answered, set followUpRequired and handoffRequired true.",
    "If the customer asks to opt out, set optOut true and use a short opt-out confirmation.",
    "Return only valid JSON with these fields: replyText, canAnswer, followUpRequired, handoffRequired, optOut.",
    "",
    "Approved facts:",
    facts,
    "",
    "Approved knowledge:",
    knowledge || "- No extra approved answers.",
    "",
    `Customer message: ${inboundText}`
  ].join("\n");
}

export async function createMessagingAiReply({
  apiKey,
  business,
  campaign,
  contact,
  knowledgeBase,
  inboundText,
  fetchImpl = fetch,
  env = process.env
}) {
  if (!apiKey) {
    return {
      replyText: "Thanks for the message. I will have the team follow up with you.",
      canAnswer: false,
      followUpRequired: true,
      handoffRequired: true,
      optOut: false,
      error: "Missing OpenAI API key for this workspace."
    };
  }

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-5.2",
      input: buildMessagingAiPrompt({ business, campaign, contact, knowledgeBase, inboundText }),
      text: {
        format: {
          type: "json_schema",
          name: "campaign_message_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              replyText: { type: "string" },
              canAnswer: { type: "boolean" },
              followUpRequired: { type: "boolean" },
              handoffRequired: { type: "boolean" },
              optOut: { type: "boolean" }
            },
            required: ["replyText", "canAnswer", "followUpRequired", "handoffRequired", "optOut"]
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      replyText: "Thanks for the message. I will have the team follow up with you.",
      canAnswer: false,
      followUpRequired: true,
      handoffRequired: true,
      optOut: false,
      error: payload.error?.message || payload.message || `OpenAI request failed with ${response.status}.`
    };
  }

  const parsed = parseAiReply(payload);
  if (!parsed.replyText) {
    return {
      replyText: "Thanks for the message. I will have the team follow up with you.",
      canAnswer: false,
      followUpRequired: true,
      handoffRequired: true,
      optOut: false
    };
  }
  return parsed;
}
