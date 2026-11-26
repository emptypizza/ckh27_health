// The encrypted document keeps individual Apple samples and their relationships.
// Hand-entered daily observations have a separate schema and can share the same dates.
const sampleFields = ["type", "start", "end", "source", "sourceVersion", "created", "metadata", "device"];
const recordFields = [...sampleFields, "value", "unit"];
const correlationFields = [...sampleFields, "members"];
const identifier = /^HK[A-Za-z0-9_]+$/;
const appleTime = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d{1,3})?) ([+-]\d\d)(\d\d)$/;

function invalid() {
  throw new Error("Apple 건강 기록 형식을 확인해 주세요.");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkFields(value, fields) {
  if (!isObject(value) || Object.keys(value).some(key => !fields.includes(key))) invalid();
}

function checkText(value) {
  if (typeof value !== "string" || value.length > 6000) invalid();
}

function checkMap(value, isValidKey) {
  if (!isObject(value)) invalid();
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 1024 || !isValidKey(key)) invalid();
    checkText(item);
  }
}

function timestamp(value) {
  const parts = typeof value === "string" && appleTime.exec(value);
  if (!parts) invalid();
  const [, date, time, offsetHour, offsetMinute] = parts;
  const midnight = Date.parse(date);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date
    || Number(time.slice(0, 2)) > 23) invalid();
  const timeMs = Date.parse(`${date}T${time}${offsetHour}:${offsetMinute}`);
  if (!Number.isFinite(timeMs)) invalid();
  return timeMs;
}

function checkSample(row, isCorrelation) {
  checkFields(row, isCorrelation ? correlationFields : recordFields);
  checkText(row.type);
  if (!identifier.test(row.type)) invalid();
  checkText(row.source);
  if (timestamp(row.start) > timestamp(row.end)) invalid();
  if (row.created !== undefined) timestamp(row.created);
  for (const key of ["sourceVersion", "device"]) {
    if (row[key] !== undefined) checkText(row[key]);
  }
  if (row.metadata !== undefined) {
    checkMap(row.metadata, key => !["__proto__", "constructor", "prototype"].includes(key));
  }
  if (isCorrelation) {
    if (!Array.isArray(row.members) || !row.members.length) invalid();
    for (const member of row.members) checkSample(member, false);
  } else {
    checkText(row.value);
    checkText(row.unit);
    if (row.type.startsWith("HKQuantityTypeIdentifier")
      && (!row.value.trim() || !Number.isFinite(Number(row.value)))) invalid();
  }
}

export function validateAppleHealth(value) {
  checkFields(value, ["version", "profile", "exportedAt", "records", "correlations"]);
  if (value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.correlations)) invalid();
  if (value.exportedAt !== "") timestamp(value.exportedAt);
  checkMap(value.profile, key => /^HKCharacteristicTypeIdentifier[A-Za-z0-9_]+$/.test(key));
  for (const row of value.records) checkSample(row, false);
  for (const row of value.correlations) checkSample(row, true);
  return value;
}

function sampleKey(row) {
  const fields = [row.type, row.start, row.end, row.source];
  if (row.members) fields.push(row.members.map(sampleKey).sort());
  else fields.push(row.value, row.unit);
  return JSON.stringify(fields);
}

// CDA omits details such as creation dates. A missing detail can be supplemented
// by a full export; conflicting details can identify separate measurements.
function compatible(first, second) {
  for (const key of ["created", "sourceVersion", "device"]) {
    if (first[key] && second[key] && first[key] !== second[key]) return false;
  }
  return Object.entries(first.metadata ?? {}).every(([key, value]) =>
    !Object.hasOwn(second.metadata ?? {}, key) || second.metadata[key] === value);
}

function sameEvidence(first, second) {
  return first.created === second.created && first.device === second.device && first.sourceVersion === second.sourceVersion
    && Object.keys(first.metadata ?? {}).length === Object.keys(second.metadata ?? {}).length && compatible(first, second);
}

function combineSample(first, second) {
  const row = { ...first, ...second };
  for (const key of ["created", "sourceVersion", "device"]) {
    if (!second[key] && first[key]) row[key] = first[key];
  }
  if (first.metadata || second.metadata) row.metadata = { ...first.metadata, ...second.metadata };
  if (first.members) row.members = mergeSamples(first.members, second.members);
  return row;
}

function mergeSamples(previous, incoming) {
  const result = previous.slice();
  const unmatched = new Map();
  for (const [index, row] of previous.entries()) {
    const key = sampleKey(row);
    if (!unmatched.has(key)) unmatched.set(key, []);
    unmatched.get(key).push(index);
  }
  function matchOnce(row, compare) {
    const candidates = unmatched.get(sampleKey(row));
    const match = candidates?.findIndex(index => compare(previous[index], row)) ?? -1;
    if (match === -1) return false;
    const [index] = candidates.splice(match, 1);
    result[index] = combineSample(previous[index], row);
    return true;
  }
  // Reserve exact occurrences first. A sparse CDA sample must not claim the
  // only slot for a fully identified sample elsewhere in the same import.
  const remaining = incoming.filter(row => !matchOnce(row, sameEvidence));
  for (const row of remaining) {
    if (!matchOnce(row, compatible)) result.push(row);
  }
  return result;
}

export function mergeAppleHealth(previous, incoming) {
  validateAppleHealth(incoming);
  if (!previous) return incoming;
  const oldTime = previous.exportedAt ? timestamp(previous.exportedAt) : -Infinity;
  const newTime = incoming.exportedAt ? timestamp(incoming.exportedAt) : -Infinity;
  const [older, newer] = newTime >= oldTime ? [previous, incoming] : [incoming, previous];
  return {
    version: 1,
    exportedAt: newer.exportedAt,
    profile: { ...older.profile, ...newer.profile },
    records: mergeSamples(previous.records, incoming.records),
    correlations: mergeSamples(previous.correlations, incoming.correlations),
  };
}
