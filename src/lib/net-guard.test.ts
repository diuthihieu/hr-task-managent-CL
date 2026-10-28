import { test } from "node:test";
import assert from "node:assert/strict";
import { privateAddress, guardedLookup, getPublicHttps } from "./net-guard";

// One address inside each blocked range, IPv4 also as IPv4-mapped IPv6 (dotted and hex).
const V4 = ["0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255"];
const hex = (ip: string) => {
  const [a, b, c, d] = ip.split(".").map(Number);
  return `::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
};
const V6 = ["::", "::1", "0::1", "::0:1", "0:0:0:0:0:ffff:7f00:1", "::a9fe:a9fe", "::ffff:0:a9fe:a9fe", "fc00::1", "fdff::1", "fe80::1", "fe90::1", "febf::1", "fec0::1", "ff02::1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a9fe:a9fe", "2002:a9fe:a9fe::1"];
const PUBLIC = ["8.8.8.8", "1.1.1.1", "100.128.0.1", "172.32.0.1", "198.20.0.1", "::ffff:8.8.8.8", "::ffff:808:808", "2606:4700:4700::1111", "2001:4860:4860::8888"];

test("private, local and special-purpose addresses are blocked in every spelling", () => {
  const missed = [...V4, ...V4.map((ip) => `::ffff:${ip}`), ...V4.map(hex), ...V6].filter((ip) => !privateAddress(ip));
  assert.deepEqual(missed, []);
  assert.deepEqual(PUBLIC.filter((ip) => privateAddress(ip)), [], "public addresses stay allowed");
  assert.equal(privateAddress("not-an-ip"), true, "anything that isn't an IP is refused");
});

test("the connect-time lookup refuses a name that resolves to a private address (single or all: true)", async () => {
  const fake = (answer: string[]) => async () => answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const call = (answer: string[], all: boolean) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) => guardedLookup(fake(answer))("api.example.com", { all }, (err, result) => resolve({ err, result })));
  for (const all of [false, true]) {
    assert.match((await call(["10.0.0.5"], all)).err?.message ?? "", /private or local/, `all=${all}`);
    assert.match((await call(["93.184.216.34", "::ffff:169.254.169.254"], all)).err?.message ?? "", /private or local/, `one bad answer is enough (all=${all})`);
    const ok = await call(["93.184.216.34"], all);
    assert.equal(ok.err, null);
    assert.deepEqual(ok.result, all ? [{ address: "93.184.216.34", family: 4 }] : "93.184.216.34");
  }
});

test("the real request checks the address when it connects (a name resolving to loopback never connects)", async () => {
  await assert.rejects(getPublicHttps(new URL("https://localhost:9/"), { maxBytes: 1024, timeoutMs: 5000 }), (e: { code?: string }) => e.code === "EPRIVATE");
});
