import assert from "node:assert/strict";
import test from "node:test";
import { ensureFollowUp, shouldCreateFollowUpFromAssistantText } from "../src/followUps.js";

test("assistant scheduling commitments create follow-up signals", () => {
  assert.equal(shouldCreateFollowUpFromAssistantText("I'll send a confirmation for Wednesday at 12 noon."), true);
  assert.equal(shouldCreateFollowUpFromAssistantText("I can take a message for the business to follow up."), true);
  assert.equal(shouldCreateFollowUpFromAssistantText("Feel free to reach out if you have any more questions."), false);
});

test("ensureFollowUp creates and deduplicates follow-up records", () => {
  const store = { state: { followUps: [] } };
  const callLog = { id: "call_1", unansweredQuestions: [], followUpRequired: false };
  const campaign = { id: "campaign_1" };
  const contact = { id: "contact_1" };

  const first = ensureFollowUp({
    store,
    callLog,
    campaign,
    contact,
    question: "Please call me back tomorrow.",
    source: "customer_transcript"
  });
  const second = ensureFollowUp({
    store,
    callLog,
    campaign,
    contact,
    question: "Please call me back tomorrow.",
    source: "customer_transcript"
  });

  assert.equal(first.id, second.id);
  assert.equal(store.state.followUps.length, 1);
  assert.equal(callLog.followUpRequired, true);
  assert.deepEqual(callLog.unansweredQuestions, ["Please call me back tomorrow."]);
});
