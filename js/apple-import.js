// Apple exports include a detailed HealthData document and a smaller CDA rendition.
// Both readers preserve the local timestamp and UTC offset written by the source.
import { mergeAppleHealth, validateAppleHealth } from "./apple-model.js";

const MIB = 1024 * 1024;
const MAX_XML = 32 * MIB;
const MAX_ARCHIVE = 256 * MIB;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function emptyData() {
  return { version: 1, records: [], correlations: [], profile: {}, exportedAt: "" };
}

function dataError() {
  return new Error("Apple 건강 XML의 구조나 기록 값을 확인해 주세요.");
}

function children(node, name) {
  return Array.from(node.children).filter((element) => element.localName === name);
}

function child(node, name) {
  return Array.from(node.children).find((element) => element.localName === name);
}

function required(node, name) {
  const value = node.getAttribute(name);
  if (!value) throw dataError();
  return value;
}

function recordKey({ type, start, end, value, unit, source }) {
  return JSON.stringify([type, start, end, value, unit, source]);
}

function healthSample(node) {
  const record = {
    type: required(node, "type"), start: required(node, "startDate"), end: required(node, "endDate"),
    source: node.getAttribute("sourceName") || "",
  };
  if (node.localName === "Record") {
    record.value = required(node, "value");
    record.unit = node.getAttribute("unit") || "";
  }
  for (const [attribute, key] of [["sourceVersion", "sourceVersion"], ["creationDate", "created"], ["device", "device"]]) {
    if (node.hasAttribute(attribute)) record[key] = node.getAttribute(attribute);
  }
  const metadata = children(node, "MetadataEntry");
  if (metadata.length) {
    record.metadata = Object.fromEntries(metadata.map((entry) => [required(entry, "key"), entry.getAttribute("value") ?? ""]));
  }
  return record;
}

function healthData(root) {
  const data = emptyData();
  const nestedRecords = [];
  for (const node of root.children) {
    switch (node.localName) {
      case "ExportDate":
        data.exportedAt = required(node, "value");
        break;
      case "Me":
        data.profile = Object.fromEntries(Array.from(node.attributes)
          .filter(({ name }) => name.startsWith("HKCharacteristicTypeIdentifier"))
          .map(({ name, value }) => [name, value]));
        break;
      case "Record":
        data.records.push(healthSample(node));
        break;
      case "Correlation": {
        const sample = healthSample(node);
        const records = children(node, "Record").map(healthSample);
        for (const record of records) nestedRecords.push(record);
        const members = records.map(({ type, start, end, value, unit, source }) => ({ type, start, end, value, unit, source }));
        data.correlations.push({ ...sample, members });
        break;
      }
    }
  }
  // Apple repeats correlated records at the top level. Count by occurrence, so
  // genuinely repeated measurements stay intact, including in a partial export.
  const available = new Map();
  for (const record of data.records) {
    const key = recordKey(record);
    available.set(key, (available.get(key) || 0) + 1);
  }
  for (const record of nestedRecords) {
    const key = recordKey(record);
    const count = available.get(key) || 0;
    if (count) available.set(key, count - 1);
    else data.records.push(record);
  }
  return data;
}

function cdaDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/.exec(value || "");
  if (!match) throw dataError();
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]} ${match[7]}`;
}

function cdaData(root) {
  const data = emptyData();
  const exported = child(root, "effectiveTime")?.getAttribute("value");
  if (exported) data.exportedAt = cdaDate(exported);
  const patient = root.getElementsByTagNameNS("*", "patient")[0];
  if (patient) {
    const birth = /^(\d{4})(\d{2})(\d{2})$/.exec(child(patient, "birthTime")?.getAttribute("value") || "");
    if (birth) data.profile.HKCharacteristicTypeIdentifierDateOfBirth = birth.slice(1).join("-");
    const gender = child(patient, "administrativeGenderCode")?.getAttribute("code");
    const sex = { M: "Male", F: "Female", UN: "Other" }[gender];
    if (sex) data.profile.HKCharacteristicTypeIdentifierBiologicalSex = `HKBiologicalSex${sex}`;
  }
  for (const observation of root.getElementsByTagNameNS("*", "observation")) {
    const text = child(observation, "text");
    const interval = child(observation, "effectiveTime");
    if (!text || !interval) throw dataError();
    const field = (name) => child(text, name)?.textContent || "";
    const type = field("type");
    const value = field("value");
    if (!type || !value) throw dataError();
    const record = {
      type, value, unit: field("unit"), source: field("sourceName"),
      start: cdaDate(child(interval, "low")?.getAttribute("value")),
      end: cdaDate(child(interval, "high")?.getAttribute("value")),
    };
    if (field("sourceVersion")) record.sourceVersion = field("sourceVersion");
    const metadata = children(text, "metadataEntry");
    if (metadata.length) record.metadata = Object.fromEntries(metadata.map((entry) => {
      const key = child(entry, "key")?.textContent;
      if (!key) throw dataError();
      return [key, child(entry, "value")?.textContent || ""];
    }));
    data.records.push(record);
  }
  return data;
}

export function parseAppleHealthXML(text) {
  if (text.length > MAX_XML || /<!ENTITY\s|<!DOCTYPE\s+[^>\[]*?\s(?:SYSTEM|PUBLIC)\s/i.test(text)) throw dataError();
  // Some Apple CDA exports close ClinicalDocument before their vital-sign
  // components. Reattach only those trailing components to their original root.
  const close = "</ClinicalDocument>";
  const offset = text.indexOf(close);
  if (offset >= 0 && /^\s*<component(?:\s|>)/.test(text.slice(offset + close.length))) {
    text = text.slice(0, offset) + text.slice(offset + close.length) + close;
  }
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagNameNS("*", "parsererror").length) throw dataError();
  const root = document.documentElement;
  let data;
  if (root.localName === "HealthData") data = healthData(root);
  else if (root.localName === "ClinicalDocument") data = cdaData(root);
  else throw dataError();
  if (!data.records.length && !data.correlations.length && !Object.keys(data.profile).length) {
    throw new Error("파일에서 가져올 수 있는 Apple 건강 기록을 찾지 못했습니다.");
  }
  return validateAppleHealth(data);
}

// Read the central directory, rather than relying on local header sizes. Apple
// ZIPs use data descriptors and can store decomposed Korean names without a UTF-8 flag.
function zipError() {
  return new Error("Apple 건강 ZIP을 읽을 수 없습니다. 파일 앱에서 압축을 풀고 건강 XML을 선택해 주세요.");
}

async function bytesAt(file, offset, length) {
  if (offset < 0 || length < 0 || offset + length > file.size) throw zipError();
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function appleXMLFiles(file) {
  const tailLength = Math.min(file.size, 22 + 65535);
  const tail = view(await bytesAt(file, file.size - tailLength, tailLength));
  let end = tailLength - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 || end + 22 + tail.getUint16(end + 20, true) !== tailLength)) end--;
  if (end < 0 || tail.getUint32(end + 4, true) !== 0) throw zipError();
  const count = tail.getUint16(end + 10, true);
  const length = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (count !== tail.getUint16(end + 8, true) || offset + length > file.size - tailLength + end || length > 8 * MIB) throw zipError();
  const raw = await bytesAt(file, offset, length);
  const directory = view(raw);
  const entries = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > length || directory.getUint32(pos, true) !== 0x02014b50) throw zipError();
    const nameSize = directory.getUint16(pos + 28, true);
    const next = pos + 46 + nameSize + directory.getUint16(pos + 30, true) + directory.getUint16(pos + 32, true);
    if (next > length) throw zipError();
    // The path suffix and reserved folder names are ASCII in every Apple locale.
    const path = new TextDecoder().decode(raw.subarray(pos + 46, pos + 46 + nameSize)).replaceAll("\\", "/");
    if (/^(?:[^/]+\/)?[^/]+\.xml$/i.test(path) && !/(?:^|\/)(?:__MACOSX|\._)/.test(path)) {
      if (directory.getUint16(pos + 8, true) & 1) throw zipError();
      entries.push({ path, method: directory.getUint16(pos + 10, true), crc: directory.getUint32(pos + 16, true),
        compressed: directory.getUint32(pos + 20, true), size: directory.getUint32(pos + 24, true),
        offset: directory.getUint32(pos + 42, true) });
    }
    pos = next;
  }
  if (!entries.length) throw new Error("ZIP에서 건강 XML을 찾지 못했습니다. 건강 앱에서 내보낸 ZIP을 선택해 주세요.");
  if (entries.some((entry) => entry.size > MAX_XML) || entries.reduce((sum, entry) => sum + entry.size, 0) > 2 * MAX_XML) {
    throw new Error("ZIP 안의 건강 XML은 파일당 32MiB, 합계 64MiB까지 읽을 수 있습니다.");
  }
  return entries.sort((a, b) => Number(/export_cda\.xml$/i.test(b.path)) - Number(/export_cda\.xml$/i.test(a.path)));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

async function unzipXML(file, entry) {
  const header = view(await bytesAt(file, entry.offset, 30));
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== entry.method) throw zipError();
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + entry.compressed > file.size) throw zipError();
  const compressed = file.slice(start, start + entry.compressed);
  let bytes;
  if (entry.method === 0) {
    if (entry.compressed !== entry.size) throw zipError();
    bytes = new Uint8Array(await compressed.arrayBuffer());
  } else if (entry.method === 8) {
    let inflater;
    try {
      inflater = new DecompressionStream("deflate-raw");
    } catch {
      throw zipError();
    }
    const reader = compressed.stream().pipeThrough(inflater).getReader();
    bytes = new Uint8Array(entry.size);
    let written = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (written + value.length > bytes.length) throw zipError();
        bytes.set(value, written);
        written += value.length;
      }
      if (written !== bytes.length) throw zipError();
    } catch {
      await reader.cancel().catch(() => {});
      throw zipError();
    }
  } else throw zipError();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw zipError();
  return utf8.decode(bytes);
}

export async function readAppleHealth(file) {
  if (file.size > MAX_ARCHIVE) throw new Error("Apple 건강 ZIP은 256MiB까지 읽을 수 있습니다.");
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] === 0x50 && signature[1] === 0x4b) {
    const entries = await appleXMLFiles(file);
    let data;
    for (const entry of entries) {
      const next = parseAppleHealthXML(await unzipXML(file, entry));
      data = data ? mergeAppleHealth(data, next) : next;
    }
    return data;
  }
  if (file.size > MAX_XML) throw new Error("Apple 건강 XML은 32MiB까지 읽을 수 있습니다.");
  return parseAppleHealthXML(await file.text());
}
