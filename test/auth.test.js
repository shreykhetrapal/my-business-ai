import assert from "node:assert/strict";
import test from "node:test";
import { authEnabled, verifyPassword } from "../src/auth.js";

test("auth is disabled when ADMIN_PASSWORD is absent", () => {
  const previous = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    assert.equal(authEnabled(), false);
    assert.equal(verifyPassword("anything"), true);
  } finally {
    if (previous) process.env.ADMIN_PASSWORD = previous;
  }
});

test("verifyPassword checks ADMIN_PASSWORD when enabled", () => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "secret";
  try {
    assert.equal(authEnabled(), true);
    assert.equal(verifyPassword("secret"), true);
    assert.equal(verifyPassword("wrong"), false);
  } finally {
    if (previous) process.env.ADMIN_PASSWORD = previous;
    else delete process.env.ADMIN_PASSWORD;
  }
});
