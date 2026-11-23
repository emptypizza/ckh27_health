import { assert, test } from "./harness.js";
import {
  ageOn, buildVisitSummary, emptyHealthDocument, emptyHealthEntry, HEALTH_LIMITS, parseHealthDocument,
} from "../js/health.js";

test("health records round-trip Korean notes and sort records by civil date", () => {
  const document = emptyHealthDocument();
  document.profile.bloodType = "AB-";
  document.profile.heightCm = 165.5;
  document.entries = [
    { ...emptyHealthEntry("2026-10-03"), symptoms: "목이 잠김" },
    { ...emptyHealthEntry("2026-10-01"), sleepHours: 0, temperatureC: 36.6, notes: "저녁에 기록\n다음 날 확인" },
  ];
  const parsed = parseHealthDocument(JSON.stringify(document));
  assert.deepEqual(parsed.profile, document.profile);
  assert.deepEqual(parsed.entries, [document.entries[1], document.entries[0]]);
  assert.equal(document.entries[0].date, "2026-10-03");
});

test("omitted optional values are normalized to the empty form", () => {
  const parsed = parseHealthDocument(JSON.stringify({ version: 1, profile: {}, entries: [{ date: "2024-02-29" }] }));
  assert.deepEqual(parsed, { ...emptyHealthDocument(), entries: [emptyHealthEntry("2024-02-29")] });
});

test("validates version, file size in bytes, date, duplicate rows, and numeric inputs", () => {
  const payload = (entries) => JSON.stringify({ ...emptyHealthDocument(), entries });
  assert.throws(() => parseHealthDocument("{"), /JSON/);
  assert.throws(() => parseHealthDocument(JSON.stringify({ ...emptyHealthDocument(), version: 2 })), /버전/);
  assert.throws(() => parseHealthDocument("가".repeat(Math.floor(HEALTH_LIMITS.fileBytes / 3) + 1)), /1MB/);
  assert.throws(() => parseHealthDocument(payload([{ date: "2026-02-29" }])), /날짜/);
  assert.throws(() => parseHealthDocument(payload([{ date: "2026-05-01" }, { date: "2026-05-01" }])), /중복/);
  for (const value of [{ mood: 1.5 }, { stress: 0 }, { energy: 6 }, { weightKg: "63" }, { sleepHours: 25 }]) {
    assert.throws(() => parseHealthDocument(payload([{ date: "2026-05-01", ...value }])), /입력값/);
  }
  assert.throws(() => parseHealthDocument(payload([{ date: "2026-05-01", symptoms: "가".repeat(HEALTH_LIMITS.text + 1) }])), /6,000/);
});

test("age changes on the civil birthday and rejects future or invalid dates", () => {
  assert.equal(ageOn("2001-07-03", "2026-07-02"), 24);
  assert.equal(ageOn("2001-07-03", "2026-07-03"), 25);
  assert.equal(ageOn("2001-02-29", "2026-07-03"), null);
  assert.equal(ageOn("2026-07-04", "2026-07-03"), null);
  assert.equal(ageOn("", "2026-07-03"), null);
});

test("consultation summary uses inclusive civil dates and counts a symptom once per day", () => {
  const document = emptyHealthDocument();
  document.entries = [
    { ...emptyHealthEntry("2026-10-02"), symptoms: "목이 잠김, 목이 잠김", sleepHours: 6.5 },
    { ...emptyHealthEntry("2026-10-05"), symptoms: "목이 잠김", sleepHours: 7.5, medications: "처방된 약을 아침에 복용" },
    { ...emptyHealthEntry("2026-10-04"), symptoms: " " },
    { ...emptyHealthEntry("2026-10-01"), symptoms: "기간 이전" },
    { ...emptyHealthEntry("2026-10-06"), symptoms: "기간 이후" },
  ];
  const snapshot = JSON.stringify(document);
  const text = buildVisitSummary(document, "2026-10-05", 4);
  assert.match(text, /2026-10-02 ~ 2026-10-05/);
  assert.match(text, /내용을 기록한 날 2일 · 내용이 없는 날 2일/);
  assert.match(text, /수면 평균 7시간 · 범위 6\.5~7\.5시간/);
  assert.match(text, /반복 입력된 증상 표현 · 목이 잠김 2일/);
  assert.match(text, /복용한 약과 복용 시각/);
  assert.doesNotMatch(text, /기간 이전|기간 이후|2026-10-04/);
  assert.equal(JSON.stringify(document), snapshot);
});

test("missing measurements do not appear as zeroes in an empty summary", () => {
  const text = buildVisitSummary(emptyHealthDocument(), "2026-01-03");
  assert.match(text, /2025-12-21 ~ 2026-01-03/);
  assert.match(text, /내용이 없는 날 14일/);
  assert.doesNotMatch(text, /체중 0|수면 0|맥박 0/);
});
