import assert from "node:assert/strict";
import test from "node:test";
import { importContactsFromCsv, normalizePhone, parseCsv } from "../src/csv.js";

test("parseCsv handles quoted commas", () => {
  assert.deepEqual(parseCsv('name,phone,consent_source\n"Ava, P.",4155550101,loyalty'), [
    ["name", "phone", "consent_source"],
    ["Ava, P.", "4155550101", "loyalty"]
  ]);
});

test("normalizePhone converts US numbers to E.164", () => {
  assert.equal(normalizePhone("(415) 555-0101"), "+14155550101");
  assert.equal(normalizePhone("+442071838750"), "+442071838750");
  assert.equal(normalizePhone("12"), null);
});

test("importContactsFromCsv requires consent and skips duplicates", () => {
  const csv = `name,phone,consent_source,tags
Ava,4155550101,loyalty,regular;popup
No Consent,4155550102,,regular
Duplicate,4155550101,loyalty,regular`;

  const result = importContactsFromCsv(csv, []);

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].phone, "+14155550101");
  assert.deepEqual(result.contacts[0].tags, ["regular", "popup"]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /Consent source/);
  assert.match(result.errors[1].message, /Duplicate/);
});

test("importContactsFromCsv reports missing headers", () => {
  const result = importContactsFromCsv("name,phone\nAva,4155550101", []);
  assert.equal(result.contacts.length, 0);
  assert.match(result.errors[0].message, /consent_source/);
});
