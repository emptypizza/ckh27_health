// 건강 기록 문서(v1)의 형식, 입력 검증, 진료 요약 생성.
// fortune-report의 app/lib/health.ts에서 타입 표기만 뺀 것으로, 기록 형식은 원본과 같다.

export const BLOOD_TYPES = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "A", "B", "AB", "O"];

export const HEALTH_LIMITS = { text: 6000, fileBytes: 1_000_000, entries: 3660 };

export const HEALTH_RANGES = {
  heightCm: { min: 20, max: 300, step: 0.1 },
  weightKg: { min: 0.1, max: 700, step: 0.1 },
  sleepHours: { min: 0, max: 24, step: 0.1 },
  mood: { min: 1, max: 5, step: 1 },
  energy: { min: 1, max: 5, step: 1 },
  stress: { min: 1, max: 5, step: 1 },
  temperatureC: { min: 25, max: 45, step: 0.1 },
  pulse: { min: 10, max: 350, step: 1 },
  systolic: { min: 20, max: 350, step: 1 },
  diastolic: { min: 20, max: 350, step: 1 },
};

const profileText = {
  allergies: "알레르기",
  conditions: "건강 상태·진료 이력",
  medications: "평소 복용약",
  clinician: "진료기관·의료진",
};

const entryText = {
  symptoms: "증상",
  medications: "복약",
  meals: "식사",
  bowel: "배변",
  notes: "메모",
};

const entryNumbers = {
  weightKg: ["체중", "kg"],
  sleepHours: ["수면", "시간"],
  mood: ["기분", "점"],
  energy: ["기력", "점"],
  stress: ["스트레스", "점"],
  temperatureC: ["체온", "°C"],
  pulse: ["맥박", "회/분"],
  systolic: ["수축기 혈압", "mmHg"],
  diastolic: ["이완기 혈압", "mmHg"],
};

const entryTextKeys = Object.keys(entryText);
const entryNumberKeys = Object.keys(entryNumbers);
const profileTextKeys = Object.keys(profileText);
const dayMs = 24 * 60 * 60 * 1000;

export function emptyHealthDocument() {
  return {
    version: 1,
    profile: {
      birthDate: "", bloodType: "", heightCm: null, allergies: "", conditions: "", medications: "", clinician: "",
    },
    entries: [],
  };
}

export function emptyHealthEntry(date) {
  return {
    date, weightKg: null, sleepHours: null, mood: null, energy: null, stress: null, temperatureC: null,
    pulse: null, systolic: null, diastolic: null, symptoms: "", medications: "", meals: "", bowel: "", notes: "",
  };
}

function civilDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function checkedObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} 형식을 확인해 주세요.`);
  }
  return value;
}

function checkedText(value, label) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > HEALTH_LIMITS.text) {
    throw new Error(`${label}은 최대 6,000자까지 입력할 수 있습니다.`);
  }
  return value;
}

function checkedNumber(value, key, label) {
  if (value === undefined || value === null) return null;
  const { min, max, step } = HEALTH_RANGES[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) {
    throw new Error(`${label} 입력값을 확인해 주세요. 허용 범위는 ${min}~${max}${step === 1 ? "의 정수" : ""}입니다.`);
  }
  return value;
}

/** Validate imported JSON before accepting it. Optional values omitted in v1 stay blank. */
export function parseHealthDocument(raw) {
  if (new TextEncoder().encode(raw).length > HEALTH_LIMITS.fileBytes) {
    throw new Error("건강 기록 파일은 1MB 이하만 가져올 수 있습니다.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("올바른 JSON 건강 기록 파일이 아닙니다.");
  }
  const source = checkedObject(parsed, ["version", "profile", "entries"], "건강 기록");
  if (source.version !== 1) throw new Error("이 버전의 건강 기록 파일은 지원하지 않습니다.");
  const result = emptyHealthDocument();
  const profile = checkedObject(source.profile, ["birthDate", "bloodType", "heightCm", ...profileTextKeys], "건강 프로필");
  const birthDate = profile.birthDate === undefined ? "" : profile.birthDate;
  const bloodType = profile.bloodType === undefined ? "" : profile.bloodType;
  if (birthDate !== "" && !civilDate(birthDate)) throw new Error("생년월일을 확인해 주세요.");
  if (typeof bloodType !== "string" || !BLOOD_TYPES.includes(bloodType)) {
    throw new Error("혈액형을 확인해 주세요.");
  }
  result.profile.birthDate = birthDate;
  result.profile.bloodType = bloodType;
  result.profile.heightCm = checkedNumber(profile.heightCm, "heightCm", "키");
  for (const key of profileTextKeys) result.profile[key] = checkedText(profile[key], profileText[key]);

  if (!Array.isArray(source.entries) || source.entries.length > HEALTH_LIMITS.entries) {
    throw new Error("날짜별 건강 기록은 최대 3,660개까지 가져올 수 있습니다.");
  }
  const dates = new Set();
  for (const value of source.entries) {
    const item = checkedObject(value, ["date", ...entryNumberKeys, ...entryTextKeys], "날짜별 건강 기록");
    if (!civilDate(item.date)) throw new Error("건강 기록 날짜를 확인해 주세요.");
    if (dates.has(item.date)) throw new Error(`${item.date} 기록이 중복됩니다.`);
    dates.add(item.date);
    const entry = emptyHealthEntry(item.date);
    for (const key of entryNumberKeys) entry[key] = checkedNumber(item[key], key, entryNumbers[key][0]);
    for (const key of entryTextKeys) entry[key] = checkedText(item[key], entryText[key]);
    result.entries.push(entry);
  }
  result.entries.sort((first, second) => first.date < second.date ? -1 : 1);
  return result;
}

export function ageOn(birthDate, date) {
  if (!civilDate(birthDate) || !civilDate(date) || birthDate > date) return null;
  const years = Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return date.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

function compactText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function repeatedSymptoms(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const seen = new Set();
    for (const text of entry.symptoms.split(/[,，、;；\n]+/)) {
      const label = compactText(text);
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      const count = counts.get(key);
      if (count) count.days += 1;
      else counts.set(key, { label, days: 1 });
    }
  }
  return Array.from(counts.values())
    .filter((item) => item.days >= 2)
    .sort((first, second) => second.days - first.days || (first.label < second.label ? -1 : 1))
    .slice(0, 5)
    .map((item) => `${item.label} ${item.days}일`);
}

export function buildVisitSummary(document, today, days = 14) {
  if (!civilDate(today) || !Number.isInteger(days) || days < 1 || days > HEALTH_LIMITS.entries) {
    throw new Error("진료 요약 기간을 확인해 주세요.");
  }
  const start = new Date(Date.parse(today) - (days - 1) * dayMs).toISOString().slice(0, 10);
  const entries = document.entries
    .filter((entry) => entry.date >= start && entry.date <= today
      && (entryNumberKeys.some((key) => entry[key] !== null) || entryTextKeys.some((key) => entry[key].trim())))
    .sort((first, second) => first.date < second.date ? -1 : 1);
  const profile = document.profile;
  const age = ageOn(profile.birthDate, today);
  const profileDetails = [
    age === null ? "" : `만 ${age}세`,
    profile.bloodType ? `혈액형 ${profile.bloodType}` : "",
    profile.heightCm === null ? "" : `키 ${profile.heightCm} cm`,
    ...profileTextKeys.filter((key) => profile[key].trim()).map((key) => `${profileText[key]} · ${compactText(profile[key])}`),
  ].filter(Boolean);
  const lines = [
    "진료용 건강 기록 요약",
    `기간 ${start} ~ ${today} (한국 날짜)`,
    `내용을 기록한 날 ${entries.length}일 · 내용이 없는 날 ${days - entries.length}일`,
    "내용이 없는 날의 증상이나 측정값은 확인할 수 없습니다.",
  ];
  if (profileDetails.length) lines.push("", "건강 프로필", ...profileDetails.map((detail) => `- ${detail}`));
  if (!entries.length) return [...lines, "", "이 기간에 입력된 증상이나 측정값이 없습니다."].join("\n");

  const measurements = [];
  for (const key of entryNumberKeys) {
    const [label, unit] = entryNumbers[key];
    const values = entries.map((entry) => entry[key]).filter((value) => value !== null);
    if (!values.length) continue;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const average = Math.round(10 * values.reduce((sum, value) => sum + value, 0) / values.length) / 10;
    measurements.push(values.length === 1
      ? `- ${label} ${low}${unit} (1일 기록)`
      : `- ${label} 평균 ${average}${unit} · 범위 ${low}~${high}${unit} (${values.length}일 기록)`);
  }
  if (measurements.length) lines.push("", "입력된 측정값과 상태 점수", ...measurements);
  const repeated = repeatedSymptoms(entries);
  if (repeated.length) lines.push("", `반복 입력된 증상 표현 · ${repeated.join(", ")}`);

  lines.push("", "날짜별 기록");
  for (const entry of entries) {
    lines.push(`- ${entry.date}`);
    const values = entryNumberKeys.flatMap((key) => {
      const [label, unit] = entryNumbers[key];
      return entry[key] === null ? [] : [`${label} ${entry[key]}${unit}`];
    });
    if (values.length) lines.push(`  ${values.join(" · ")}`);
    for (const key of entryTextKeys) {
      if (entry[key].trim()) lines.push(`  ${entryText[key]} · ${compactText(entry[key])}`);
    }
  }

  const questions = [];
  if (entries.some((entry) => entry.symptoms.trim())) {
    questions.push("기록한 증상의 경과를 확인하려면 발생 시각, 지속 시간, 동반 증상 중 무엇을 더 기록하면 좋을까요?");
  }
  if (profile.medications.trim() || entries.some((entry) => entry.medications.trim())) {
    questions.push("실제로 복용한 약과 복용 시각을 함께 살펴보고, 다음 진료까지 무엇을 기록하면 좋을까요?");
  }
  if (entries.some((entry) => entry.meals.trim() || entry.bowel.trim())) {
    questions.push("식사와 배변 기록에서 같이 살펴볼 변화가 있을까요?");
  }
  if (entries.some((entry) => entry.sleepHours !== null || entry.mood !== null || entry.energy !== null || entry.stress !== null)) {
    questions.push("수면과 기분·기력·스트레스 기록 중 우선 살펴볼 변화가 있을까요?");
  }
  if (measurements.length) questions.push("입력된 측정값을 해석하려면 어떤 조건과 시간대에 다시 측정하면 좋을까요?");
  if (questions.length) lines.push("", "진료 때 물어볼 질문", ...questions.map((question) => `- ${question}`));
  return lines.join("\n");
}
