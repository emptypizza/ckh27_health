import { assert, test } from "./harness.js";
import { parseAppleHealthXML, readAppleHealth } from "../js/apple-import.js";
import { mergeAppleHealth } from "../js/apple-model.js";

const when = "2024-02-29 08:03:02 +0900";
const attrs = `sourceName="테스트 기기" startDate="${when}" endDate="${when}"`;
const type = "HKQuantityTypeIdentifierHeartRate";
const record = `<Record type="${type}" ${attrs} unit="count/min" value="66"><MetadataEntry key="HKWasUserEntered" value="1"/></Record>`;
const correlation = `<Correlation type="HKCorrelationTypeIdentifierBloodPressure" ${attrs}>${record}</Correlation>`;

test("Apple XML은 중복 표기된 연관 측정과 실제 반복 관측을 구분한다", () => {
  const data = parseAppleHealthXML(`<HealthData><ExportDate value="${when}"/><Me HKCharacteristicTypeIdentifierBloodType="HKBloodTypeNotSet"/>${record}${record}${correlation}</HealthData>`);
  assert.equal(data.records.length, 2);
  assert.equal(data.correlations.length, 1);
  assert.equal(data.exportedAt, when);
  assert.equal(data.profile.HKCharacteristicTypeIdentifierBloodType, "HKBloodTypeNotSet");
  assert.equal(data.correlations[0].members[0].value, "66");
  assert.equal(data.records[0].metadata.HKWasUserEntered, "1");
  const nested = parseAppleHealthXML(`<HealthData>${correlation}</HealthData>`);
  assert.equal(nested.records[0].source, "테스트 기기");
});

test("Apple CDA는 날짜 오프셋과 뒤쪽 관찰 섹션도 보존하고 상세 XML과 합쳐진다", () => {
  const observation = `<observation><text><sourceName>테스트 기기</sourceName><type>${type}</type><unit>count/min</unit><value>66</value></text>
    <effectiveTime><low value="20240229080302+0900"/><high value="20240229080302+0900"/></effectiveTime></observation>`;
  const cda = parseAppleHealthXML(`<ClinicalDocument xmlns="urn:hl7-org:v3"><effectiveTime value="20240229080302+0900"/>
    <component>${observation}</component></ClinicalDocument><component>${observation}</component>`);
  assert.equal(cda.records.length, 2);
  assert.equal(cda.records[0].start, when);
  const primary = parseAppleHealthXML(`<HealthData>${record}${record}</HealthData>`);
  assert.equal(mergeAppleHealth(cda, primary).records.length, 2);
  assert.equal(mergeAppleHealth(primary, cda).records.length, 2);
});

test("손상된 파일이나 다른 종류의 XML을 건강 기록으로 가져오지 않는다", async () => {
  assert.throws(() => parseAppleHealthXML("<HealthData><Record></HealthData>"), /XML/);
  assert.throws(() => parseAppleHealthXML("<example/>"), /XML/);
  assert.throws(() => parseAppleHealthXML("<!DOCTYPE x [<!ENTITY msg 'test'>]><HealthData/>"), /XML/);
  await assert.rejects(readAppleHealth(new File(["PKinvalid"], "sample.zip")), /ZIP/);
});

test("ZIP 데이터 설명자와 한글 파일명의 압축 XML을 읽고 손상된 내용은 거절한다", async () => {
  // Synthetic deflated HealthData with one unfilled profile field and no observations.
  const encoded = "UEsDBBQACAgIAAAAIVgAAAAAAAAAAAAAAAAkAAAAYXBwbGVfaGVhbHRoX2V4cG9ydC/rgrTrs7TrgrTquLAueG1ss/FITcwpyXBJLEm0s/FNVfDwds5ILEpMLkktyiwuyUwOqSxI9UxJzSvJTMtMLXLKyc9PAQnZKnl4wzl++SXBqSVK+nY2+kimAQBQSwcIpu00I0oAAABaAAAAUEsBAhQDFAAICAgAAAAhWKbtNCNKAAAAWgAAACQAAAAAAAAAAAAAAIABAAAAAGFwcGxlX2hlYWx0aF9leHBvcnQv64K067O064K06riwLnhtbFBLBQYAAAAAAQABAFIAAACcAAAAAAA=";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const data = await readAppleHealth(new File([bytes], "내보내기.zip"));
  assert.equal(data.profile.HKCharacteristicTypeIdentifierBloodType, "HKBloodTypeNotSet");
  const view = new DataView(bytes.buffer);
  const directoryOffset = view.getUint32(bytes.length - 6, true);
  bytes[directoryOffset + 16] ^= 1;
  await assert.rejects(readAppleHealth(new File([bytes], "내보내기.zip")), /ZIP/);
});
