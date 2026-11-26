import { createHealthVault, HEALTH_VAULT_FILE_BYTES, parseHealthVault, unlockHealthVault } from "./health-vault.js";

const endpoint = "https://api.github.com/repos/emptypizza/ckh27_health/contents/js/published-vault.js";
const maxSourceBytes = HEALTH_VAULT_FILE_BYTES + 256;
const shaPattern = /^[0-9a-f]{40}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
// HTML pattern and this Unicode regex both count code points, including emoji.
export const NEW_PASSPHRASE_PATTERN = /^[\s\S]{4,12}$/u;

class RotationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function failure(code, message) {
  return new RotationError(code, message);
}

function conflict() {
  return failure("conflict", "다른 변경이 먼저 저장되었습니다. 최신 기록을 다시 읽고 현재 열람 암호를 확인해 주세요.");
}

export function readPublishedEnvelope(text) {
  const invalid = () => failure("invalid", "저장소의 암호화된 배포 기록 형식을 확인해 주세요.");
  if (typeof text !== "string" || text.length > maxSourceBytes) throw invalid();
  const source = text.trim();
  const prefix = "export default ";
  if (!source.startsWith(prefix) || !source.endsWith(";")) throw invalid();
  try {
    // A replacement in the repository is data on this page; never import or evaluate it.
    return parseHealthVault(source.slice(prefix.length, -1));
  } catch {
    throw invalid();
  }
}

export async function gitBlobSha(input) {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  const header = encoder.encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  // Git's object ID includes the byte length, NUL, and the exact file bytes.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", object));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function accessError(status) {
  if ([401, 403, 404].includes(status)) {
    return failure("auth", "GitHub 토큰의 만료일과 이 저장소의 Contents 쓰기 권한, main 브랜치의 보호 설정을 확인해 주세요.");
  }
  if (status === 409) return conflict();
  return failure("unavailable", "GitHub에서 변경을 확인하지 못했습니다. 연결 상태와 저장소 설정을 확인한 뒤 다시 시도해 주세요.");
}

function requestOptions(token, method) {
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) throw accessError(401);
  return {
    method, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: "Bearer " + token.trim(),
      Accept: method === "GET" ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  };
}

async function currentFile(token, fetcher) {
  const options = requestOptions(token, "GET");
  let response;
  let bytes;
  try {
    response = await fetcher(endpoint + "?ref=main", options);
    if (!response.ok) throw accessError(response.status);
    if (Number(response.headers.get("content-length")) > maxSourceBytes) throw failure("invalid", "배포 기록 파일이 너무 큽니다.");
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof RotationError) throw error;
    throw failure("unavailable", "GitHub에서 현재 배포 기록을 읽지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
  }
  if (bytes.length > maxSourceBytes) throw failure("invalid", "배포 기록 파일이 너무 큽니다.");
  return { bytes, sha: await gitBlobSha(bytes) };
}

export async function preparePublishedRotation({ token, currentPassphrase, newPassphrase }, fetcher = fetch) {
  if (typeof currentPassphrase !== "string" || !currentPassphrase.length || currentPassphrase.length > 1024) {
    throw failure("current", "현재 열람 암호를 확인해 주세요.");
  }
  if (typeof newPassphrase !== "string" || !NEW_PASSPHRASE_PATTERN.test(newPassphrase)) {
    throw failure("invalid", "새 열람 암호는 4자 이상 12자 이하로 입력해 주세요.");
  }
  if (newPassphrase === currentPassphrase) throw failure("invalid", "현재 암호와 다른 새 열람 암호를 입력해 주세요.");
  const { bytes, sha } = await currentFile(token, fetcher);
  let sourceText;
  try { sourceText = decoder.decode(bytes); } catch { throw failure("invalid", "배포 기록 파일의 텍스트 인코딩을 확인해 주세요."); }
  const original = readPublishedEnvelope(sourceText);
  let document;
  try {
    ({ document } = await unlockHealthVault(original, currentPassphrase));
  } catch {
    throw failure("current", "현재 열람 암호로 저장소의 배포 기록을 열지 못했습니다.");
  }
  if (!document.appleHealth) throw failure("invalid", "이 배포 파일에 Apple 건강 기록이 없습니다.");
  const { envelope } = await createHealthVault(document, newPassphrase);
  const reopened = await unlockHealthVault(envelope, newPassphrase);
  if (JSON.stringify(reopened.document) !== JSON.stringify(document)) throw failure("invalid", "새 암호로 전체 기록을 검증하지 못했습니다.");
  // The module contains only ASCII envelope keys, numbers and Base64 values.
  const source = "export default " + JSON.stringify(envelope) + ";\n";
  return Object.freeze({ baseSha: sha, blobSha: await gitBlobSha(source), content: btoa(source) });
}

export async function commitPublishedRotation(prepared, token, fetcher = fetch) {
  // Recheck even on a retry. If a prior response was lost we can recognize the
  // exact replacement without making another commit or requiring the old password.
  const { baseSha, blobSha, content } = prepared ?? {};
  if (!shaPattern.test(baseSha) || !shaPattern.test(blobSha) || typeof content !== "string" || content.length > 4 * Math.ceil(maxSourceBytes / 3)) {
    throw failure("invalid", "암호 변경 데이터를 다시 준비해 주세요.");
  }
  let source;
  try { source = atob(content); } catch { throw failure("invalid", "암호 변경 데이터를 다시 준비해 주세요."); }
  const envelope = readPublishedEnvelope(source);
  if (source !== "export default " + JSON.stringify(envelope) + ";\n") throw failure("invalid", "암호 변경 데이터를 다시 준비해 주세요.");
  if (await gitBlobSha(source) !== blobSha) throw failure("invalid", "암호 변경 데이터가 달라졌습니다. 다시 준비해 주세요.");
  const current = await currentFile(token, fetcher);
  if (current.sha === blobSha) return { blobSha, commitSha: null };
  if (current.sha !== baseSha) throw conflict();
  const options = requestOptions(token, "PUT");
  options.headers["Content-Type"] = "application/json";
  options.body = JSON.stringify({ message: "배포 건강 기록 열람 암호 변경", content, sha: baseSha, branch: "main" });
  let status;
  try {
    const response = await fetcher(endpoint, options);
    status = response.status;
    if (response.ok) {
      const body = await response.json();
      if (body.content?.sha === blobSha && shaPattern.test(body.commit?.sha)) return { blobSha, commitSha: body.commit.sha };
    }
  } catch {
    // A timeout, disconnected response, or partial response body can follow a successful PUT.
  }
  let observed;
  try {
    observed = await currentFile(token, fetcher);
  } catch {
    throw failure("unknown", "저장 요청 결과를 확인할 수 없습니다. 이 화면에서 다시 시도하면 같은 변경의 저장 여부를 먼저 확인합니다.");
  }
  if (observed.sha === blobSha) return { blobSha, commitSha: null };
  if (observed.sha !== baseSha) throw conflict();
  throw accessError(status);
}
