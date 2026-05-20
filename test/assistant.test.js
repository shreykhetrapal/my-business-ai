import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, renderCallScript } from "../src/assistant.js";

const business = {
  name: "Mina's Corner Cafe",
  callerId: "Mina from Mina's Corner Cafe",
  timezone: "America/Los_Angeles"
};

const campaign = {
  id: "campaign_demo",
  name: "Saturday Latte Art Popup",
  eventDate: "2026-05-23T16:00",
  location: "18 Oak Street",
  offer: "Free mini pastry with any specialty latte",
  objective: "Invite regulars.",
  scriptNotes: "Mention limited seating."
};

const knowledgeBase = [
  {
    id: "kb_reservations",
    scope: "campaign_demo",
    topic: "reservations",
    question: "Do I need a reservation?",
    answer: "Reservations are not required, but arriving early is recommended."
  }
];

test("renderCallScript includes approved campaign facts", () => {
  const script = renderCallScript({ business, campaign, contact: { name: "Ava" } });

  assert.match(script, /Hi Ava/);
  assert.match(script, /Saturday Latte Art Popup/);
  assert.match(script, /18 Oak Street/);
  assert.match(script, /Free mini pastry/);
  assert.match(script, /If I cannot answer/);
});

test("renderCallScript uses editable campaign script override", () => {
  const script = renderCallScript({
    business,
    campaign: {
      ...campaign,
      scriptOverride: "Hi {{customer_name}}, {{business_name}} has {{campaign_name}} today."
    },
    contact: { name: "Ava" }
  });

  assert.equal(script, "Hi Ava, Mina's Corner Cafe has Saturday Latte Art Popup today.");
});

test("answerQuestion answers campaign facts", () => {
  const answer = answerQuestion({ business, campaign, knowledgeBase, question: "Where is it?" });

  assert.equal(answer.canAnswer, true);
  assert.equal(answer.followUpRequired, false);
  assert.match(answer.answer, /18 Oak Street/);
});

test("answerQuestion answers from scoped knowledge base", () => {
  const answer = answerQuestion({ business, campaign, knowledgeBase, question: "Should I reserve a seat?" });

  assert.equal(answer.canAnswer, true);
  assert.equal(answer.source, "kb_reservations");
  assert.match(answer.answer, /Reservations are not required/);
});

test("answerQuestion turns unknowns into follow-ups", () => {
  const answer = answerQuestion({ business, campaign, knowledgeBase, question: "Can you cater my wedding?" });

  assert.equal(answer.canAnswer, false);
  assert.equal(answer.followUpRequired, true);
});

test("answerQuestion turns appointment requests into follow-ups", () => {
  const answer = answerQuestion({ business, campaign, knowledgeBase, question: "Can I schedule for Wednesday at noon?" });

  assert.equal(answer.canAnswer, false);
  assert.equal(answer.followUpRequired, true);
  assert.match(answer.answer, /follow up about scheduling/);
});

test("answerQuestion detects opt-out requests", () => {
  const answer = answerQuestion({ business, campaign, knowledgeBase, question: "Please do not call me again" });

  assert.equal(answer.canAnswer, true);
  assert.equal(answer.action, "opt_out");
});
