import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, maskSecret } from "../src/cryptoSecrets.js";

test("OpenAI keys encrypt at rest and require the configured secret", () => {
  const encrypted = encryptSecret("sk-test-secret", "workspace-secret");

  assert.notEqual(encrypted, "sk-test-secret");
  assert.equal(decryptSecret(encrypted, "workspace-secret"), "sk-test-secret");
  assert.throws(() => decryptSecret(encrypted, "wrong-secret"));
});

test("maskSecret shows only a small prefix and suffix", () => {
  assert.equal(maskSecret("sk-abcdef123456"), "sk-****3456");
});
