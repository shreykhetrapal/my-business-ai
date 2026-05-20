const stopWords = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "at",
  "be",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "is",
  "it",
  "me",
  "need",
  "of",
  "on",
  "or",
  "the",
  "there",
  "to",
  "what",
  "when",
  "where",
  "with",
  "you"
]);

export function formatDateTime(value, timezone = "America/Los_Angeles") {
  if (!value) {
    return "the scheduled time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone
  }).format(date);
}

export function renderCallScript({ business, campaign, contact }) {
  if (campaign.scriptOverride) {
    return campaign.scriptOverride
      .replaceAll("{{customer_name}}", contact?.name || "there")
      .replaceAll("{{business_name}}", business.name)
      .replaceAll("{{campaign_name}}", campaign.name);
  }

  const customerName = contact?.name || "there";
  const eventTime = formatDateTime(campaign.eventDate, business.timezone);
  const caller = business.callerId || business.name;

  return [
    `Hi ${customerName}, this is ${caller}.`,
    `I am calling because ${business.name} wanted to personally invite you to ${campaign.name}.`,
    `It is happening ${eventTime} at ${campaign.location}.`,
    campaign.offer ? `The offer is: ${campaign.offer}.` : null,
    campaign.objective ? campaign.objective : null,
    campaign.scriptNotes ? campaign.scriptNotes : null,
    "I can answer quick questions about the event using the details the team approved.",
    "If I cannot answer something, I will take a message so the business can follow up.",
    "You can also ask not to receive future calls."
  ]
    .filter(Boolean)
    .join(" ");
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function tokenRoot(token) {
  return token.length > 5 ? token.slice(0, 5) : token;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAny(question, words) {
  const lower = question.toLowerCase();
  return words.some((word) => {
    const target = word.toLowerCase();
    if (target.includes(" ") || /[^a-z0-9]/.test(target)) {
      return lower.includes(target);
    }
    return new RegExp(`\\b${escapeRegExp(target)}\\b`).test(lower);
  });
}

export function answerQuestion({ business, campaign, knowledgeBase = [], question }) {
  const rawQuestion = String(question || "").trim();
  if (!rawQuestion) {
    return {
      canAnswer: false,
      confidence: 0,
      answer: "I can take a message and have the team follow up.",
      followUpRequired: true
    };
  }

  if (containsAny(rawQuestion, ["stop calling", "do not call", "don't call", "unsubscribe", "opt out"])) {
    return {
      canAnswer: true,
      confidence: 1,
      answer: "I understand. I will mark this number as opted out so you do not receive future calls.",
      action: "opt_out",
      followUpRequired: false
    };
  }

  const questionTokens = new Set(tokenize(rawQuestion).flatMap((token) => [token, tokenRoot(token)]));
  const scopedKb = knowledgeBase.filter((item) => item.scope === "global" || item.scope === campaign.id);
  const ranked = scopedKb
    .map((item) => {
      const haystack = tokenize(`${item.topic} ${item.question} ${item.answer}`);
      const overlap = haystack.reduce((score, token) => score + (questionTokens.has(token) || questionTokens.has(tokenRoot(token)) ? 1 : 0), 0);
      return { item, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  if (ranked[0]?.overlap >= 1) {
    return {
      canAnswer: true,
      confidence: Math.min(0.85, 0.45 + ranked[0].overlap * 0.15),
      answer: ranked[0].item.answer,
      source: ranked[0].item.id,
      followUpRequired: false
    };
  }

  if (
    containsAny(rawQuestion, [
      "schedule",
      "appointment",
      "book",
      "booking",
      "reserve",
      "reservation",
      "slot",
      "call back",
      "callback",
      "follow up",
      "reminder",
      "confirm"
    ])
  ) {
    return {
      canAnswer: false,
      confidence: 0.75,
      answer: `I can take a message for ${business.name} so the team can follow up about scheduling.`,
      followUpRequired: true
    };
  }

  if (containsAny(rawQuestion, ["when", "time", "date", "day"])) {
    return {
      canAnswer: true,
      confidence: 0.95,
      answer: `${campaign.name} is scheduled for ${formatDateTime(campaign.eventDate, business.timezone)}.`,
      followUpRequired: false
    };
  }

  if (containsAny(rawQuestion, ["where", "address", "location", "parking"])) {
    return {
      canAnswer: true,
      confidence: 0.9,
      answer: `${campaign.name} is at ${campaign.location}.`,
      followUpRequired: false
    };
  }

  if (campaign.offer && containsAny(rawQuestion, ["offer", "sale", "discount", "deal", "free", "special"])) {
    return {
      canAnswer: true,
      confidence: 0.9,
      answer: `The approved offer is: ${campaign.offer}.`,
      followUpRequired: false
    };
  }

  return {
    canAnswer: false,
    confidence: 0,
    answer: `I do not have an approved answer for that yet. I can take a message for ${business.name} and ask them to follow up.`,
    followUpRequired: true
  };
}
