// node:test와 node:assert/strict 가운데 원본 테스트가 쓰는 부분만 브라우저용으로 옮긴 실행기.
// 테스트 파일이 모두 실행된 뒤 window load에서 한 번 돌고, 결과를 페이지와 <html data-result>에 남긴다.

const tests = [];
const loadErrors = [];

export function test(name, run) {
  tests.push({ name, run });
}

function describe(value) {
  let text;
  try {
    text = value instanceof RegExp ? String(value) : JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) text = String(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function fail(message) {
  throw new Error(message);
}

function sameValue(first, second) {
  if (Object.is(first, second)) return true;
  if (typeof first !== "object" || typeof second !== "object" || first === null || second === null) return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length
    && keys.every((key) => Object.hasOwn(second, key) && sameValue(first[key], second[key]));
}

function checkError(error, pattern) {
  const message = error instanceof Error ? error.message : String(error);
  if (pattern && !pattern.test(message)) fail(`오류 메시지 ${describe(message)}가 ${pattern}와 맞지 않습니다.`);
}

export const assert = {
  ok(value) {
    if (!value) fail(`참이어야 하는 값이 ${describe(value)}입니다.`);
  },
  equal(actual, expected) {
    if (!Object.is(actual, expected)) fail(`${describe(actual)}가 ${describe(expected)}와 다릅니다.`);
  },
  notEqual(actual, expected) {
    if (Object.is(actual, expected)) fail(`두 값이 모두 ${describe(actual)}입니다.`);
  },
  deepEqual(actual, expected) {
    if (!sameValue(actual, expected)) fail(`${describe(actual)}가 ${describe(expected)}와 다릅니다.`);
  },
  match(text, pattern) {
    if (!pattern.test(text)) fail(`${describe(text)}가 ${pattern}와 맞지 않습니다.`);
  },
  doesNotMatch(text, pattern) {
    if (pattern.test(text)) fail(`${describe(text)}가 ${pattern}와 맞습니다.`);
  },
  throws(run, pattern) {
    try {
      run();
    } catch (error) {
      checkError(error, pattern);
      return;
    }
    fail("오류가 나야 하는데 나지 않았습니다.");
  },
  async rejects(promise, pattern) {
    try {
      await promise;
    } catch (error) {
      checkError(error, pattern);
      return;
    }
    fail("거부되어야 하는 작업이 성공했습니다.");
  },
};

function line(className, text) {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

async function runAll() {
  const summary = document.getElementById("test-summary");
  const results = document.getElementById("test-results");
  let failed = 0;
  for (const message of loadErrors) {
    failed += 1;
    results.append(line("error", `불러오기 실패 · ${message}`));
  }
  for (const { name, run } of tests) {
    try {
      await run();
      results.append(line("notice", `통과 · ${name}`));
    } catch (error) {
      failed += 1;
      results.append(line("error", `실패 · ${name} · ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (!tests.length && !failed) {
    failed = 1;
    results.append(line("error", "실행할 테스트를 찾지 못했습니다."));
  }
  const text = failed ? `테스트 ${tests.length}개 실행 · 실패 ${failed}건` : `테스트 ${tests.length}개 모두 통과`;
  summary.textContent = text;
  document.title = `${text} · 건강 관리 테스트`;
  document.documentElement.dataset.result = failed ? "fail" : "pass";
}

// 테스트 파일을 불러오지 못하거나 실행 중 오류가 나도 통과로 보이지 않게 한다.
window.addEventListener("error", (event) => {
  loadErrors.push(event.message || `${event.target?.src ?? "스크립트"}를 불러오지 못했습니다.`);
}, true);
window.addEventListener("load", () => { void runAll(); });
