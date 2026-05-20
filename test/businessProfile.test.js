import assert from "node:assert/strict";
import test from "node:test";
import { renderCallScript } from "../src/assistant.js";

test("renderCallScript uses saved business profile and caller identity", () => {
  const script = renderCallScript({
    business: {
      name: "Hawaii Trip Crew",
      callerId: "Shrey's Hawaii Trip Crew",
      timezone: "America/Los_Angeles"
    },
    campaign: {
      name: "Hawaii Hype Up",
      eventDate: "2026-05-21T09:00",
      location: "Honolulu",
      offer: "",
      objective: "",
      scriptNotes: ""
    },
    contact: { name: "Shrey" }
  });

  assert.match(script, /this is Shrey's Hawaii Trip Crew/);
  assert.match(script, /Hawaii Trip Crew wanted to personally invite you/);
  assert.doesNotMatch(script, /Mina/);
});
