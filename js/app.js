// 건강 관리 화면. fortune-report의 HealthPanel.tsx와 같은 동작을 프레임워크 없이 DOM으로 그린다.
//
// 화면은 두 가지 방법으로 고친다.
// - render(): state에 맞춰 화면 전체를 다시 만든다. 잠금 해제, 탭 전환, 저장처럼 구성이 바뀔 때 쓴다.
// - refresh(): 이미 있는 화면에서 알림과 버튼 상태만 고친다. 글자를 입력하는 동안에는 이것만 쓴다.
//   입력 도중 화면을 다시 만들면 초점과 한글 조합이 끊기기 때문이다.

import {
  BLOOD_TYPES, HEALTH_LIMITS, HEALTH_RANGES,
  ageOn, buildVisitSummary, emptyHealthDocument, emptyHealthEntry, mergeAppleHealth, parseHealthDocument,
} from "./health.js";
import { createHealthVault, HEALTH_VAULT_FILE_BYTES, parseHealthVault, sealHealthVault, unlockHealthVault } from "./health-vault.js";
import { readAppleHealth } from "./apple-import.js";
import { renderAppleHealth } from "./apple-view.js";
import { icon } from "./icons.js";

const STORAGE_KEY = "ckh27_health:vault:v1";
const MIN_PASSPHRASE = 6; // 새 암호를 만들 때만 확인한다. 기존 기록과 백업은 길이와 상관없이 연다.
// 브라우저는 https와 localhost에서만 암호화 기능(Web Crypto)을 준다.
const NO_CRYPTO = "이 주소에서는 기록을 암호화할 수 없습니다. https 주소나 localhost로 열어 주세요.";

const tabs = [
  { id: "apple", label: "Apple 건강", icon: "heart-pulse" },
  { id: "daily", label: "일일 기록", icon: "activity" },
  { id: "profile", label: "기본정보", icon: "user-round" },
  { id: "visit", label: "진료 요약", icon: "clipboard-list" },
];
const measures = [
  { key: "weightKg", label: "몸무게 (kg)" },
  { key: "sleepHours", label: "수면 (시간)" },
  { key: "temperatureC", label: "체온 (°C)" },
  { key: "pulse", label: "맥박 (회/분)" },
  { key: "systolic", label: "수축기 혈압 (mmHg)" },
  { key: "diastolic", label: "이완기 혈압 (mmHg)" },
];
const scores = [
  { key: "mood", label: "기분", low: "매우 낮음", high: "매우 좋음" },
  { key: "energy", label: "기력", low: "매우 낮음", high: "매우 높음" },
  { key: "stress", label: "스트레스", low: "매우 낮음", high: "매우 높음" },
];
const dayNotes = [
  { key: "symptoms", label: "신체 증상", placeholder: "시작 시각, 지속 시간, 같이 나타난 증상" },
  { key: "medications", label: "오늘 실제 복용한 약", placeholder: "약 이름, 용량, 복용 시각" },
  { key: "meals", label: "식사", placeholder: "무엇을 언제 먹었는지" },
  { key: "bowel", label: "배변", placeholder: "형태, 양, 횟수 또는 시간" },
  { key: "notes", label: "마음 상태와 하루 메모", placeholder: "수면 시각, 감정, 활동, 평소와 달랐던 점" },
];
const profileNotes = [
  { key: "allergies", label: "알레르기와 약물 이상반응" },
  { key: "conditions", label: "진단받은 질환과 과거력" },
  { key: "medications", label: "현재 처방과 복용 일정" },
  { key: "clinician", label: "의료진 또는 의료기관" },
];
const periods = [7, 14, 30];

// 기록 날짜는 기기 시간대와 상관없이 한국 날짜를 쓴다.
const seoulDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

const root = document.getElementById("app");
const feedback = element("div", { class: "feedback" });

const state = {
  today: seoulDate.format(new Date()),
  hasVault: false,
  external: false, // 다른 탭이 저장된 기록을 바꿨는지
  session: null, // 잠금을 푼 동안의 { document, key, salt }
  passphrase: "",
  confirmation: "",
  restore: null, // 복원하려고 고른 암호화 백업 { envelope, name }
  profile: emptyHealthDocument().profile, // 입력 중인 기본정보
  entry: null, // 입력 중인 일일 기록
  busy: false,
  notice: "",
  error: "",
  tab: "daily",
  publishedApple: null, // 배포 기록은 메모리에서만 열람한다.
  publishedError: "",
  previewApple: null, // 잠긴 화면에서 파일을 열었을 때 메모리에만 보관
  savingPreview: false,
  period: 14,
};
state.entry = emptyHealthEntry(state.today);

let storage; // storage 이벤트가 이 저장소의 것인지 가릴 때 쓴다
let snapshot = null; // 이 탭이 마지막으로 읽거나 쓴 암호문
let running = false;
let updaters = []; // 지금 화면의 버튼 상태를 state에 맞추는 함수들
let fillForm = () => {}; // 지금 보이는 폼의 입력칸을 state 값으로 채운다
let shown = { error: "", notice: "" };
let shownView = null;
let focusAfterAction = null;
let publishedLoadAttempt = 0;
let publishedEpoch = 0;
const PUBLISHED_PASSWORD_ERROR = "열람 암호를 확인하고 다시 입력해 주세요.";

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") node.addEventListener(name, value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  // 글자는 항상 텍스트 노드로 들어가므로 입력한 내용이 HTML로 해석되지 않는다.
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

function control(label, input) {
  return element("label", { class: "control" }, label, input);
}

function button(id, kind, content, click, disabled = () => state.busy) {
  const node = element("button", { id, type: "button", class: `button button-${kind}`, click }, content);
  updaters.push(() => { node.disabled = disabled(); });
  return node;
}

function fileButton(id, label, accessibleName, disabled, pick, accept = ".json,application/json") {
  const input = element("input", { id, type: "file", accept, "aria-label": accessibleName });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    pick(file);
  });
  updaters.push(() => { input.disabled = disabled(); });
  return element("label", { class: "button button-secondary file-button" }, label, input);
}

// 브라우저와 입력 종류에 따라 input과 change 중 하나만 나기도 해서 둘 다 듣는다. handler는 여러 번 불려도 결과가 같다.
function onEdit(input, handler) {
  input.addEventListener("input", handler);
  input.addEventListener("change", handler);
}

function numberValue(value) {
  return value === "" ? null : Number(value);
}

function numberInput(id, key) {
  const { min, max, step } = HEALTH_RANGES[key];
  return element("input", {
    id, type: "number", min, max, step: step === 1 ? 1 : "any", inputmode: step === 1 ? "numeric" : "decimal",
  });
}

function display(value, unit) {
  return value == null ? "미기록" : `${value}${unit}`;
}

function recentEntries(entries, today, period) {
  const firstDay = new Date(`${today}T00:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - period + 1);
  const start = firstDay.toISOString().slice(0, 10);
  return entries.filter((entry) => entry.date >= start && entry.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function mostRecent(entries, key) {
  return entries.find((entry) => entry[key] != null);
}

function average(entries, key) {
  const values = entries.flatMap((entry) => entry[key] == null ? [] : [entry[key]]);
  return values.length === 0 ? null : Math.round(10 * values.reduce((sum, value) => sum + value, 0) / values.length) / 10;
}

function downloadText(text, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = element("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function replaceEntry(records, entry) {
  const entries = records.entries.filter((previous) => previous.date !== entry.date);
  if (JSON.stringify(entry) !== JSON.stringify(emptyHealthEntry(entry.date))) entries.push(entry);
  return { ...records, entries };
}

function mergeRecords(records, imported) {
  const recordedDates = new Set(records.entries.map((entry) => entry.date));
  const profile = Object.fromEntries(Object.entries(records.profile).map(([key, value]) => [
    key, value === "" || value === null ? imported.profile[key] : value,
  ]));
  const merged = { ...records, profile, entries: [...records.entries, ...imported.entries.filter((entry) => !recordedDates.has(entry.date))] };
  if (imported.appleHealth) merged.appleHealth = mergeAppleHealth(records.appleHealth, imported.appleHealth);
  return merged;
}

function savedEntry() {
  return state.session?.document.entries.find((item) => item.date === state.entry.date) ?? emptyHealthEntry(state.entry.date);
}

function entryDirty() {
  return JSON.stringify(state.entry) !== JSON.stringify(savedEntry());
}

function profileDirty() {
  return state.session !== null && JSON.stringify(state.profile) !== JSON.stringify(state.session.document.profile);
}

function refresh() {
  if (state.error !== shown.error || state.notice !== shown.notice) {
    shown = { error: state.error, notice: state.notice };
    feedback.replaceChildren(
      ...(state.error ? [element("p", { class: "error", role: "alert" }, state.error)] : []),
      ...(state.notice ? [element("p", { class: "notice", role: "status" }, state.notice)] : []),
    );
  }
  for (const update of updaters) update();
}

function render() {
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  // 작업 중에 버튼이 꺼지면 초점이 풀리므로, 그때는 작업을 시작할 때 초점이 있던 곳으로 돌아간다.
  const focusId = active?.id || focusAfterAction;
  const selection = active && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  const previewing = state.previewApple && !state.savingPreview && !state.session;
  const view = state.publishedApple ? "published" : state.session ? "open" : previewing ? "preview" : "locked";

  updaters = [];
  fillForm = () => {};
  const screens = { published: publishedView, open: openView, preview: previewView, locked: lockedView };
  root.replaceChildren(screens[view]());
  fillForm();
  refresh();

  const target = focusId ? document.getElementById(focusId) : null;
  if (target && !target.disabled && !target.hidden) {
    target.focus({ preventScroll: true });
    if (selection) target.setSelectionRange(...selection);
  } else if (shownView !== null && shownView !== view) {
    // 잠금 화면과 기록 화면이 바뀌면 초점 있던 요소가 사라지므로 새 화면의 제목으로 옮긴다.
    const focusTarget = { published: "published-lock", open: "health-overview-title", preview: "preview-save",
      locked: shownView === "published" ? "published-passphrase" : "health-vault-title" }[view];
    document.getElementById(focusTarget)?.focus({ preventScroll: true });
  }
  shownView = view;
}

async function action(run) {
  if (running) return;
  running = true;
  focusAfterAction = root.contains(document.activeElement) ? document.activeElement.id || null : null;
  state.busy = true;
  state.notice = "";
  state.error = "";
  refresh();
  try {
    await run();
  } catch (reason) {
    state.error = reason instanceof Error ? reason.message : "작업을 마치지 못했습니다. 다시 시도해 주세요.";
  } finally {
    running = false;
    state.busy = false;
    render();
    focusAfterAction = null;
  }
}

async function writeEnvelope(envelope) {
  const raw = JSON.stringify(envelope);
  function write() {
    if (window.localStorage.getItem(STORAGE_KEY) !== snapshot) {
      state.external = true;
      throw new Error("다른 탭에서 기록이 변경되었습니다. 현재 작성 내용은 암호화 백업으로 보관할 수 있습니다.");
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      throw new Error("브라우저에 저장하지 못했습니다. 현재 작성 내용은 암호화 백업으로 보관할 수 있습니다.");
    }
    snapshot = raw;
    state.hasVault = true;
    state.external = false;
  }
  if (window.navigator.locks) await window.navigator.locks.request(STORAGE_KEY, write);
  else write();
}

function openSession(key, envelope, records) {
  state.session = { document: records, key, salt: envelope.salt };
  state.profile = records.profile;
  state.entry = records.entries.find((item) => item.date === state.today) ?? emptyHealthEntry(state.today);
  state.passphrase = "";
  state.confirmation = "";
  state.restore = null;
  state.tab = records.appleHealth || records.entries.length === 0 ? "apple" : "daily";
  state.previewApple = null;
  state.savingPreview = false;
}

function unlock() {
  action(async () => {
    if (!window.crypto?.subtle) throw new Error(NO_CRYPTO);
    if (window.localStorage.getItem(STORAGE_KEY) !== snapshot) {
      state.external = true;
      throw new Error("다른 탭에서 기록이 바뀌었습니다. 최신 저장 상태를 불러와 주세요.");
    }
    const envelope = state.restore?.envelope ?? (snapshot === null ? null : parseHealthVault(snapshot));
    if (envelope) {
      let unlocked;
      try {
        unlocked = await unlockHealthVault(envelope, state.passphrase);
      } catch {
        throw new Error("건강 기록 암호 또는 백업 파일을 확인해 주세요.");
      }
      const restored = state.restore !== null;
      const pending = state.previewApple;
      let records = unlocked.document;
      if (pending) {
        records = { ...records, appleHealth: mergeAppleHealth(records.appleHealth, pending) };
        const sealed = await sealHealthVault(records, unlocked.key, envelope.salt);
        await writeEnvelope(sealed);
      } else if (restored) {
        await writeEnvelope(envelope);
      }
      openSession(unlocked.key, envelope, records);
      if (pending) state.notice = "Apple 건강 기록을 이 브라우저에 암호화해 보관했습니다.";
      else if (restored) state.notice = "암호화 백업을 복원했습니다.";
      return;
    }
    if (state.passphrase.length < MIN_PASSPHRASE) throw new Error(`건강 기록 암호를 ${MIN_PASSPHRASE}자 이상 입력해 주세요.`);
    if (state.passphrase !== state.confirmation) throw new Error("두 암호가 서로 다릅니다.");
    const records = emptyHealthDocument();
    if (state.previewApple) records.appleHealth = state.previewApple;
    const created = await createHealthVault(records, state.passphrase);
    await writeEnvelope(created.envelope);
    openSession(created.key, created.envelope, records);
    state.notice = records.appleHealth ? "Apple 건강 기록을 이 브라우저에 암호화해 보관했습니다." : "이 브라우저에 건강 기록을 만들었습니다.";
  });
}

function clearSession() {
  publishedEpoch++;
  try {
    snapshot = window.localStorage.getItem(STORAGE_KEY);
    state.hasVault = snapshot !== null;
    state.external = false;
    state.error = "";
  } catch {
    state.error = "브라우저 저장소를 읽을 수 없습니다.";
  }
  state.session = null;
  state.publishedApple = null;
  state.publishedError = "";
  state.profile = emptyHealthDocument().profile;
  state.entry = emptyHealthEntry(state.today);
  state.passphrase = "";
  state.confirmation = "";
  state.restore = null;
  state.previewApple = null;
  state.savingPreview = false;
  state.notice = "";
  render();
}

function lock() {
  if (entryDirty() || profileDirty()) {
    state.error = "저장하지 않은 내용이 있습니다. 저장하거나 입력을 취소한 뒤 잠가 주세요.";
    refresh();
    return;
  }
  clearSession();
}

function selectDate(date) {
  if (!date || date > state.today) return false;
  if (entryDirty()) {
    state.error = "작성 중인 일일 기록을 저장하거나 입력을 취소한 뒤 날짜를 바꿔 주세요.";
    refresh();
    return false;
  }
  state.error = "";
  state.entry = state.session?.document.entries.find((item) => item.date === date) ?? emptyHealthEntry(date);
  fillForm();
  refresh();
  return true;
}

async function persist(records) {
  if (!state.session) return;
  const checked = parseHealthDocument(JSON.stringify(records), HEALTH_LIMITS.vaultBytes);
  const envelope = await sealHealthVault(checked, state.session.key, state.session.salt);
  await writeEnvelope(envelope);
  state.session = { ...state.session, document: checked };
  state.notice = "이 브라우저에 암호화해 저장했습니다.";
}

function save(target) {
  if (!state.session) return;
  const records = target === "profile"
    ? { ...state.session.document, profile: state.profile }
    : replaceEntry(state.session.document, state.entry);
  action(() => persist(records));
}

function readBackup(file) {
  if (!file) return;
  action(async () => {
    if (file.size > HEALTH_VAULT_FILE_BYTES) throw new Error("백업 파일이 너무 큽니다.");
    state.restore = { envelope: parseHealthVault(await file.text()), name: file.name };
    state.passphrase = "";
    state.confirmation = "";
  });
}

function exportBackup() {
  action(async () => {
    let raw = snapshot;
    if (state.session) {
      // 저장하지 않은 입력도 백업에는 담아, 저장이 막힌 상황에서도 내용을 건질 수 있게 한다.
      const records = replaceEntry({ ...state.session.document, profile: state.profile }, state.entry);
      raw = JSON.stringify(await sealHealthVault(records, state.session.key, state.session.salt));
    }
    if (!raw) throw new Error("백업할 기록을 찾지 못했습니다.");
    downloadText(raw, `건강기록-암호화백업-${state.today}.json`, "application/json;charset=utf-8");
    state.notice = "암호화 백업을 받았습니다. 복원할 때 건강 기록 암호가 필요합니다.";
  });
}

function importDocument(file) {
  if (!file || !state.session) return;
  action(async () => {
    if (file.size > HEALTH_LIMITS.fileBytes) throw new Error("건강 기록 파일은 1MB 이하만 가져올 수 있습니다.");
    const imported = parseHealthDocument(await file.text());
    if (imported.profile.birthDate > state.today || imported.entries.some((item) => item.date > state.today)) {
      throw new Error("오늘 이후의 생년월일 또는 기록 날짜가 있습니다. 파일의 날짜를 확인해 주세요.");
    }
    const merged = mergeRecords(state.session.document, imported);
    const added = merged.entries.length - state.session.document.entries.length;
    await persist(merged);
    state.profile = merged.profile;
    state.entry = merged.entries.find((item) => item.date === state.entry.date) ?? emptyHealthEntry(state.entry.date);
    state.notice = `기록 ${added}일을 추가했습니다. 같은 날짜의 기존 기록은 유지했습니다.`;
  });
}

function appleFileButton(id, label, pick) {
  return fileButton(id, label, "Apple 건강 ZIP 또는 XML 파일 선택",
    () => state.busy || (state.session && (state.external || entryDirty() || profileDirty())),
    pick, ".zip,.xml,application/zip,application/xml,text/xml");
}

function importAppleFile(file) {
  if (!file) return;
  action(async () => {
    state.notice = "Apple 건강 파일을 읽고 있어요…";
    refresh();
    const incoming = await readAppleHealth(file);
    if (!state.session) {
      state.previewApple = incoming;
      state.savingPreview = false;
      state.notice = "";
      return;
    }
    const records = state.session.document;
    const appleHealth = mergeAppleHealth(records.appleHealth, incoming);
    const added = appleHealth.records.length - (records.appleHealth?.records.length ?? 0);
    await persist({ ...records, appleHealth });
    state.tab = "apple";
    state.notice = added ? `측정 기록 ${added.toLocaleString("ko-KR")}건을 추가하고 암호화해 보관했습니다.` : "기존 기록과 합쳤습니다. 새로 추가된 측정 기록은 없습니다.";
  });
}

function previewView() {
  return element("section", { class: "health", "aria-label": "Apple 건강 파일 미리보기" },
    element("div", { class: "preview-toolbar" },
      element("p", { class: "muted" }, "미리보기 중 · 창을 닫으면 이 파일의 열람이 끝납니다."),
      element("div", { class: "actions" },
        button("preview-save", "primary", "내 기록에 보관", () => {
          state.savingPreview = true;
          state.error = "";
          state.notice = "";
          render();
        }),
        button("preview-close", "secondary", "미리보기 닫기", clearSession),
      ),
    ),
    feedback,
    renderAppleHealth(state.previewApple, appleFileButton("apple-preview-file", "다른 파일 열기", importAppleFile)),
  );
}

async function openPublished(input) {
  if (running) return;
  const epoch = publishedEpoch;
  let passphrase = input.value;
  input.value = "";
  state.publishedError = "";
  await action(async () => {
    try {
      if (!window.crypto?.subtle) {
        state.publishedError = NO_CRYPTO;
        return;
      }
      let envelope;
      try {
        // A new URL after a failed download also retries browsers' cached module failures.
        const module = publishedLoadAttempt === 0 ? await import("./published-vault.js")
          : await import(`./published-vault.js?retry=${publishedLoadAttempt}`);
        envelope = module.default;
      } catch {
        publishedLoadAttempt++;
        if (epoch === publishedEpoch) state.publishedError = "배포 기록을 내려받지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.";
        return;
      }
      if (epoch !== publishedEpoch) return;
      let document;
      try {
        ({ document } = await unlockHealthVault(envelope, passphrase));
      } catch (error) {
        if (epoch === publishedEpoch) state.publishedError = error instanceof Error && error.message.includes("암호가 맞는지")
          ? PUBLISHED_PASSWORD_ERROR : "배포 기록 파일을 읽을 수 없습니다. 페이지를 새로고침해 주세요.";
        return;
      }
      if (epoch !== publishedEpoch) return;
      if (!document.appleHealth) {
        state.publishedError = "이 배포 기록에 Apple 건강 데이터가 없습니다.";
        return;
      }
      state.publishedApple = document.appleHealth;
      state.passphrase = "";
      state.confirmation = "";
    } finally {
      passphrase = "";
      if (state.publishedError) focusAfterAction = "published-passphrase";
    }
  });
}

function publishedForm() {
  const input = element("input", {
    id: "published-passphrase", type: "password", autocomplete: "off", maxlength: 1024, required: true,
    "aria-describedby": "published-error", "aria-invalid": String(state.publishedError === PUBLISHED_PASSWORD_ERROR),
  });
  const submit = element("button", { id: "published-submit", type: "submit", class: "button button-primary" });
  const error = element("p", { id: "published-error", class: "error", role: "alert" }, state.publishedError);
  input.addEventListener("input", () => {
    state.publishedError = "";
    error.textContent = "";
    error.hidden = true;
    input.setAttribute("aria-invalid", "false");
  });
  updaters.push(() => {
    input.disabled = state.busy;
    submit.disabled = state.busy;
    submit.textContent = state.busy && focusAfterAction?.startsWith("published-") ? "기록 여는 중…" : "배포 기록 열기";
    error.hidden = !state.publishedError;
  });
  return element("section", { class: "card published-welcome", "aria-labelledby": "published-title" },
    element("div", { class: "published-intro" },
      element("span", { class: "welcome-icon" }, icon("heart-pulse", 28)),
      element("div", {}, element("h2", { id: "published-title" }, "배포 기록 열기"),
        element("p", {}, "열람 암호를 입력하면 이 페이지에 보관된 Apple 건강 기록이 열립니다."))),
    element("form", { class: "published-form", submit: event => { event.preventDefault(); openPublished(input); } },
      control("열람 암호", input), submit, error),
  );
}

function publishedView() {
  return element("section", { class: "health", "aria-label": "배포 건강 기록" },
    element("div", { class: "preview-toolbar" },
      element("p", { class: "muted" }, "배포 기록 열람 중"),
      button("published-lock", "secondary", [icon("lock-keyhole", 16), "배포 기록 잠그기"], clearSession)),
    renderAppleHealth(state.publishedApple),
  );
}

function lockForm(existing) {
  const { restore } = state;
  const passphrase = element("input", {
    id: "vault-passphrase", type: "password", autocomplete: existing ? "current-password" : "new-password",
    minlength: existing ? undefined : MIN_PASSPHRASE, maxlength: 256, required: true,
  });
  passphrase.value = state.passphrase;
  passphrase.addEventListener("input", () => { state.passphrase = passphrase.value; });

  const confirmation = existing ? null : element("input", {
    id: "vault-confirmation", type: "password", autocomplete: "new-password", minlength: MIN_PASSPHRASE, maxlength: 256, required: true,
  });
  if (confirmation) {
    confirmation.value = state.confirmation;
    confirmation.addEventListener("input", () => { state.confirmation = confirmation.value; });
  }

  const submit = element("button", { id: "vault-submit", type: "submit", class: "button button-primary" });
  updaters.push(() => {
    submit.disabled = state.busy;
    submit.textContent = state.busy ? "처리 중…" : restore ? "암호화 백업 복원" : existing ? "잠금 해제" : "암호 설정하고 시작";
  });

  return element("form", {
    class: "lock-form",
    submit: (event) => {
      event.preventDefault();
      // 암호 관리자가 input 이벤트 없이 채운 값도 놓치지 않도록 제출할 때 다시 읽는다.
      state.passphrase = passphrase.value;
      state.confirmation = confirmation ? confirmation.value : "";
      unlock();
    },
  },
    restore && element("p", { class: "muted" }, `선택한 암호화 백업 ${restore.name}`),
    control("건강 기록 암호", passphrase),
    confirmation && control("건강 기록 암호 확인", confirmation),
    submit,
  );
}

function lockedView() {
  const { restore, hasVault, external } = state;
  const existing = hasVault || restore !== null;

  const vault = element("section", { class: "card locked", "aria-labelledby": "health-vault-title" },
    element("span", { class: "lock-icon" }, icon("lock-keyhole", 24)),
    element("div", {},
      element("h2", { id: "health-vault-title", tabindex: -1 }, state.savingPreview ? "Apple 건강 기록 보관" : existing ? "건강 기록 잠금 해제" : "건강 기록 만들기"),
      element("p", { class: "muted" }, state.savingPreview
        ? (existing ? "암호를 입력하면 방금 연 파일을 기존 기록과 합쳐 보관합니다." : "암호를 만들면 방금 연 파일을 이 브라우저에 보관합니다.")
        : existing
        ? "건강 기록 암호로 이 브라우저의 기록을 엽니다."
        : "건강 기록 전용 암호를 만드세요. 데이터는 이 브라우저에 암호화해 저장합니다."),
    ),
    external
      ? element("div", { class: "actions" },
        element("p", { class: "muted" }, "다른 탭에서 기록이 변경됐습니다."),
        button("vault-reload", "secondary", "최신 저장 상태 불러오기", clearSession, () => false),
      )
      : lockForm(existing),
    feedback,
    element("div", { class: "actions" },
      !hasVault && !external && fileButton("vault-backup-file", restore ? "다른 백업 선택" : "암호화 백업 선택",
        "암호화 백업 파일 선택", () => state.busy, readBackup),
      restore && button("vault-restore-cancel", "secondary", "백업 선택 취소", () => {
        state.restore = null;
        render();
        document.getElementById("vault-backup-file")?.focus();
      }),
      hasVault && button("vault-export", "secondary", "암호화 백업 받기", exportBackup),
      state.savingPreview && button("preview-back", "secondary", "미리보기로 돌아가기", () => {
        state.savingPreview = false;
        state.passphrase = "";
        state.confirmation = "";
        state.notice = "";
        state.error = "";
        render();
      }),
    ),
    element("p", { class: "muted" }, "기기를 바꾸거나 브라우저 데이터를 정리할 때는 암호화 백업을 먼저 받아 두세요. 암호를 잊으면 기록을 열 수 없습니다."),
  );
  if (state.savingPreview) return vault;
  return element("div", { class: "welcome-layout" },
    publishedForm(),
    element("section", { class: "card apple-welcome", "aria-labelledby": "apple-welcome-title" },
      element("span", { class: "welcome-icon" }, icon("heart-pulse", 32)),
      element("h2", { id: "apple-welcome-title" }, "Apple 건강 파일 열기"),
      element("p", {}, "iPad나 iPhone에서 내보낸 건강 기록을 차트로 살펴보세요. 원본 ZIP 또는 XML 파일을 선택하면 바로 열립니다."),
      appleFileButton("apple-open-file", "건강 파일 선택", importAppleFile),
      element("details", { class: "export-help" },
        element("summary", {}, "iPad에서 파일 내보내기"),
        element("p", {}, "건강 앱의 사이드바에서 요약을 누르고 왼쪽 위 프로필을 여세요. ‘모든 건강 데이터 내보내기’를 누른 뒤 ‘파일에 저장’을 선택하세요."),
      ),
    ),
    vault,
  );
}

function metric(iconName, label, value, note) {
  return element("div", {},
    element("dt", {}, icon(iconName, 16), label),
    element("dd", {}, value, element("small", {}, note)),
  );
}

function periodSelect() {
  const select = element("select", { id: "health-period" },
    periods.map((days) => element("option", { value: days }, `최근 ${days}일`)));
  select.value = String(state.period);
  select.addEventListener("change", () => {
    state.period = Number(select.value);
    render();
  });
  return select;
}

function dailyTab(history) {
  const inputs = new Map();
  const edit = (key, read) => () => {
    state.entry = { ...state.entry, [key]: read() };
    refresh();
  };

  const date = element("input", { id: "health-date", type: "date", max: state.today, required: true });
  // 날짜를 바꿀 수 없으면(작성 중인 내용이 있거나 오늘 이후) 입력칸을 원래 날짜로 되돌린다.
  const changeDate = () => {
    if (date.value !== state.entry.date && !selectDate(date.value)) date.value = state.entry.date;
  };
  onEdit(date, changeDate);
  updaters.push(() => { date.disabled = state.busy; });

  const scoreFields = scores.map(({ key, label, low, high }) => {
    const select = element("select", { id: `health-${key}` },
      element("option", { value: "" }, "미기록"),
      [1, 2, 3, 4, 5].map((value) => element("option", { value },
        `${value}${value === 1 ? ` · ${low}` : value === 5 ? ` · ${high}` : ""}`)),
    );
    onEdit(select, edit(key, () => numberValue(select.value)));
    inputs.set(key, select);
    return control(label, select);
  });
  const measureFields = measures.map(({ key, label }) => {
    const input = numberInput(`health-${key}`, key);
    onEdit(input, edit(key, () => numberValue(input.value)));
    inputs.set(key, input);
    return control(label, input);
  });
  const noteFields = dayNotes.map(({ key, label, placeholder }) => {
    const input = element("textarea", { id: `health-${key}`, rows: 3, maxlength: HEALTH_LIMITS.text, placeholder });
    onEdit(input, edit(key, () => input.value));
    inputs.set(key, input);
    return control(label, input);
  });

  fillForm = () => {
    date.value = state.entry.date;
    for (const [key, input] of inputs) input.value = state.entry[key] ?? "";
  };

  const mind = element("fieldset", { class: "fieldset" },
    element("legend", {}, "마음 상태"),
    element("div", { class: "fields" }, scoreFields),
  );
  const body = element("fieldset", { class: "fieldset" },
    element("legend", {}, "몸 상태와 측정값"),
    element("div", { class: "fields" }, measureFields),
    element("div", { class: "text-fields" }, noteFields),
  );
  const submit = element("button", { id: "health-save-daily", type: "submit", class: "button button-primary" }, "일일 기록 저장");
  const cancel = element("button", {
    id: "health-cancel-daily", type: "button", class: "button button-secondary",
    click: () => {
      state.entry = savedEntry();
      state.error = "";
      fillForm();
      refresh();
      date.focus(); // 취소 버튼이 사라지므로 초점을 폼 안에 남긴다
    },
  }, "일일 입력 취소");
  updaters.push(() => {
    const dirty = entryDirty();
    mind.disabled = state.busy;
    body.disabled = state.busy;
    submit.disabled = state.busy || state.external || !dirty;
    cancel.disabled = state.busy;
    cancel.hidden = !dirty;
  });

  const form = element("form", {
    class: "card",
    submit: (event) => {
      event.preventDefault();
      // 날짜 입력칸이 아직 반영되지 않은 값을 갖고 있으면 그 날짜부터 처리하고, 이번에는 저장하지 않는다.
      if (date.value !== state.entry.date) changeDate();
      else save("daily");
    },
  },
    element("div", { class: "section-head" },
      element("div", {},
        element("h2", {}, "일일 기록"),
        element("p", { class: "muted" }, "아는 항목만 입력하고 기억나는 일을 시간과 함께 남기세요."),
      ),
      control("기록 날짜", date),
    ),
    mind,
    body,
    element("div", { class: "actions" }, submit, cancel),
  );

  const trends = element("section", { class: "card", "aria-labelledby": "health-trends-title" },
    element("div", { class: "section-head" },
      element("div", {},
        element("h2", { id: "health-trends-title" }, "최근 흐름"),
        element("p", { class: "muted" }, `선택한 기간의 기록 ${history.length}일을 기준으로 표시합니다.`),
      ),
      control("조회 기간", periodSelect()),
    ),
    element("dl", { class: "trend" },
      element("div", {}, element("dt", {}, "평균 수면"), element("dd", {}, display(average(history, "sleepHours"), "시간"))),
      element("div", {}, element("dt", {}, "평균 기분"), element("dd", {}, display(average(history, "mood"), " / 5"))),
      element("div", {}, element("dt", {}, "평균 기력"), element("dd", {}, display(average(history, "energy"), " / 5"))),
      element("div", {}, element("dt", {}, "평균 스트레스"), element("dd", {}, display(average(history, "stress"), " / 5"))),
    ),
    history.length > 0
      ? element("ul", { class: "history" }, history.map((item) => element("li", {},
        element("button", {
          id: `health-history-${item.date}`, type: "button", class: "history-date",
          click: () => { if (selectDate(item.date)) date.focus(); },
        }, `${item.date} 기록 열기`),
        element("span", {}, [item.symptoms && `증상 ${item.symptoms}`, item.bowel && `배변 ${item.bowel}`, item.notes]
          .filter(Boolean).join(" · ") || "측정값 또는 생활 기록"),
      )))
      : element("p", { class: "muted" }, "이 기간에 작성한 기록이 없습니다."),
  );

  return [form, trends];
}

function profileTab() {
  const inputs = new Map();
  const edit = (key, read) => () => {
    state.profile = { ...state.profile, [key]: read() };
    refresh();
  };

  const birthDate = element("input", { id: "profile-birthDate", type: "date", max: state.today });
  onEdit(birthDate, edit("birthDate", () => birthDate.value));
  inputs.set("birthDate", birthDate);

  const bloodType = element("select", { id: "profile-bloodType" },
    BLOOD_TYPES.map((type) => element("option", { value: type }, type || "미확인")));
  onEdit(bloodType, edit("bloodType", () => bloodType.value));
  inputs.set("bloodType", bloodType);

  const height = numberInput("profile-heightCm", "heightCm");
  onEdit(height, edit("heightCm", () => numberValue(height.value)));
  inputs.set("heightCm", height);

  const noteFields = profileNotes.map(({ key, label }) => {
    const input = element("textarea", { id: `profile-${key}`, rows: 3, maxlength: HEALTH_LIMITS.text });
    onEdit(input, edit(key, () => input.value));
    inputs.set(key, input);
    return control(label, input);
  });

  fillForm = () => {
    for (const [key, input] of inputs) input.value = state.profile[key] ?? "";
  };

  const fields = element("fieldset", { class: "fieldset" },
    element("legend", {}, "신체 정보와 진료 참고사항"),
    element("div", { class: "fields" },
      control("생년월일", birthDate),
      control("혈액형", bloodType),
      control("키 (cm)", height),
    ),
    element("div", { class: "text-fields" }, noteFields),
  );
  const submit = element("button", { id: "health-save-profile", type: "submit", class: "button button-primary" }, "기본정보 저장");
  const cancel = element("button", {
    id: "health-cancel-profile", type: "button", class: "button button-secondary",
    click: () => {
      state.profile = state.session.document.profile;
      state.error = "";
      fillForm();
      refresh();
      birthDate.focus(); // 취소 버튼이 사라지므로 초점을 폼 안에 남긴다
    },
  }, "기본정보 입력 취소");
  updaters.push(() => {
    const dirty = profileDirty();
    fields.disabled = state.busy;
    submit.disabled = state.busy || state.external || !dirty;
    cancel.disabled = state.busy;
    cancel.hidden = !dirty;
  });

  return element("form", {
    class: "card",
    submit: (event) => {
      event.preventDefault();
      save("profile");
    },
  },
    element("h2", {}, "기본정보"),
    element("p", { class: "muted" }, "나이는 생년월일을 기준으로 표시합니다. 몸무게는 일일 기록에 남길 수 있어요."),
    fields,
    element("div", { class: "actions" }, submit, cancel),
  );
}

function visitTab() {
  const text = buildVisitSummary(state.session.document, state.today, state.period);
  const summary = element("textarea", { id: "health-summary", class: "summary", rows: 13, readonly: true });
  summary.value = text;

  return element("section", { class: "card", "aria-labelledby": "health-summary-title" },
    element("div", { class: "section-head" },
      element("div", {},
        element("h2", { id: "health-summary-title" }, "진료에 가져갈 요약"),
        element("p", { class: "muted" }, "저장한 내용에서 증상, 복용 시각, 수면과 측정값을 모았습니다. 진단과 처방은 의료진과 확인하세요."),
      ),
      control("요약 기간", periodSelect()),
    ),
    control("진료 요약 내용", summary),
    element("div", { class: "actions" },
      button("health-summary-copy", "primary", "요약 복사", () => {
        action(async () => {
          try {
            await window.navigator.clipboard.writeText(text);
            state.notice = "진료 요약을 복사했습니다.";
          } catch {
            // 복사 권한이 없으면 내용을 선택해 두어 직접 복사할 수 있게 한다.
            const field = document.getElementById("health-summary");
            field?.focus();
            field?.select();
            state.notice = "요약 내용을 선택했습니다. 복사 키를 눌러 주세요.";
          }
        });
      }),
      button("health-summary-download", "secondary", "텍스트 파일로 받기",
        () => downloadText(text, `진료요약-${state.today}.txt`, "text/plain;charset=utf-8"), () => false),
    ),
  );
}

function openView() {
  const { today, period, tab } = state;
  const records = state.session.document;
  const history = recentEntries(records.entries, today, period);
  const allEntries = records.entries.filter((item) => item.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const weight = mostRecent(allEntries, "weightKg");
  const mood = mostRecent(allEntries, "mood");
  const sleep = mostRecent(allEntries, "sleepHours");
  const age = ageOn(records.profile.birthDate, today);

  return element("section", { class: "health", "aria-label": "개인 건강 관리" },
    element("div", { class: tab === "apple" ? "vault-toolbar" : "card overview" },
      element("div", { class: "section-head" },
        element("div", {},
          tab !== "apple" && element("p", { class: "eyebrow" }, icon("shield-check", 15), "이 브라우저에 암호화 저장"),
          element("h2", { id: "health-overview-title", tabindex: -1 }, tab === "apple" ? [icon("shield-check", 17), "암호화된 내 기록"] : "나의 건강 한눈에 보기"),
        ),
        button("health-lock", "secondary", [icon("lock-keyhole", 15), "기록 잠그기"], lock),
      ),
      tab !== "apple" && element("dl", { class: "metrics" },
        metric("user-round", "나이 · 혈액형", display(age, "세"), records.profile.bloodType || "혈액형 미기록"),
        metric("scale", "최근 몸무게", display(weight?.weightKg, " kg"), weight?.date ?? "몸무게를 기록해 보세요"),
        metric("moon", "최근 수면", display(sleep?.sleepHours, "시간"), sleep?.date ?? "수면을 기록해 보세요"),
        metric("heart-pulse", "최근 기분", display(mood?.mood, " / 5"), mood?.date ?? "기분을 기록해 보세요"),
      ),
    ),
    element("div", { class: "actions health-tabs", role: "group", "aria-label": "건강 관리 화면 선택" },
      tabs.map(({ id, label, icon: iconName }) => element("button", {
        id: `health-tab-${id}`, type: "button", class: `button ${tab === id ? "button-primary" : "button-secondary"}`,
        "aria-pressed": String(tab === id),
        click: () => {
          state.tab = id;
          state.notice = "";
          state.error = "";
          render();
        },
      }, icon(iconName, 15), label)),
    ),
    state.external && element("p", { class: "error", role: "alert" },
      "다른 탭에서 기록이 변경됐습니다. 현재 내용은 암호화 백업으로 받은 뒤 잠금 해제 화면에서 최신 기록을 열 수 있습니다."),
    feedback,
    tab === "apple" ? [
      (entryDirty() || profileDirty()) && element("p", { class: "muted" }, "작성 중인 일일 기록이나 기본정보를 저장하면 파일을 추가할 수 있어요."),
      renderAppleHealth(records.appleHealth, appleFileButton("apple-import-file", records.appleHealth ? "파일 추가" : "건강 파일 선택", importAppleFile)),
    ] : tab === "daily" ? dailyTab(history) : tab === "profile" ? profileTab() : visitTab(),
    element("section", { class: "card backups", "aria-labelledby": "health-backup-title" },
      element("div", {},
        element("h2", { id: "health-backup-title" }, "기록 보관"),
        element("p", { class: "muted" }, "암호화 백업으로 다른 브라우저에서 기록을 복원할 수 있어요."),
      ),
      element("div", { class: "actions" },
        button("health-export", "secondary", "암호화 백업 받기", exportBackup),
        fileButton("health-import", "건강 기록 JSON 추가", "건강 기록 JSON 선택",
          () => state.busy || state.external || entryDirty() || profileDirty(), importDocument),
      ),
    ),
  );
}

function refreshToday() {
  const today = seoulDate.format(new Date());
  if (today === state.today) return;
  state.today = today;
  if (!state.publishedApple) render();
}

try {
  storage = window.localStorage;
  snapshot = storage.getItem(STORAGE_KEY);
  state.hasVault = snapshot !== null;
} catch {
  state.error = "브라우저 저장소를 읽을 수 없습니다. 브라우저 저장 설정을 확인해 주세요.";
}
if (!window.crypto?.subtle) state.error = NO_CRYPTO;

window.addEventListener("pagehide", () => {
  publishedEpoch++;
  const input = document.getElementById("published-passphrase");
  if (input) input.value = "";
  if (state.publishedApple) clearSession();
});

window.addEventListener("storage", (event) => {
  if (event.storageArea !== storage || (event.key !== null && event.key !== STORAGE_KEY)) return;
  const external = event.newValue !== snapshot;
  if (external === state.external) return;
  state.external = external;
  if (!state.publishedApple) render();
});
// 자정이 지나면 오늘 날짜를 바꾼다. 백그라운드 탭은 타이머가 늦어지므로 화면으로 돌아올 때도 확인한다.
window.setInterval(refreshToday, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshToday(); });

render();
