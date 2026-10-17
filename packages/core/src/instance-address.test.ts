import { describe, expect, it } from "vitest";
import {
  desktopInstanceLink,
  parseDesktopInstanceLink,
  parseInstanceAddress,
} from "./instance-address";

describe("Desktop invitation links", () => {
  it.each([
    "https://ops.example.test",
    "https://ops.example.test/accept-invite/inv_abc-123",
    "https://ops.example.test/api/proxy/accept-invite/inv_abc-123",
    "http://127.0.0.1:4100/accept-invite/inv_abc-123",
  ])("round-trips the reviewed instance address: %s", (address) => {
    const link = desktopInstanceLink(address);
    expect(parseDesktopInstanceLink(link)).toBe(address);
    expect(parseInstanceAddress(parseDesktopInstanceLink(link)!)).toEqual(
      parseInstanceAddress(address),
    );
    expect([...new URL(link).searchParams.keys()]).toEqual(["url"]);
  });

  it.each([
    "https://connect?url=https://ops.example.test",
    "kovalio://other?url=https://ops.example.test",
    "kovalio://connect/path?url=https://ops.example.test",
    "kovalio://user:pass@connect?url=https://ops.example.test",
    "kovalio://connect:444?url=https://ops.example.test",
    "kovalio://connect?url=https://ops.example.test#secret",
    "kovalio://connect?url=https://ops.example.test&role=admin",
    "kovalio://connect?url=https://ops.example.test&token=secret",
    "kovalio://connect?url=https://ops.example.test&url=https://other.test",
    "kovalio://connect?url=javascript:alert(1)",
    "kovalio://connect?url=file:///tmp/data",
    "kovalio://connect?url=http://ops.example.test",
    "kovalio://connect?url=https://person:password@ops.example.test",
    "kovalio://connect?url=https://ops.example.test/projects",
    "kovalio://connect?url=https://ops.example.test/accept-invite/../settings",
    "kovalio://connect?url=https%3A%2F%2Fops.example.test%3Ftoken%3Dsecret",
    "kovalio://connect?url=https%3A%2F%2Fops.example.test%23token",
    "kovalio://connect?url=https%3A%2F%2Fops.example.test%5Cevil",
    "kovalio://connect?url=ops.example.test",
    "kovalio://connect?url=https://ops.example.test\n",
    "kovalio://connect?url=" + "x".repeat(4096),
  ])("rejects an untrusted protocol target without returning a destination: %s", (input) => {
    expect(parseDesktopInstanceLink(input)).toBeNull();
  });

  it("never embeds a connection code or arbitrary return path", () => {
    expect(() => desktopInstanceLink("fixture-pairing-code/secret")).toThrow();
    expect(() =>
      desktopInstanceLink("https://ops.example.test?returnTo=https://other.test"),
    ).toThrow();
    expect(parseInstanceAddress("https://ops.example.test/" + "x".repeat(2048))).toBeNull();
  });
});
