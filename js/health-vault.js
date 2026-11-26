// 건강 기록을 암호로 잠그는 봉투(v1). PBKDF2-SHA256 600,000회로 키를 만들고 AES-GCM 256으로 암호화한다.
// fortune-report의 app/lib/health-vault.ts에서 타입 표기만 뺀 것이다. 봉투 형식과 additionalData 문자열이
// 달라지면 이미 받아 둔 암호화 백업을 열 수 없으므로 그대로 둔다.

import { HEALTH_LIMITS, parseHealthDocument } from "./health.js";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PLAINTEXT_LIMIT = HEALTH_LIMITS.vaultBytes;
const CIPHERTEXT_LIMIT = PLAINTEXT_LIMIT + TAG_BYTES;
export const HEALTH_VAULT_FILE_BYTES = 4 * Math.ceil(CIPHERTEXT_LIMIT / 3) + 256;
const encoder = new TextEncoder();

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeBase64(value, minimum, maximum = minimum) {
  const invalid = () => new Error("암호화된 건강 기록의 형식이 올바르지 않습니다.");
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maximum / 3) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw invalid();
  }
  const binary = atob(value);
  if (binary.length < minimum || binary.length > maximum || btoa(binary) !== value) throw invalid();
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("암호화된 건강 기록의 형식이 올바르지 않습니다.");
  const fields = value;
  if (fields.version !== 1) throw new Error("지원하지 않는 건강 기록 암호화 버전입니다.");
  const expected = ["version", "salt", "iv", "ciphertext"];
  if (Object.keys(fields).length !== expected.length || !expected.every((field) => Object.hasOwn(fields, field))) {
    throw new Error("암호화된 건강 기록의 형식이 올바르지 않습니다.");
  }
  const salt = decodeBase64(fields.salt, SALT_BYTES);
  const iv = decodeBase64(fields.iv, IV_BYTES);
  const ciphertext = decodeBase64(fields.ciphertext, TAG_BYTES + 1, CIPHERTEXT_LIMIT);
  return { envelope: fields, salt, iv, ciphertext };
}

export function parseHealthVault(raw) {
  if (raw.length > HEALTH_VAULT_FILE_BYTES) throw new Error("암호화된 건강 기록 파일이 너무 큽니다.");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("암호화된 건강 기록 JSON을 읽을 수 없습니다.");
  }
  return decodeEnvelope(value).envelope;
}

async function deriveKey(passphrase, salt) {
  if (passphrase.length < 1 || passphrase.length > 1024) throw new Error("건강 기록의 암호를 확인해 주세요.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, hash: "SHA-256", iterations: 600_000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function cipherParameters(iv, salt) {
  return { name: "AES-GCM", iv, tagLength: 128, additionalData: encoder.encode(`fortune-report:health-vault:v1:${salt}`) };
}

export async function sealHealthVault(document, key, salt) {
  decodeBase64(salt, SALT_BYTES);
  const raw = JSON.stringify(document);
  const plaintext = encoder.encode(raw);
  parseHealthDocument(raw, PLAINTEXT_LIMIT);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(cipherParameters(iv, salt), key, plaintext);
  return { version: 1, salt, iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) };
}

export async function createHealthVault(document, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt);
  const envelope = await sealHealthVault(document, key, encodeBase64(salt));
  return { key, envelope };
}

export async function unlockHealthVault(envelope, passphrase) {
  const { salt, iv, ciphertext } = decodeEnvelope(envelope);
  const key = await deriveKey(passphrase, salt);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(cipherParameters(iv, envelope.salt), key, ciphertext);
  } catch {
    throw new Error("암호가 맞는지 확인해 주세요. 암호화된 파일이 손상되었을 수도 있습니다.");
  }
  const document = parseHealthDocument(new TextDecoder("utf-8", { fatal: true }).decode(plaintext), PLAINTEXT_LIMIT);
  return { key, document };
}
