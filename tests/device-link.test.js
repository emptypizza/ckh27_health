import { assert, test } from "./harness.js";
import { createDeviceLink, openDeviceLink } from "../js/device-link.js";

test("개인 링크는 여섯 자리 PIN으로만 열리고 변조된 암호문을 거부한다", async () => {
  const passphrase = "고정된 테스트용 열람 암호";
  const token = await createDeviceLink(passphrase, "000015");
  assert.notEqual(token, await createDeviceLink(passphrase, "000015"));
  assert.equal(await openDeviceLink(token, "000015"), passphrase);
  await assert.rejects(openDeviceLink(token, "000016"));
  const tampered = token.slice(0, -4) + (token.at(-4) === "a" ? "b" : "a") + token.slice(-3);
  await assert.rejects(openDeviceLink(tampered, "000015"));
  await assert.rejects(openDeviceLink(token, "15"), /여섯 자리/);
  await assert.rejects(openDeviceLink("broken", "000015"), /링크/);
});
