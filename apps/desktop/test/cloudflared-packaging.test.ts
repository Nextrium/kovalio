import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflaredRelease, downloadCloudflared, stageCloudflared, verifyCloudflaredAsset } from "../scripts/fetch-cloudflared.mjs";

const directories: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "kovalio-cf-package-")); directories.push(dir); return dir; };
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("pinned Windows Cloudflare client", () => {
  it("pins both the executable and its license to one release and SHA-256", () => {
    expect(cloudflaredRelease.files.map((asset: { name: string }) => asset.name)).toEqual(["cloudflared.exe", "LICENSE"]);
    for (const asset of cloudflaredRelease.files) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.url).toContain(`/${cloudflaredRelease.version}/`);
    }
  });
  it("pins cloudflared 2026.10.3, which no longer trusts the compromised eMudhra intermediates", () => {
    expect(cloudflaredRelease.version).toBe("2026.10.3");
    const [exe, license] = cloudflaredRelease.files;
    expect(exe.url).toBe("https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe");
    expect(exe.sha256).toBe("76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2");
    expect(license.url).toBe("https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.3/LICENSE");
    expect(license.sha256).toBe("58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd");
  });
  it("installs a download only when it hashes to the pinned SHA-256", async () => {
    const asset = cloudflaredRelease.files[1];
    const pinned = asset.sha256;
    const bytes = Buffer.from("pinned release bytes");
    asset.sha256 = createHash("sha256").update(bytes).digest("hex");
    try {
      const target = directory();
      const served = new Map(cloudflaredRelease.files.map((file: { url: string; name: string }) => [file.url, file.name === asset.name ? bytes : Buffer.from("other")]));
      await expect(downloadCloudflared(target, async (url: string) => new Response(served.get(url)))).rejects.toThrow(/integrity check failed for cloudflared\.exe/);
      expect(() => verifyCloudflaredAsset(asset.name, bytes)).not.toThrow();
      expect(() => verifyCloudflaredAsset(asset.name, Buffer.concat([bytes, Buffer.from(" ")]))).toThrow(/integrity/);
    } finally {
      asset.sha256 = pinned;
    }
  });
  it("rejects altered downloads before creating an executable", async () => {
    const target = directory();
    await expect(downloadCloudflared(target, async () => new Response("untrusted binary"))).rejects.toThrow(/integrity/);
    expect(readdirSync(target)).toEqual([]);
  });
  it("refuses missing and modified assets when packaging Windows", () => {
    const source = directory();
    const target = directory();
    expect(() => stageCloudflared(source, target, "win32", "x64")).toThrow(/fetch-cloudflared/);
    writeFileSync(join(source, "cloudflared.exe"), "untrusted binary");
    expect(() => stageCloudflared(source, target, "win32", "x64")).toThrow(/integrity/);
    expect(readdirSync(target)).toEqual([]);
    expect(() => verifyCloudflaredAsset("LICENSE", Buffer.from("untrusted license"))).toThrow(/integrity/);
  });
  it("does not package a Windows executable for other platforms", () => {
    const source = directory(); const target = directory();
    expect(() => stageCloudflared(source, target, "linux", "arm64")).not.toThrow();
    expect(readdirSync(target)).toEqual([]);
    expect(() => stageCloudflared(source, target, "win32", "arm64")).toThrow(/Windows x64/);
  });
});
