import { test } from "node:test";
import assert from "node:assert/strict";
import { displayAddress, quickJoinServers, serverDisplayName } from "../../src/components/ads/widgets/server-list.ts";

const server = (name: string | null, address: string | null) => ({
  name,
  address,
  icon_base64: null,
  accepts_textures: null,
  previews_chat: null,
});

test("hides NoRisk host entries and servers without an address", () => {
  const list = quickJoinServers([
    server("NoRisk Host", "advert.norisk.space"),
    server("Host", "play.norisk.host:25565"),
    server("Empty", null),
    server("Gomme", "gommehd.net"),
  ]);
  assert.deepEqual(list.map((s) => s.address), ["gommehd.net"]);
});

test("keeps domains that only contain norisk", () => {
  const list = quickJoinServers([server("Fan", "norisk.space.example.com")]);
  assert.equal(list.length, 1);
});

test("limits the list", () => {
  const list = quickJoinServers(Array.from({ length: 10 }, (_, i) => server(`S${i}`, `s${i}.net`)), 6);
  assert.equal(list.length, 6);
});

test("masks raw IP addresses but not domains", () => {
  assert.equal(displayAddress("192.168.0.10"), "***.***.***.***");
  assert.equal(displayAddress("192.168.0.10:25565"), "***.***.***.***");
  assert.equal(displayAddress("[2001:db8::1]:25565"), "***.***.***.***");
  assert.equal(displayAddress("gommehd.net"), "gommehd.net");
  assert.equal(displayAddress("mc.example.com:25565"), "mc.example.com:25565");
});

test("uses the saved name unless it is the vanilla default", () => {
  assert.equal(serverDisplayName(server("§fNoRisk§bHost", "a.net")), "§fNoRisk§bHost");
  assert.equal(serverDisplayName(server("Minecraft Server", "gommehd.net")), "gommehd.net");
  assert.equal(serverDisplayName(server("  ", "10.0.0.1")), "***.***.***.***");
  assert.equal(serverDisplayName(server(null, "greev.eu")), "greev.eu");
});
