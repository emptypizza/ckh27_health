import { assert, test } from "./harness.js";
import { emptyHealthDocument, emptyHealthEntry, HEALTH_LIMITS, mergeAppleHealth, parseHealthDocument } from "../js/health.js";
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
    { ...envelope, ciphertext: btoa("x".repeat(HEALTH_LIMITS.vaultBytes + 17)) },
    { ...envelope, notes: "unexpected plaintext" },
  ];
  for (const invalid of malformed) {
    assert.throws(() => parseHealthVault(JSON.stringify(invalid)));
  }
});

function appleFixture(records) {
  return { version: 1, exportedAt: "", profile: {}, records, correlations: [] };
}

test("merges overlapping Apple exports in either order and retains repeated observations", async () => {
  const sample = {
    type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "7", source: "테스트",
    start: "2025-02-01 09:00:00 +0900", end: "2025-02-01 09:05:00 +0900",
  };
  const first = { ...sample, created: sample.end, metadata: { HKWasUserEntered: "1" } };
  const second = { ...sample, created: "2025-02-01 09:06:00 +0900" };
  const full = appleFixture([first, second]);
  full.profile.HKCharacteristicTypeIdentifierBiologicalSex = "HKBiologicalSexNotSet";
  full.correlations = [{
    type: "HKCorrelationTypeIdentifierFood", start: sample.start, end: sample.end,
    source: sample.source, members: [first],
  }];
  const partial = appleFixture([sample, sample]);
  partial.correlations = [{ ...full.correlations[0], members: [sample] }];
  // CDA may omit creation dates and metadata for the same observation.
  for (const combined of [mergeAppleHealth(full, partial), mergeAppleHealth(partial, full)]) {
    assert.deepEqual(combined, full);
    assert.deepEqual(mergeAppleHealth(combined, full), full);
  }
  const withLaterObservation = mergeAppleHealth(full, appleFixture([{ ...second, created: "2025-02-03 10:00:00 +0900" }]));
  assert.equal(withLaterObservation.records.length, 3);
  const mixed = mergeAppleHealth(appleFixture([sample, first]), appleFixture([first, second]));
  assert.deepEqual(mixed.records, [second, first]);
  assert.deepEqual(mergeAppleHealth(mixed, partial).records, mixed.records);
  const document = { ...fixture(), appleHealth: full };
  const { envelope } = await createHealthVault(document, passphrase);
  assert.ok(!JSON.stringify(envelope).includes("HKQuantityTypeIdentifier"));
  const restored = await unlockHealthVault(parseHealthVault(JSON.stringify(envelope)), passphrase);
  assert.deepEqual(restored.document, document);
});

test("validates Apple records, metadata, intervals and members before restoring", () => {
  const row = {
    type: "HKQuantityTypeIdentifierStepCount", value: "7", unit: "count", source: "테스트",
    start: "2025-01-03 00:00:00 -0800", end: "2025-01-03 00:00:00 -0800",
  };
  for (const changes of [
    { start: "2025-02-29 00:00:00 -0800" }, { end: "2025-01-02 00:00:00 -0800" },
    { source: 1 }, { metadata: { field: ["nested"] } }, { value: "NaN" },
  ]) {
    const appleHealth = appleFixture([{ ...row, ...changes }]);
    assert.throws(() => parseHealthDocument(JSON.stringify({ ...fixture(), appleHealth })), /Apple/);
  }
  const nested = appleFixture([]);
  nested.correlations = [{ ...row, members: [null] }];
  assert.throws(() => mergeAppleHealth(undefined, nested), /Apple/);
});
