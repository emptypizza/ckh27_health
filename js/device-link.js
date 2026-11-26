// The private URL fragment contains the published passphrase wrapped under a PIN.
// GitHub Pages serves the app without receiving the fragment.
const STORAGE_KEY = "ckh27_health:device-link:v1";
const context = new TextEncoder().encode("ckh27_health:device-link:v1");
const prefix = "v1.";
const saltBytes = 16;
const ivBytes = 12;
const offset = saltBytes + ivBytes;
const encoder = new TextEncoder();

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unpack(token) {
  if (typeof token !== "string" || token.length > 1600 || !/^v1\.[a-zA-Z0-9_-]+$/.test(token)) return null;
  const payload = token.slice(prefix.length);
  try {
    const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
    if (bytes.length <= offset + 16 || encode(bytes) !== payload) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function wrappingKey(pin, salt) {
  if (typeof pin !== "string" || !/^[0-9]{6}$/.test(pin)) throw new Error("여섯 자리 PIN을 입력해 주세요.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Used locally when issuing a private link. The resulting token belongs with its recipient.
export async function createDeviceLink(passphrase, pin) {
  if (typeof passphrase !== "string" || passphrase.length === 0 || encoder.encode(passphrase).length > 1024) {
    throw new Error("열람 암호의 길이를 확인해 주세요.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(saltBytes));
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const key = await wrappingKey(pin, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context }, key, encoder.encode(passphrase));
  const bytes = new Uint8Array(offset + cipher.byteLength);
  bytes.set(salt);
  bytes.set(iv, saltBytes);
  bytes.set(new Uint8Array(cipher), offset);
  return prefix + encode(bytes);
}

export async function openDeviceLink(token, pin) {
  const bytes = unpack(token);
  if (!bytes) throw new Error("기기 등록 링크를 확인해 주세요.");
  const key = await wrappingKey(pin, bytes.subarray(0, saltBytes));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(saltBytes, offset), additionalData: context },
    key, bytes.subarray(offset),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export function readDeviceLink() {
  if (location.hash.startsWith("#access=")) {
    const token = location.hash.slice("#access=".length);
    return unpack(token) ? token : null;
  }
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    return unpack(token) ? token : null;
  } catch {
    return null;
  }
}

export function rememberDeviceLink(token) {
  if (!unpack(token)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    return false;
  }
  if (location.hash === "#access=" + token) {
    try {
      history.replaceState(history.state, "", location.pathname + location.search);
    } catch {
      // The encrypted link is still saved if the browser limits history changes.
    }
  }
  return true;
}
