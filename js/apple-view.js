import { icon } from "./icons.js";

const DAY = 86_400_000;
const PAGE_SIZE = 10;
const numbers = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const smallNumbers = new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 3 });
function formatNumber(n) {
  return n !== 0 && Math.abs(n) < 0.01 ? smallNumbers.format(n) : numbers.format(n);
}
const TYPE_PREFIX = /^HK(?:Quantity|Category|Correlation)TypeIdentifier/;
const shortType = type => type.replace(TYPE_PREFIX, "");

const groups = {
  "활동": {
    StepCount: "걸음 수", DistanceWalkingRunning: "걷기·달리기 거리", TimeInDaylight: "햇빛을 받은 시간",
    StairAscentSpeed: "계단 오르기 속도", StairDescentSpeed: "계단 내려가기 속도",
    SixMinuteWalkTestDistance: "6분 걷기 거리", NumberOfTimesFallen: "넘어진 횟수", UVExposure: "자외선 지수",
  },
  "수면·생활": {
    SleepAnalysis: "수면", SleepChanges: "수면 변화", ToothbrushingEvent: "양치",
    HandwashingEvent: "손 씻기", SexualActivity: "성생활", NumberOfAlcoholicBeverages: "음주량",
  },
  "심장·호흡": {
    HeartRate: "심박수", BloodPressure: "혈압 (수축기·이완기)", BloodPressureSystolic: "수축기 혈압",
    BloodPressureDiastolic: "이완기 혈압", VO2Max: "최대 산소 섭취량", ForcedExpiratoryVolume1: "1초간 강제 호기량",
  },
  "신체 측정": {
    BodyMass: "체중", Height: "신장", BodyMassIndex: "체질량지수", BodyFatPercentage: "체지방률",
    WaistCircumference: "허리둘레",
  },
  "영양": {
    DietaryWater: "물", DietaryCaffeine: "카페인", DietaryCarbohydrates: "탄수화물", DietaryProtein: "단백질",
    DietaryFatTotal: "총 지방", DietarySugar: "당류", DietaryZinc: "아연", DietaryNiacin: "나이아신",
    DietaryVitaminB12: "비타민 B12",
  },
  "증상·주기": {
    MoodChanges: "기분 변화", Fatigue: "피로", MemoryLapse: "기억력 저하", HairLoss: "탈모",
    Constipation: "변비", Diarrhea: "설사", Bloating: "복부 팽만", AppetiteChanges: "식욕 변화",
    Nausea: "메스꺼움", RunnyNose: "콧물", MenstrualFlow: "월경량",
  },
};
const catalog = new Map(Object.entries(groups).flatMap(([group, items]) =>
  Object.entries(items).map(([type, label]) => [type, { group, label }])));
const sumTypes = new Set(["StepCount", "DistanceWalkingRunning", "TimeInDaylight", "NumberOfTimesFallen", "NumberOfAlcoholicBeverages"]);
const values = {
  NotApplicable: "기록됨", SeverityNotPresent: "없음", SeverityUnspecified: "정도 미지정", SeverityMild: "경미",
  SeverityModerate: "중간", SeveritySevere: "심함", PresencePresent: "있음", PresenceNotPresent: "없음",
  AppetiteChangesIncreased: "식욕 증가", AppetiteChangesDecreased: "식욕 감소", AppetiteChangesNoChange: "변화 없음",
  AppetiteChangesUnspecified: "변화 미지정", VaginalBleedingNone: "없음", VaginalBleedingUnspecified: "양 미지정",
  VaginalBleedingLight: "적음", VaginalBleedingMedium: "보통", VaginalBleedingHeavy: "많음",
  SleepAnalysisInBed: "침대에 있던 시간", SleepAnalysisAsleepUnspecified: "수면 (단계 미지정)",
  SleepAnalysisAsleep: "수면 (단계 미지정)", SleepAnalysisAsleepCore: "코어 수면",
  SleepAnalysisAsleepDeep: "깊은 수면", SleepAnalysisAsleepREM: "REM 수면", SleepAnalysisAwake: "깨어 있던 시간",
};
const profileNames = {
  DateOfBirth: "생년월일", BiologicalSex: "생물학적 성별", BloodType: "혈액형",
  FitzpatrickSkinType: "피츠패트릭 피부 유형", CardioFitnessMedicationsUse: "심폐 피트니스 관련 약물 사용",
};
const profileValues = {
  HKBiologicalSexFemale: "여성", HKBiologicalSexMale: "남성", HKBiologicalSexOther: "기타",
  HKFitzpatrickSkinTypeI: "I형", HKFitzpatrickSkinTypeII: "II형", HKFitzpatrickSkinTypeIII: "III형",
  HKFitzpatrickSkinTypeIV: "IV형", HKFitzpatrickSkinTypeV: "V형", HKFitzpatrickSkinTypeVI: "VI형",
  HKCardioFitnessMedicationsUseNone: "사용하지 않음", HKCardioFitnessMedicationsUseUnknown: "알 수 없음",
};
const metadataNames = {
  HKWasUserEntered: "사용자 직접 입력", HKSexualActivityProtectionUsed: "보호 수단 사용", HKMenstrualCycleStart: "월경 주기 시작",
};
function valueLabel(value) {
  return values[value.replace(/^HKCategoryValue/, "")] ?? value;
}
function profileValue(value) {
  if (/NotSet$/.test(value) || !value) return "미설정";
  if (value.startsWith("HKBloodType")) return value.slice(11).replace("Positive", "+").replace("Negative", "−");
  return profileValues[value] ?? value;
}
function unitName(unit, type) {
  if (type === "BodyMassIndex" && unit === "count") return "";
  if (unit === "count") return ({ StepCount: "걸음", NumberOfAlcoholicBeverages: "잔", UVExposure: "", NumberOfTimesFallen: "회" })[type] ?? "회";
  return ({ "count/min": "회/분", min: "분", hr: "시간", mcg: "μg" })[unit] ?? unit;
}
function node(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) el.setAttribute(key, val);
  el.append(...children.flat().filter(child => child !== null && child !== undefined));
  return el;
}
function svgNode(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  if (text !== undefined) el.textContent = text;
  return el;
}
function action(text, onClick, attrs = {}) {
  const el = node("button", { type: "button", ...attrs }, text);
  el.addEventListener("click", onClick);
  return el;
}
function selector(label, choices, selected, onChange, id) {
  const el = node("select", { id }, choices.map(([value, text]) => node("option", { value }, text)));
  el.value = selected;
  el.addEventListener("change", () => onChange(el.value));
  return node("label", { class: "ah-select" }, node("span", {}, label), el);
}
function stamp(raw) {
  return raw ? raw.slice(0, 16).replace("T", " ") : "미기록";
}
function prettyDay(iso) {
  return iso.slice(0, 10).split("-").map((part, i) => i ? Number(part) : part).join(".");
}
function isoDay(time) { return new Date(time).toISOString().slice(0, 10); }
function dayTime(raw) { return Date.parse(raw.slice(0, 10) + "T00:00:00Z"); }
function instant(raw) {
  return Date.parse(raw.replace(" ", "T").replace(/\s*([+-])(\d\d)(\d\d)$/, "$1$2:$3"));
}
function duration(hours) {
  const min = Math.round(hours * 60);
  return min >= 60 ? Math.floor(min / 60) + "시간 " + (min % 60) + "분" : min + "분";
}
function humanValue(record, type) {
  if (type === "SleepAnalysis") {
    const hours = (instant(record.end) - instant(record.start)) / 3_600_000;
    return valueLabel(record.value) + (Number.isFinite(hours) ? " · " + duration(hours) : "");
  }
  if (record.members) return record.members.map(m => {
    const typeName = shortType(m.type);
    return (catalog.get(typeName)?.label ?? typeName) + " " + humanValue(m, typeName);
  }).join(" · ");
  if (!record.unit && !Number.isFinite(Number(record.value))) return valueLabel(record.value);
  const unit = unitName(record.unit, type);
  return valueLabel(record.value) + (unit ? " " + unit : "");
}

function indexData(apple) {
  const types = new Map();
  const dates = new Set();
  for (const row of [...apple.records, ...apple.correlations]) {
    const type = shortType(row.type);
    const id = JSON.stringify([row.type, row.unit ?? ""]);
    if (!types.has(id)) {
      const { label, group } = catalog.get(type) ?? { label: type, group: "기타" };
      const mode = row.members
        ? type === "BloodPressure" ? "pressure" : "category"
        : type === "SleepAnalysis" ? "sleep"
        : row.type.startsWith("HKCategory") || !Number.isFinite(Number(row.value)) ? "category"
        : type.startsWith("Dietary") || sumTypes.has(type) ? "sum" : "average";
      types.set(id, { id, label, group, mode, type, unit: row.unit ?? "", rows: [] });
    }
    types.get(id).rows.push(row);
    dates.add(row.start.slice(0, 10));
  }
  for (const series of types.values()) series.rows.sort((a, b) => a.start.localeCompare(b.start));
  return { series: [...types.values()].sort((a, b) => a.label.localeCompare(b.label, "ko")), dates: [...dates].sort() };
}

// Select a bin width that keeps the whole time range legible. Calendar boundaries use the date in the export.
function timeline(start, end) {
  const span = (end - start) / DAY + 1;
  let grain, floor, advance;
  if (span <= 35) {
    grain = "일"; floor = start; advance = t => t + DAY;
  } else if (span <= 158) {
    grain = "주"; floor = start - (new Date(start).getUTCDay() + 6) % 7 * DAY; advance = t => t + 7 * DAY;
  } else if (span <= 365 * 5) {
    const d = new Date(start);
    grain = "월"; floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    advance = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
  } else {
    const width = Math.max(1, Math.ceil(span / (365 * 40)));
    grain = width === 1 ? "연" : width + "년";
    floor = Date.UTC(new Date(start).getUTCFullYear(), 0, 1);
    advance = t => Date.UTC(new Date(t).getUTCFullYear() + width, 0, 1);
  }
  const buckets = [];
  for (let time = floor; time <= end;) {
    const next = advance(time);
    const first = isoDay(Math.max(time, start)), last = isoDay(Math.min(next - DAY, end));
    const label = first === last ? prettyDay(first) : prettyDay(first) + " – " + prettyDay(last);
    buckets.push({ next, first, last, label, rows: [], amounts: [] });
    time = next;
  }
  return { grain, buckets };
}
const asleep = /^HKCategoryValueSleepAnalysisAsleep/;
function unionHours(rows) {
  const ranges = rows.map(row => [instant(row.start), instant(row.end)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((a, b) => a[0] - b[0]);
  let previousEnd = -Infinity, total = 0;
  for (const [a, b] of ranges) {
    total += Math.max(0, b - Math.max(a, previousEnd));
    previousEnd = Math.max(previousEnd, b);
  }
  return total / 3_600_000;
}

function aggregate(series, range, stage) {
  const end = dayTime(series.rows.at(-1).start);
  const start = range === 0 ? dayTime(series.rows[0].start) : end - (range - 1) * DAY;
  const rangeRows = series.rows.filter(row => dayTime(row.start) >= start);
  const rows = series.mode === "sleep"
    ? rangeRows.filter(r => stage === "asleep" ? asleep.test(r.value) : r.value === stage)
    : rangeRows;
  const { buckets, grain } = timeline(start, end);
  const category = series.mode === "category";
  const labels = category ? [...new Set(rows.map(r => valueLabel(r.value || "기록됨")))].sort() :
    series.mode === "pressure" ? ["수축기", "이완기"] : [series.label];
  let index = 0;
  for (const row of rows) {
    const t = dayTime(row.start);
    while (index < buckets.length - 1 && t >= buckets[index].next) index++;
    buckets[index].rows.push(row);
  }
  for (const bucket of buckets) {
    if (!bucket.rows.length) continue;
    if (category) {
      const counts = new Map();
      for (const r of bucket.rows) {
        const key = valueLabel(r.value || "기록됨");
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      bucket.amounts = labels.map(key => counts.get(key) || 0);
    } else if (series.mode === "pressure") {
      bucket.amounts = ["BloodPressureSystolic", "BloodPressureDiastolic"].map(type => {
        const numbers = bucket.rows.flatMap(r => r.members.filter(m => shortType(m.type) === type && m.unit === "mmHg").map(m => Number(m.value))).filter(Number.isFinite);
        return numbers.length ? numbers.reduce((s, n) => s + n, 0) / numbers.length : null;
      });
    } else if (series.mode === "sleep") {
      bucket.amounts = [unionHours(bucket.rows)];
    } else {
      const total = bucket.rows.reduce((sum, r) => sum + Number(r.value), 0);
      bucket.amounts = [series.mode === "average" ? total / bucket.rows.length : total];
    }
  }
  const unit = category ? "건" : series.mode === "sleep" ? "시간" : series.mode === "pressure" ? "mmHg" : unitName(series.unit, series.type);
  const method = category ? "기록 건수" : ["pressure", "average"].includes(series.mode) ? "측정값 평균" : "기록 합계";
  return { rows, buckets, labels, unit, method, grain, category, start, end };
}

function chartStats(data, index) {
  const bucket = data.buckets[index];
  if (!bucket.rows.length) return "기록 없음";
  return bucket.amounts.flatMap((n, i) => {
    if (n === null || (data.category && n === 0)) return [];
    const name = data.labels.length > 1 || data.category ? data.labels[i] + " " : "";
    return [name + formatNumber(n) + (data.unit ? " " + data.unit : "")];
  }).join(" · ") || "해당 단위의 측정값 없음";
}
function chartPlot(data, series) {
  const { buckets, labels, category, unit } = data;
  const isLine = ["average", "pressure"].includes(series.mode);
  const width = 640, height = 180, pad = 7, bottom = height - pad;
  const heights = buckets.flatMap(bucket => category && bucket.rows.length
    ? [bucket.amounts.reduce((s, n) => s + n, 0)] : bucket.amounts.filter(n => n !== null));
  const observedMin = heights.length ? Math.min(...heights) : 0;
  const observedMax = heights.length ? Math.max(...heights) : 0;
  const padding = isLine ? (observedMax - observedMin || Math.abs(observedMin) || 1) * 0.1 : 0;
  const low = isLine ? Math.max(observedMin >= 0 ? 0 : -Infinity, observedMin - padding) : Math.min(observedMin, 0);
  const high = isLine ? observedMax + padding : Math.max(observedMax, 0);
  const targetStep = (high - low || 1) / 3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetStep)));
  let step = [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= targetStep) ?? 10 * magnitude;
  if (category) step = Math.max(1, Math.ceil(step));
  const floor = Math.floor(low / step) * step, ceiling = Math.max(floor + step, Math.ceil(high / step) * step);
  const y = n => bottom - (n - floor) / (ceiling - floor) * (height - 2 * pad);
  const gap = width / buckets.length, x = i => (i + 0.5) * gap, bar = Math.min(gap * 0.7, 36);
  const svg = svgNode("svg", { viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "none", "aria-hidden": "true" });
  for (let v = floor; v <= ceiling + step * 0.001; v += step) {
    svg.append(svgNode("line", { x1: 0, x2: width, y1: y(v), y2: y(v), class: "ah-gridline" }));
  }
  const cursor = svgNode("rect", { x: 0, y: 0, width: Math.min(48, gap), height, class: "ah-cursor" });
  svg.append(cursor);
  if (isLine) {
    labels.forEach((_, k) => {
      const points = [];
      let previous = false;
      buckets.forEach((b, i) => {
        const n = b.amounts[k];
        if (n == null) { previous = false; return; }
        points.push((previous ? "L" : "M") + x(i) + " " + y(n));
        previous = true;
      });
      svg.append(svgNode("path", { d: points.join(" "), class: "ah-line ah-tone-" + k }));
      buckets.forEach((b, i) => {
        const n = b.amounts[k];
        if (n != null) svg.append(svgNode("circle", { cx: x(i), cy: y(n), r: 3.3, class: "ah-point ah-tone-" + k }));
      });
    });
  } else {
    buckets.forEach((b, i) => {
      let sum = 0;
      b.amounts.forEach((n, k) => {
        if (n === 0 && category) return;
        const top = Math.min(y(sum + n), y(sum)), h = Math.max(2, Math.abs(y(sum) - y(sum + n)));
        svg.append(svgNode("rect", { x: x(i) - bar / 2, y: Math.min(bottom - 1, top), width: bar, height: h,
          rx: Math.min(2, bar / 4), class: "ah-bar ah-tone-" + (k % 8) }));
        sum += n;
      });
    });
  }

  const ticks = node("div", { class: "ah-yaxis", "aria-hidden": "true" });
  for (let v = ceiling; v >= floor - step * .001; v -= step) ticks.append(node("span", {}, formatNumber(v)));
  const plot = node("div", { class: "ah-plot", tabindex: 0, role: "slider", "aria-label": "차트 구간 탐색",
    "aria-valuemin": 1, "aria-valuemax": buckets.length }, svg);
  const readout = node("output", { class: "ah-readout", "aria-live": "off" });
  let selection = buckets.findLastIndex ? buckets.findLastIndex(b => b.rows.length) : buckets.map(b => b.rows.length > 0).lastIndexOf(true);
  function show(index) {
    selection = Math.max(0, Math.min(buckets.length - 1, index));
    const bucket = buckets[selection], val = chartStats(data, selection);
    cursor.setAttribute("x", x(selection) - Math.min(48, gap) / 2);
    plot.setAttribute("aria-valuenow", selection + 1);
    plot.setAttribute("aria-valuetext", bucket.label + ", " + val);
    readout.replaceChildren(node("strong", {}, bucket.label), node("span", {}, val));
  }
  function point(event) {
    const rect = plot.getBoundingClientRect();
    show(Math.floor((event.clientX - rect.left) / rect.width * buckets.length));
  }
  plot.addEventListener("pointermove", event => { if (event.pointerType === "mouse") point(event); });
  plot.addEventListener("click", point);
  plot.addEventListener("keydown", event => {
    const target = { ArrowLeft: selection - 1, ArrowRight: selection + 1, Home: 0, End: buckets.length - 1 }[event.key];
    if (target !== undefined) { event.preventDefault(); show(target); }
  });
  show(Math.max(0, selection));
  const axisLabel = iso => prettyDay(iso);
  const tickDates = buckets.length === 1 ? [buckets[0].first]
    : buckets.length > 5 ? [buckets[0].first, buckets[Math.floor(buckets.length / 2)].first, buckets.at(-1).last]
    : [buckets[0].first, buckets.at(-1).last];
  const legend = labels.length > 1 || category ? node("div", { class: "ah-legend" }, labels.map((label, i) =>
    node("span", {}, node("i", { class: "ah-swatch ah-tone-" + i % 8, "aria-hidden": "true" }), label))) : null;
  const graph = node("figure", { class: "ah-figure" },
    node("figcaption", {}, node("strong", {}, data.grain + "별 " + data.method), node("span", {}, unit ? "단위 " + unit : "단위 없음")),
    legend, node("div", { class: "ah-grid" }, ticks, plot, node("div", { class: "ah-xaxis", "aria-hidden": "true" }, tickDates.map(d => node("span", {}, axisLabel(d))))),
    readout);
  return graph;
}
function alternateTable(data) {
  const detail = node("details", { class: "ah-disclosure" }, node("summary", {}, "차트 수치 표로 보기"));
  detail.addEventListener("toggle", () => {
    if (!detail.open || detail.querySelector("table")) return;
    detail.append(node("div", { class: "ah-table-wrap" }, node("table", { class: "ah-data-table" },
      node("caption", { class: "ah-sr" }, "표시된 기간별 차트 값"),
      node("thead", {}, node("tr", {}, ["구간", "기록 수", data.method].map(t => node("th", { scope: "col" }, t)))),
      node("tbody", {}, data.buckets.map((b, i) => node("tr", {},
        node("th", { scope: "row" }, b.label), node("td", {}, formatNumber(b.rows.length)), node("td", {}, chartStats(data, i))))))));
  });
  return detail;
}
function properties(entries) {
  return node("dl", { class: "ah-properties" }, entries.filter(([, value]) => value !== undefined && value !== "").map(([key, value]) =>
    node("div", {}, node("dt", {}, key), node("dd", {}, value))));
}
function rawDetails(row, type) {
  const meta = Object.entries(row.metadata || {}).map(([k, v]) => {
    const val = metadataNames[k] ? ({ "0": "아니요", "1": "예", No: "아니요", Yes: "예" })[v] ?? v : v;
    return [metadataNames[k] || k, val];
  });
  const detail = node("details", { class: "ah-record" }, node("summary", {},
    node("span", { class: "ah-record-date" }, stamp(row.start)), node("strong", {}, humanValue(row, type))));
  detail.addEventListener("toggle", () => {
    if (!detail.open || detail.querySelector("dl")) return;
    detail.append(properties([["시작", row.start], ["종료", row.end], ["생성", row.created],
      ["출처", row.source], ["출처 버전", row.sourceVersion], ["기기", row.device], ...meta]));
    if (row.members) detail.append(node("div", { class: "ah-members" }, row.members.map(member =>
      node("div", {}, node("strong", {}, catalog.get(shortType(member.type))?.label ?? shortType(member.type)),
        rawDetails(member, shortType(member.type))))));
  });
  return detail;
}
function recordsList(data, type) {
  const rows = data.rows.slice().reverse();
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const section = node("section", { class: "ah-records", "aria-label": "원본 기록 목록" });
  const list = node("div", {});
  const state = node("span", { "aria-live": "polite" });
  let page = 0;
  function update() {
    list.replaceChildren(...rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => rawDetails(r, type)));
    back.disabled = page === 0;
    next.disabled = page >= pages - 1;
    state.textContent = (page + 1) + " / " + pages + "쪽";
  }
  const back = action("이전", () => { page--; update(); });
  const next = action("다음", () => { page++; update(); });
  const heading = node("div", { class: "ah-section-heading" }, node("h3", {}, "원본 기록"), node("span", {}, formatNumber(rows.length) + "건"));
  section.append(heading, list);
  if (pages > 1) section.append(node("nav", { class: "ah-pager", "aria-label": "원본 기록 페이지" }, back, state, next));
  if (rows.length) update();
  return section;
}
function sourceDetails(apple) {
  const props = Object.entries(apple.profile).map(([key, val]) => [profileNames[key.replace("HKCharacteristicTypeIdentifier", "")] ?? key, profileValue(val)]);
  if (apple.exportedAt) props.push(["내보낸 시각", stamp(apple.exportedAt)]);
  return props.length ? node("details", { class: "ah-disclosure ah-profile" }, node("summary", {}, "Apple 건강 프로필 · 내보내기 정보"), properties(props)) : null;
}

const groupPreviews = [
  ["활동", "StepCount", "activity"],
  ["수면·생활", "SleepAnalysis", "moon"],
  ["심장·호흡", "HeartRate", "heart-pulse"],
  ["신체 측정", "BodyMass", "scale"],
  ["영양", "DietaryWater", "clipboard-list"],
  ["증상·주기", "MoodChanges", "user-round"],
  ["기타", "", "activity"],
];
function stageChoices(series) {
  const stages = [...new Set(series.rows.map(r => r.value))].sort();
  const choices = stages.map(k => [k, valueLabel(k)]);
  if (stages.some(s => asleep.test(s))) choices.unshift(["asleep", "전체 수면 단계"]);
  return choices;
}
// Cards share the chart's aggregation rules. Only measured days are sampled in the miniature chart.
function makePreview(series) {
  const stage = series.mode === "sleep" ? stageChoices(series)[0][0] : "";
  const source = series.mode === "sleep"
    ? series.rows.filter(r => stage === "asleep" ? asleep.test(r.value) : r.value === stage) : series.rows;
  const recent = new Map();
  for (let i = source.length - 1; i >= 0; i--) {
    const row = source[i], day = row.start.slice(0, 10);
    if (!recent.has(day)) {
      if (recent.size === 7) break;
      recent.set(day, []);
    }
    recent.get(day).push(row);
  }
  const points = [...recent].reverse().map(([day, records]) => {
    const data = aggregate({ ...series, rows: records }, 1, stage);
    const amounts = data.buckets[0].amounts;
    return { day, amount: data.category ? data.rows.length : amounts[0], amounts, unit: data.unit };
  });
  const last = points.at(-1);
  const numeric = last.amount == null ? "미기록" : formatNumber(last.amount);
  const amount = series.mode === "pressure"
    ? last.amounts.map(n => n == null ? "–" : formatNumber(n)).join(" / ") : numeric;
  const text = series.mode === "sleep" ? duration(last.amount) : amount;
  const unit = series.mode === "sleep" ? "" : last.unit;
  const method = series.mode === "category" ? "기록 수" : ["average", "pressure"].includes(series.mode) ? "평균" : "합계";
  const label = series.mode === "sleep" && stage !== "asleep" ? valueLabel(stage) : series.label;
  return { points, last, text, unit, method, label };
}
function sparkline(points) {
  const width = 102, height = 28;
  const svg = svgNode("svg", { viewBox: "0 0 102 28", class: "ah-spark", "aria-hidden": "true", preserveAspectRatio: "none" });
  const vals = points.map(p => p.amount).filter(n => n != null);
  const low = Math.min(0, ...vals), high = Math.max(0, ...vals);
  const y = value => height - 2 - (value - low) / (high - low || 1) * (height - 4);
  const spacing = width / 7;
  points.forEach((p, i) => {
    if (p.amount == null) return;
    svg.append(svgNode("rect", { x: i * spacing + 1, y: Math.min(y(0), y(p.amount)), width: spacing - 4,
      height: Math.max(1.5, Math.abs(y(0) - y(p.amount))), rx: 1.5, class: i === points.length - 1 ? "ah-newest" : "" }));
  });
  return svg;
}

export function renderAppleHealth(apple, importControl) {
  const root = node("section", { class: "ah-dashboard", "aria-label": "Apple 건강 데이터" });
  const index = apple ? indexData(apple) : { dates: [], series: [] };
  const { dates, series } = index;
  const hasData = series.length > 0;
  const stat = (label, value, suffix) => node("div", {}, node("dt", {}, label),
    node("dd", {}, formatNumber(value), node("small", {}, suffix)));
  const header = node("section", { class: "ah-head" }, node("div", { class: "ah-title-row" },
    node("div", {}, node("h2", {}, icon("heart-pulse", 23), "Apple 건강 기록"),
      node("p", {}, hasData ? prettyDay(dates[0]) + " – " + prettyDay(dates.at(-1))
        : "iPad 건강 앱에서 내보낸 ZIP 또는 XML 파일을 선택하세요.")), importControl),
    hasData ? node("dl", { class: "ah-stats" }, stat("측정 기록", apple.records.length, "건"),
      stat("측정 항목", new Set(apple.records.map(r => r.type)).size, "종"), stat("기록한 날", dates.length, "일")) : null);
  root.append(header);
  if (apple && !hasData) root.append(node("p", { class: "ah-status" }, "이 파일에 표시할 측정 기록이 없습니다."));
  if (!hasData) {
    if (apple) { const profile = sourceDetails(apple); if (profile) root.append(profile); }
    return root;
  }

  let active = series.find(s => s.type === "StepCount") ?? series[0];
  let group = "전체";
  let range = 0;
  let stage = "";
  const explorer = node("section", { class: "ah-explorer", id: "ah-explorer", "aria-label": "항목별 추세" });
  const previewButtons = [];
  const overview = node("section", { class: "ah-preview-grid", "aria-label": "분류별 최근 기록일 요약" });
  groupPreviews.forEach(([name, preferred, iconName], color) => {
    const sample = series.find(s => s.type === preferred) ?? series.find(s => s.group === name);
    if (!sample) return;
    const { points, last, text, unit, method, label } = makePreview(sample);
    const select = action("", () => {
      active = sample; group = name; range = 0; stage = "";
      refresh();
      explorer.scrollIntoView({ block: "start" });
      explorer.querySelector("h3")?.focus({ preventScroll: true });
    }, { class: "ah-preview ah-card-tone-" + color, "aria-controls": "ah-explorer", "aria-pressed": false });
    select.append(node("span", { class: "ah-preview-group" }, icon(iconName, 17), name),
      node("span", { class: "ah-preview-label" }, label + " · " + method),
      node("strong", { class: "ah-preview-number" }, text, unit ? node("small", {}, unit) : null),
      node("span", { class: "ah-preview-foot" }, node("time", { datetime: last.day }, prettyDay(last.day)), sparkline(points)));
    select.title = label + " 상세 보기 · 미니 차트는 최근 기록일 최대 7개의 일별 " + method;
    overview.append(select);
    previewButtons.push([sample, select]);
  });
  root.append(overview, explorer);
  const profile = sourceDetails(apple);
  if (profile) root.append(profile);
  function refresh(focusId) {
    for (const [sample, button] of previewButtons) button.setAttribute("aria-pressed", sample === active);
    const visible = series.filter(s => group === "전체" || s.group === group);
    const categories = [...new Set(series.map(s => s.group))];
    const wantedOrder = [...Object.keys(groups), "기타"].filter(g => categories.includes(g));
    const groupSelect = selector("분류", ["전체", ...wantedOrder].map(s => [s, s]), group, value => {
      group = value;
      if (group !== "전체" && active.group !== group) active = series.find(s => s.group === group);
      stage = ""; refresh("ah-group");
    }, "ah-group");
    const overlaps = new Set(visible.filter((item, i) => visible.some((other, j) => j !== i && other.label === item.label)).map(item => item.label));
    const measureSelect = selector("측정 항목", visible.map(s => [s.id, overlaps.has(s.label) ? s.label + " (" + s.unit + ")" : s.label]), active.id, value => {
      active = series.find(s => s.id === value); stage = ""; refresh("ah-measure");
    }, "ah-measure");
    const periods = node("div", { class: "ah-periods", role: "group", "aria-label": "선택 항목의 마지막 기록일 기준 조회 기간" },
      [7, 30, 90, 0].map(n => action(n ? n + "일" : "전체", () => { range = n; refresh("ah-range-" + n); },
        { id: "ah-range-" + n, "aria-pressed": n === range })));
    let stageSelect = null;
    if (active.mode === "sleep") {
      const choices = stageChoices(active);
      if (!choices.some(([key]) => key === stage)) stage = choices[0][0];
      stageSelect = selector("수면 단계", choices, stage, value => { stage = value; refresh("ah-stage"); }, "ah-stage");
    }
    const data = aggregate(active, range, stage);
    const title = node("div", { class: "ah-chart-title" }, node("div", {}, node("h3", { tabindex: "-1" }, active.label),
      node("p", {}, prettyDay(isoDay(data.start)) + " – " + prettyDay(isoDay(data.end)))), periods);
    const text = active.mode === "sleep" ? "시작일 기준으로 묶고, 같은 구간에 겹친 시간은 한 번만 더합니다."
      : active.mode === "sum" && active.type === "StepCount" ? "내보낸 걸음 기록을 더한 값입니다. 기기별 측정 시간이 겹치면 중복이 포함될 수 있어요."
      : null;
    explorer.replaceChildren(node("div", { class: "ah-controls" }, groupSelect, measureSelect, ...(stageSelect ? [stageSelect] : [])),
      title, ...(data.rows.length ? [chartPlot(data, active), ...(text ? [node("p", { class: "ah-note" }, text)] : []),
        alternateTable(data), recordsList(data, active.type)] : [node("p", { class: "ah-status" }, "이 기간에 선택한 항목의 기록이 없습니다.")]));
    if (focusId) explorer.querySelector("#" + focusId)?.focus({ preventScroll: true });
  }
  refresh();
  return root;
}
