import { assert, test } from "./harness.js";
import { emptyHealthDocument, emptyHealthEntry, HEALTH_LIMITS } from "../js/health.js";
import { createHealthVault, parseHealthVault, sealHealthVault, unlockHealthVault } from "../js/health-vault.js";

const passphrase = "테스트 전용 암호 예시";

function fixture() {
  const document = emptyHealthDocument();
  document.entries.push({ ...emptyHealthEntry("2026-01-01"), notes: "건강 기록 테스트" });
  return document;
}

test("vaults preserve Korean text and use nonextractable keys and fresh randomness", async () => {
  const document = fixture();
  const { key, envelope } = await createHealthVault(document, passphrase);
  const savedAgain = await sealHealthVault(document, key, envelope.salt);
  const independent = await createHealthVault(document, passphrase);

  assert.equal(key.extractable, false);
  assert.deepEqual(key.algorithm, { name: "AES-GCM", length: 256 });
  assert.equal(atob(envelope.salt).length, 16);
  assert.equal(atob(envelope.iv).length, 12);
  assert.notEqual(independent.envelope.salt, envelope.salt);
  assert.notEqual(savedAgain.iv, envelope.iv);
  assert.notEqual(savedAgain.ciphertext, envelope.ciphertext);

  const serialized = JSON.stringify(savedAgain);
  assert.ok(!serialized.includes(document.entries[0].notes));
  const unlocked = await unlockHealthVault(parseHealthVault(serialized), passphrase);
  assert.equal(unlocked.key.extractable, false);
  assert.deepEqual(unlocked.document, document);
});

test("rejects incorrect passwords and tampered ciphertext", async () => {
  const { envelope } = await createHealthVault(fixture(), passphrase);
  await assert.rejects(unlockHealthVault(envelope, "다른 암호"), /암호/);
  const first = envelope.ciphertext.startsWith("A") ? "B" : "A";
  const changed = { ...envelope, ciphertext: first + envelope.ciphertext.slice(1) };
  await assert.rejects(unlockHealthVault(changed, passphrase), /손상/);
});

test("rejects invalid envelope versions, field sizes, encodings, and extra fields", async () => {
  const { envelope } = await createHealthVault(fixture(), passphrase);
  const malformed = [
    { ...envelope, version: 2 },
    { ...envelope, salt: btoa("short") },
    { ...envelope, iv: envelope.iv + "\n" },
    { ...envelope, ciphertext: btoa("too short") },
    { ...envelope, ciphertext: btoa("x".repeat(HEALTH_LIMITS.fileBytes + 17)) },
    { ...envelope, notes: "unexpected plaintext" },
  ];
  for (const invalid of malformed) {
    assert.throws(() => parseHealthVault(JSON.stringify(invalid)));
  }
});
