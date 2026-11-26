import { assert, test } from "./harness.js";
import { emptyHealthDocument, emptyHealthEntry } from "../js/health.js";
import { createHealthVault, unlockHealthVault } from "../js/health-vault.js";
import { preparePublishedRotation, commitPublishedRotation, gitBlobSha, readPublishedEnvelope } from "../js/published-rotation.js";

const token = "github_pat_synthetic_rotation_fixture";
const currentPassphrase = "  테스트 전용 이전 암호  ";
const newPassphrase = "  새 암호 😀😀😀  "; // 12 code points, including the surrounding spaces.
const endpoint = "https://api.github.com/repos/emptypizza/ckh27_health/contents/js/published-vault.js";
const commitId = "8".repeat(40);

function fakeRepository(source) {
  const repo = { source, calls: [], writes: 0, mode: "success", failNextRead: false };
  repo.fetch = async (url, options) => {
    repo.calls.push({ url, ...options });
    if (options.method === "GET") {
      if (repo.failNextRead) {
        repo.failNextRead = false;
        throw new TypeError("synthetic connection loss");
      }
      return new Response(repo.source);
    }
    const body = JSON.parse(options.body);
    if (repo.mode === "denied") return new Response(null, { status: 403 });
    if (repo.mode === "race") repo.source += "\n";
    if (await gitBlobSha(repo.source) !== body.sha) return new Response(null, { status: 409 });
    if (repo.mode === "failBeforeWrite") return new Response(null, { status: 503 });
    repo.source = atob(body.content);
    repo.writes++;
    if (repo.mode === "dropAndHide") repo.failNextRead = true;
    if (repo.mode === "drop" || repo.mode === "dropAndHide") throw new TypeError("synthetic response loss");
    return Response.json({ content: { sha: await gitBlobSha(repo.source) }, commit: { sha: commitId } });
  };
  return repo;
}

async function fixture() {
  const document = emptyHealthDocument();
  document.profile.bloodType = "AB-";
  const start = Date.UTC(2024, 0, 1);
  // This makes the encrypted module exceed the GitHub 1 MiB JSON content boundary.
  for (let index = 0; index < 165; index++) {
    const day = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    document.entries.push({ ...emptyHealthEntry(day), notes: "synthetic diary entry " + "x".repeat(5000) });
  }
  document.appleHealth = { version: 1, profile: {}, exportedAt: "", correlations: [],
    records: [{ type: "HKQuantityTypeIdentifierStepCount", start: "2024-01-01 09:00:00 +0900",
      end: "2024-01-01 09:01:00 +0900", source: "SYNTHETIC DEVICE", unit: "count", value: "120" }],
  };
  const { envelope } = await createHealthVault(document, currentPassphrase);
  const source = "export default " + JSON.stringify(envelope) + ";\n";
  const repo = fakeRepository(source);
  const prepared = await preparePublishedRotation({ token, currentPassphrase, newPassphrase }, repo.fetch);
  return { source, document, prepared, envelope };
}
let example;
const getFixture = () => example ??= fixture();

test("배포 파일은 JSON으로만 읽고 Git 개체 ID는 원본 바이트로 계산한다", async () => {
  assert.equal(await gitBlobSha(new Uint8Array()), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.equal(await gitBlobSha("test content\n"), "d670460b4b4aece5915caf5c68d12f560a9fe3e4");
  const { source, envelope } = await getFixture();
  assert.ok(source.length > 1024 * 1024);
  assert.deepEqual(readPublishedEnvelope(source), envelope);
  for (const invalid of [source + "export {};", "export default ({});", "const x = 1; " + source]) {
    assert.throws(() => readPublishedEnvelope(invalid), /형식/);
  }
});

test("현재 암호, 새 암호 길이와 실제 파일을 확인한 뒤 전체 기록을 새 키로 보존한다", async () => {
  const { source, document, prepared, envelope } = await getFixture();
  const repo = fakeRepository(source);
  const settings = { token, currentPassphrase, newPassphrase };
  for (const invalid of ["😀".repeat(3), "한".repeat(13)]) {
    await assert.rejects(preparePublishedRotation({ ...settings, newPassphrase: invalid }, repo.fetch), /4자 이상 12자 이하/);
  }
  await assert.rejects(preparePublishedRotation({ ...settings, currentPassphrase: newPassphrase }, repo.fetch), /다른/);
  assert.equal(repo.calls.length, 0);
  await assert.rejects(preparePublishedRotation({ ...settings, currentPassphrase: currentPassphrase.trim() }, repo.fetch), /현재 열람 암호/);
  assert.equal(repo.writes, 0);
  const rotated = readPublishedEnvelope(atob(prepared.content));
  assert.notEqual(envelope.salt, rotated.salt);
  assert.notEqual(envelope.iv, rotated.iv);
  assert.deepEqual((await unlockHealthVault(rotated, newPassphrase)).document, document);
  await assert.rejects(unlockHealthVault(rotated, currentPassphrase), /암호/);
  assert.deepEqual(await commitPublishedRotation(prepared, token, repo.fetch), { blobSha: prepared.blobSha, commitSha: commitId });
  assert.equal(repo.source, atob(prepared.content));
  for (const request of repo.calls) {
    assert.equal(request.url, endpoint + (request.method === "GET" ? "?ref=main" : ""));
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(request.headers.Authorization, "Bearer " + token);
    if (request.method === "GET") assert.equal(request.headers.Accept, "application/vnd.github.raw+json");
    else {
      assert.equal(request.method, "PUT");
      const body = JSON.parse(request.body);
      assert.equal(body.branch, "main");
      assert.equal(body.sha, prepared.baseSha);
      assert.equal(body.content, prepared.content);
      for (const sensitive of [currentPassphrase, newPassphrase, token, "SYNTHETIC DEVICE", "synthetic diary entry"]) {
        assert.ok(!request.body.includes(sensitive) && !atob(body.content).includes(sensitive));
      }
    }
  }
});

test("4자 암호로 바꾼 기록을 다시 열 수 있다", async () => {
  const { source, document } = await getFixture();
  const newPassphrase = "가A😀1";
  const prepared = await preparePublishedRotation({ token, currentPassphrase, newPassphrase }, fakeRepository(source).fetch);
  const rotated = readPublishedEnvelope(atob(prepared.content));
  assert.deepEqual((await unlockHealthVault(rotated, newPassphrase)).document, document);
});

test("저장 중 응답이 끊겨도 동일 암호문을 확인하여 추가 커밋을 방지한다", async () => {
  const { source, prepared } = await getFixture();
  for (const mode of ["drop", "dropAndHide", "failBeforeWrite"]) {
    const repo = fakeRepository(source);
    repo.mode = mode;
    if (mode === "drop") {
      assert.deepEqual(await commitPublishedRotation(prepared, token, repo.fetch), { blobSha: prepared.blobSha, commitSha: null });
    } else {
      await assert.rejects(commitPublishedRotation(prepared, token, repo.fetch), /확인/);
    }
    repo.mode = "success";
    assert.equal((await commitPublishedRotation(prepared, token, repo.fetch)).blobSha, prepared.blobSha);
    assert.equal(repo.writes, 1);
    assert.equal(repo.source, atob(prepared.content));
  }
});

test("준비 후 또는 저장 직전의 다른 변경, 권한 오류와 손상된 변경 요청을 거부한다", async () => {
  const { source, prepared } = await getFixture();
  const stale = fakeRepository(source + "\n");
  await assert.rejects(commitPublishedRotation(prepared, token, stale.fetch), /다른 변경/);
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.calls[0].method, "GET");
  const concurrent = fakeRepository(source);
  concurrent.mode = "race";
  await assert.rejects(commitPublishedRotation(prepared, token, concurrent.fetch), /다른 변경/);
  assert.equal(concurrent.source, source + "\n");
  assert.equal(concurrent.writes, 0);
  const denied = fakeRepository(source);
  denied.mode = "denied";
  await assert.rejects(commitPublishedRotation(prepared, token, denied.fetch), /권한/);
  assert.equal(denied.writes, 0);
  const altered = { ...prepared, content: btoa("export default {};") };
  await assert.rejects(commitPublishedRotation(altered, token, denied.fetch), /형식/);
});
