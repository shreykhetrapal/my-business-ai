import assert from "node:assert/strict";
import test from "node:test";
import { setContactCallPermission } from "../src/contactPermissions.js";

test("setContactCallPermission toggles opt out and opt in", () => {
  const contact = {
    name: "Ava",
    phone: "+14155550101",
    consentSource: "loyalty signup",
    optedOut: false
  };

  setContactCallPermission(contact, true);
  assert.equal(contact.optedOut, true);
  assert.ok(contact.optedOutAt);
  assert.equal(contact.optedInAt, undefined);

  setContactCallPermission(contact, false);
  assert.equal(contact.optedOut, false);
  assert.ok(contact.optedInAt);
  assert.equal(contact.optedOutAt, undefined);
});

test("setContactCallPermission rejects opt in without consent source", () => {
  const contact = {
    name: "Ava",
    phone: "+14155550101",
    consentSource: "",
    optedOut: true
  };

  assert.throws(() => setContactCallPermission(contact, false), /consent source/);
});
