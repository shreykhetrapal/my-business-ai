import { createId, nowIso } from "./store.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldCreateFollowUpFromAssistantText(text) {
  const lower = normalizeText(text);
  if (!lower) return false;

  const genericHelpfulClosers = [
    "if i cannot answer something, i will take a message",
    "if i can't answer something, i will take a message",
    "you can also ask not to receive future calls",
    "won't receive future calls",
    "won’t receive future calls",
    "will not receive future calls",
    "not receive future calls",
    "feel free to reach out",
    "looking forward to seeing you",
    "if you need anything else",
    "if you have any more questions",
    "let me know if you have any questions"
  ];
  if (genericHelpfulClosers.some((phrase) => lower.includes(phrase))) return false;

  const commitmentPatterns = [
    /\bi('|’)ll\b.*\b(follow up|reach out|call back|message|note|let .* know|send .* confirmation|send .* reminder|confirm|schedule|book)/,
    /\bi will\b.*\b(follow up|reach out|call back|message|note|let .* know|send .* confirmation|send .* reminder|confirm|schedule|book)/,
    /\bwe('|’)ll\b.*\b(follow up|reach out|call back|message|note|send .* confirmation|send .* reminder|confirm|schedule|book)/,
    /\bwe will\b.*\b(follow up|reach out|call back|message|note|send .* confirmation|send .* reminder|confirm|schedule|book)/,
    /\b(take|taking) a message\b/,
    /\b(make|made|making) a note\b/,
    /\bnoting that down\b/,
    /\bfollow up with you\b/,
    /\breach out to you\b/,
    /\bcall you back\b/,
    /\bsend (a )?(confirmation|reminder)\b/,
    /\b(appointment|booking|slot|schedule|scheduled|confirmation)\b/
  ];

  const hindiCommitmentPatterns = [
    /confirm kar/,
    /schedule kar/,
    /time .* confirm/,
    /समय .* confirm/,
    /follow.?up/,
    /message/,
    /note/
  ];

  return commitmentPatterns.some((pattern) => pattern.test(lower)) || hindiCommitmentPatterns.some((pattern) => pattern.test(lower));
}

export function ensureFollowUp({ store, callLog, campaign, contact, question, source = "customer_question" }) {
  const text = String(question || "").trim();
  if (!text) return null;

  store.state.followUps ||= [];
  callLog.unansweredQuestions ||= [];

  const normalized = normalizeText(text);
  const existing = store.state.followUps.find(
    (item) => item.callLogId === callLog.id && normalizeText(item.question) === normalized && item.status !== "closed"
  );
  if (existing) return existing;

  if (source === "assistant_transcript") {
    const existingAssistantFollowUp = store.state.followUps.find(
      (item) => item.callLogId === callLog.id && item.source === "assistant_transcript" && item.status !== "closed"
    );
    if (existingAssistantFollowUp) {
      if (!normalizeText(existingAssistantFollowUp.question).includes(normalized)) {
        existingAssistantFollowUp.question = `${existingAssistantFollowUp.question}\n${text}`;
        existingAssistantFollowUp.updatedAt = nowIso();
      }
      callLog.followUpRequired = true;
      if (!callLog.unansweredQuestions.some((item) => normalizeText(item) === normalized)) {
        callLog.unansweredQuestions.push(text);
      }
      return existingAssistantFollowUp;
    }
  }

  callLog.followUpRequired = true;
  if (!callLog.unansweredQuestions.some((item) => normalizeText(item) === normalized)) {
    callLog.unansweredQuestions.push(text);
  }

  const followUp = {
    id: createId("followup"),
    workspaceId: callLog.workspaceId || campaign.workspaceId || contact.workspaceId || "",
    callLogId: callLog.id,
    campaignId: campaign.id,
    contactId: contact.id,
    question: text,
    source,
    status: "open",
    createdAt: nowIso()
  };
  store.state.followUps.unshift(followUp);
  return followUp;
}
