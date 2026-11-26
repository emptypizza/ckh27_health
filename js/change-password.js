import { createDeviceLink } from "./device-link.js";
import { commitPublishedRotation, gitBlobSha, preparePublishedRotation } from "./published-rotation.js";

const byId = id => document.getElementById(id);
const form = byId("rotation-form");
const secrets = byId("rotation-secrets");
const owner = byId("rotation-owner");
const current = byId("rotation-current");
const next = byId("rotation-new");
const confirmation = byId("rotation-confirm");
const renew = byId("renew-pin");
const pin = byId("rotation-pin");
const token = byId("rotation-token");
const submit = byId("rotation-submit");
const error = byId("rotation-error");
const status = byId("rotation-status");
const check = byId("rotation-check");
const output = byId("pairing-output");
const retryDelays = [4, 8, 12, 20, 30, 30, 30, 30, 30, 30];

let busy = false;
let prepared = null; // An encrypted module and its base hash, safe to reuse after an interrupted write.
let expectedHash = "";
let wrappedLink = "";
let timer;
let probe;
let checks = 0;
let epoch = 0;

function setError(message, field) {
  error.textContent = message;
  error.hidden = !message;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

function syncForm() {
  secrets.hidden = Boolean(prepared);
  secrets.disabled = busy || Boolean(prepared);
  owner.disabled = busy;
  submit.disabled = busy;
  submit.textContent = busy ? "처리 중…" : prepared ? "같은 변경 다시 확인하기" : "암호 변경 및 배포";
  pin.required = renew.checked;
  pin.disabled = !renew.checked;
  byId("pin-fields").hidden = !renew.checked;
}

function clearCredentials() {
  for (const input of [current, next, confirmation, pin, token]) input.value = "";
}

function validate() {
  if (!prepared) {
    if (Array.from(next.value).length < 12 || new TextEncoder().encode(next.value).length > 1024) {
      setError("새 암호를 12자 이상, UTF-8 기준 1,024바이트 이하로 입력해 주세요.", next);
      return false;
    }
    if (next.value === current.value) {
      setError("현재 암호와 다른 새 암호를 입력해 주세요.", next);
      return false;
    }
    if (next.value !== confirmation.value) {
      setError("새 열람 암호와 확인 입력이 일치하지 않습니다.", confirmation);
      return false;
    }
  }
  if (!/^github_pat_[A-Za-z0-9_]+$/.test(token.value.trim())) {
    setError("이 저장소 전용 GitHub fine-grained 접근 토큰을 입력해 주세요.", token);
    return false;
  }
  return true;
}

function revealVerified() {
  byId("result-title").textContent = "새 암호가 사이트에 적용됐습니다";
  status.textContent = "지금 사이트에서 새 암호로 암호화한 배포본을 확인했습니다.";
  byId("pairing-wait").hidden = true;
  check.hidden = true;
  byId("rotation-open").hidden = false;
  if (wrappedLink) {
    const link = new URL("./", document.baseURI);
    link.hash = "access=" + wrappedLink;
    output.value = link.href;
    byId("pairing-result").hidden = false;
    wrappedLink = "";
  }
}

async function checkDeployment() {
  if (probe || !expectedHash || check.hidden) return;
  clearTimeout(timer);
  const attempt = epoch;
  const controller = new AbortController();
  probe = controller;
  const timeout = setTimeout(() => controller.abort(), 15_000);
  check.disabled = true;
  check.textContent = "확인 중…";
  try {
    const url = new URL("./js/published-vault.js", document.baseURI);
    url.searchParams.set("rotation", Date.now().toString());
    const response = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error();
    const sha = await gitBlobSha(new Uint8Array(await response.arrayBuffer()));
    if (attempt !== epoch) return;
    if (sha === expectedHash) {
      revealVerified();
      return;
    }
    status.textContent = "GitHub에 변경을 저장했습니다. 사이트에는 아직 새 배포본이 반영되지 않았습니다.";
  } catch {
    if (attempt === epoch) status.textContent = "GitHub에 변경을 저장했습니다. 현재 사이트의 배포 상태를 확인할 수 없습니다.";
  } finally {
    clearTimeout(timeout);
    if (probe === controller) probe = null;
    if (attempt === epoch) {
      check.disabled = false;
      check.textContent = "배포 확인";
      if (!check.hidden) {
        if (checks < retryDelays.length) timer = setTimeout(checkDeployment, retryDelays[checks++] * 1000);
        else status.textContent += " ‘배포 확인’을 눌러 다시 확인하세요.";
      }
    }
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || expectedHash) return;
  setError("");
  if (!form.reportValidity() || !validate()) return;
  const attempt = epoch;
  let authorization = token.value.trim();
  token.value = "";
  busy = true;
  syncForm();
  let failingField;
  try {
    if (!prepared) {
      status.textContent = "현재 기록을 열고 새 암호로 전체 기록을 확인하고 있습니다.";
      const replacement = await preparePublishedRotation({ token: authorization, currentPassphrase: current.value, newPassphrase: next.value });
      if (attempt !== epoch) return;
      const link = renew.checked ? await createDeviceLink(next.value, pin.value) : "";
      if (attempt !== epoch) return;
      // The link can be shown only after the exact re-encrypted file reaches Pages.
      prepared = replacement;
      wrappedLink = link;
      clearCredentials();
    }
    status.textContent = "암호화한 기록을 저장소에 반영하고 있습니다.";
    const { blobSha } = await commitPublishedRotation(prepared, authorization);
    if (attempt !== epoch) return;
    expectedHash = blobSha;
    prepared = null;
    form.hidden = true;
    byId("rotation-result").hidden = false;
    byId("pairing-wait").hidden = !wrappedLink;
    byId("result-title").focus();
    status.textContent = "GitHub에 변경을 저장했습니다. 사이트 반영 여부를 확인하고 있습니다.";
    void checkDeployment();
  } catch (reason) {
    if (attempt !== epoch) return;
    const code = reason?.code;
    if (code === "conflict" || code === "invalid") {
      prepared = null;
      wrappedLink = "";
    }
    status.textContent = prepared ? "준비한 변경을 이 화면에 보관 중입니다. 토큰을 다시 입력하면 저장 여부를 먼저 확인합니다." : "";
    setError(["auth", "current", "invalid", "conflict", "unknown", "unavailable"].includes(code)
      ? reason.message : "암호 변경을 마치지 못했습니다. 다시 시도해 주세요.");
    failingField = prepared || code === "auth" ? token : code === "current" ? current : null;
  } finally {
    authorization = "";
    if (attempt === epoch) {
      busy = false;
      syncForm();
      if (failingField) {
        failingField.setAttribute("aria-invalid", "true");
        failingField.focus();
      }
    }
  }
});

form.addEventListener("input", event => {
  event.target.removeAttribute("aria-invalid");
  if (!error.hidden) setError("");
});
renew.addEventListener("change", () => {
  if (!renew.checked) pin.value = "";
  syncForm();
  if (renew.checked) pin.focus();
});
check.addEventListener("click", () => { void checkDeployment(); });
byId("pairing-copy").addEventListener("click", async () => {
  const attempt = epoch;
  try {
    await navigator.clipboard.writeText(output.value);
    if (attempt === epoch) byId("copy-status").textContent = "연결 링크를 복사했습니다.";
  } catch {
    if (attempt !== epoch) return;
    output.focus();
    output.select();
    byId("copy-status").textContent = "선택된 링크를 복사하세요.";
  }
});
window.addEventListener("pagehide", () => {
  epoch++;
  clearTimeout(timer);
  probe?.abort();
  probe = null;
  checks = 0;
  prepared = null;
  expectedHash = "";
  wrappedLink = "";
  output.value = "";
  form.reset();
  clearCredentials();
  busy = false;
  form.hidden = false;
  byId("rotation-result").hidden = true;
  byId("result-title").textContent = "저장소에 변경을 반영했습니다";
  byId("rotation-open").hidden = true;
  byId("pairing-result").hidden = true;
  byId("pairing-wait").hidden = true;
  for (const input of form.querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
  byId("copy-status").textContent = "";
  check.hidden = false;
  check.disabled = false;
  check.textContent = "배포 확인";
  status.textContent = "";
  setError("");
  if (window.crypto?.subtle) syncForm();
});

if (window.crypto?.subtle) syncForm();
else setError("암호를 변경하려면 HTTPS 주소에서 이 페이지를 열어 주세요.");
