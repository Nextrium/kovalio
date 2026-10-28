import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandExecutor } from "@repo/adapters";
import type { IngressConnection } from "@repo/db";
import {
  assertOriginsTrusted,
  CURRENT,
  manageConnector,
  PREVIOUS,
  type ConnectorUpgradeHooks,
  type TunnelConnector,
  type TunnelOrigin,
} from "./connector";
const c = { id: "igc_test", tunnelId: "tunnel-test" } as IngressConnection;
const owner = JSON.stringify({ connectionId: c.id, tunnelId: c.tunnelId });
const name = "kovalio-cloudflare-igc_test";
const dir = "/etc/kovalio/ingress/igc_test";
const unitPath = `/etc/systemd/system/${name}.service`;
const replicaPath = `/etc/systemd/system/${name}-upgrade.service`;
const bin = (v: string) => `/usr/local/lib/kovalio/cloudflared-${v}`;
const OLD = PREVIOUS.find((p) => p.version === "2026.10.0")!;
/** The unit Kovalio wrote for 2026.10.0, verbatim. Changing the template breaks upgrades. */
const unitFor = (v: string) =>
  `[Unit]\nDescription=Kovalio Cloudflare connector igc_test\nAfter=network-online.target\nWants=network-online.target\n[Service]\nExecStart=${bin(v)} tunnel --no-autoupdate run --token-file /run/credentials/${name}.service/token\nLoadCredential=token:${dir}/token\nDynamicUser=yes\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n[Install]\nWantedBy=multi-user.target\n`;
const EMUDHRA_CHAIN =
  "CONNECTED(00000003)\n---\nCertificate chain\n 0 s:CN = legacy.example.test\n   i:C = IN, O = eMudhra Technologies Limited, CN = emSign SSL CA - G1\n 1 s:C = IN, O = eMudhra Technologies Limited, CN = emSign SSL CA - G1\n   i:C = IN, O = eMudhra Technologies Limited, CN = emSign Root CA - G1\n";
const CLEAN_CHAIN =
  "Certificate chain\n 0 s:CN = app.example.test\n   i:C = US, O = Let's Encrypt, CN = R11\n";
interface Options {
  uid?: string;
  mode?: string;
  arch?: string;
  sameToken?: boolean;
  checksumFails?: boolean;
  dockerUnavailable?: boolean;
  /** Versions whose freshly started connectors never connect. */
  offline?: string[];
  chain?: string;
}
/** A small model of one Linux server and the tunnel's connector list in Cloudflare. */
function server(options: Options = {}) {
  const files = new Map<string, string>();
  const shas = new Map<string, string>();
  const containers = new Map<string, { image: string; label: string }>();
  const active = new Set<string>();
  const connectors: TunnelConnector[] = [];
  const attached = new Map<string, string>();
  const commands: string[] = [];
  let next = 0;
  const unquote = (s: string) => s.replace(/^'|'$/g, "");
  const start = (service: string, version: string) => {
    stop(service);
    const id = `connector-${++next}`;
    attached.set(service, id);
    connectors.push({ id, version, connected: !options.offline?.includes(version) });
  };
  const stop = (service: string) => {
    const id = attached.get(service);
    if (!id) return;
    attached.delete(service);
    connectors.splice(
      connectors.findIndex((x) => x.id === id),
      1,
    );
  };
  const unitVersion = (path: string) => /cloudflared-([0-9.]+) /.exec(files.get(path) ?? "")?.[1];
  const exec = vi.fn(async (cmd: string) => {
    commands.push(cmd);
    const quoted = [...cmd.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (cmd === "id -u") return options.uid ?? "0";
    if (cmd.includes("sudo -n true")) return "no";
    if (cmd === "uname -s") return "Linux";
    if (cmd === "uname -m") return options.arch ?? "aarch64";
    if (cmd.includes("systemctl --version")) return options.mode ?? "systemd 252";
    if (cmd.includes("command -v docker"))
      return options.mode === "docker" || options.mode === "systemd 240" ? "yes" : "no";
    if (cmd.includes("openssl s_client")) return options.chain ?? CLEAN_CHAIN;
    if (cmd.startsWith("mktemp")) return "/tmp/kovalio-ingress.ABC123";
    if (cmd.includes("cmp -s")) return options.sameToken ? "yes" : "no";
    if (cmd.includes("docker ps")) {
      if (options.dockerUnavailable) throw new Error("Docker unavailable");
      const wanted = /name=\^\/([^$]+)\$/.exec(cmd)![1];
      return containers.has(wanted) ? wanted : "";
    }
    if (cmd.includes("docker inspect") && cmd.includes(".Config.Image"))
      return containers.get(quoted.at(-1)!)?.image ?? "";
    if (cmd.includes("docker inspect")) return containers.get(quoted.at(-1)!)?.label ?? "";
    if (cmd.includes("docker run")) {
      const container = quoted[0];
      const image = quoted.find((q) => q.startsWith("cloudflare/cloudflared:"))!;
      containers.set(container, { image, label: c.id });
      start(container, /:([0-9.]+)@/.exec(image)![1]);
      return "";
    }
    if (cmd.includes("docker rm -f")) {
      containers.delete(quoted[0]);
      stop(quoted[0]);
      return "";
    }
    if (cmd.includes("docker start")) return "";
    if (cmd.includes("test -e") || cmd.includes("test -f"))
      return files.has(quoted[0]) ? "yes" : "no";
    if (cmd.includes("sha256sum -c")) {
      if (options.checksumFails)
        throw new Error("sha256sum: WARNING: 1 computed checksum did NOT match");
      return "OK";
    }
    if (cmd.includes("sha256sum")) return shas.get(quoted[0]) ?? "";
    if (cmd.startsWith("curl ")) {
      files.set("/tmp/kovalio-ingress.ABC123/cloudflared", "downloaded");
      return "";
    }
    if (cmd.includes("grep -lF")) {
      return [...files]
        .filter(
          ([path, text]) => path.startsWith("/etc/systemd/system/") && text.includes(quoted[0]),
        )
        .map(([path]) => path)
        .join("\n");
    }
    for (const m of cmd.matchAll(/install (?:-[og] \S+ )*-m \d+ '([^']+)' '([^']+)'/g)) {
      files.set(m[2], files.get(m[1]) ?? "");
      if (m[2].startsWith("/usr/local/lib/kovalio/"))
        shas.set(m[2], CURRENT.releases[options.arch ?? "aarch64"].sha);
    }
    for (const m of cmd.matchAll(/install (?:-[og] \S+ )*-d -m \d+ '?([^' &]+)'?/g))
      files.set(m[1], "");
    for (const m of cmd.matchAll(/systemctl (?:enable --now|restart|start) '([^']+)\.service'/g)) {
      active.add(m[1]);
      start(m[1], unitVersion(`/etc/systemd/system/${m[1]}.service`)!);
    }
    for (const m of cmd.matchAll(/systemctl disable --now '([^']+)\.service'/g)) {
      active.delete(m[1]);
      stop(m[1]);
    }
    if (cmd.includes("systemctl is-active"))
      return active.has(quoted[0].replace(".service", "")) ? "active" : "inactive";
    if (cmd.includes("systemctl show"))
      return active.has(quoted[0].replace(".service", "")) ? "active" : "inactive";
    for (const m of cmd.matchAll(/rm -f '([^']+)'/g)) files.delete(m[1]);
    if (cmd.includes("rm -rf"))
      for (const path of [...files.keys()]) if (path.startsWith(quoted[0])) files.delete(path);
    if (cmd.includes("cat ")) return files.get(quoted[0]) ?? "";
    return "";
  });
  const writeFile = vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  });
  const warnings: string[] = [];
  const hooks: ConnectorUpgradeHooks = {
    connectors: async () => connectors.map((x) => ({ ...x })),
    httpsOrigins: async () => origins,
    warn: (message) => warnings.push(message),
    sleep: async () => {},
    timeoutMs: 10_000,
  };
  let origins: TunnelOrigin[] = [];
  return {
    files,
    shas,
    containers,
    connectors,
    commands,
    warnings,
    hooks,
    exec,
    writeFile,
    setOrigins: (value: TunnelOrigin[]) => (origins = value),
    adapter: { exec, writeFile, rm: vi.fn(async () => {}) } as unknown as CommandExecutor,
    /** What Kovalio left on a server when it installed `version` as a systemd connector. */
    installSystemd(version: string, arch = options.arch ?? "aarch64") {
      files.set(dir, "");
      files.set(`${dir}/owner.json`, owner);
      files.set(`${dir}/runtime`, "systemd");
      files.set(`${dir}/token`, "token");
      files.set(unitPath, unitFor(version));
      files.set(bin(version), "binary");
      const pin = [CURRENT, ...PREVIOUS].find((p) => p.version === version)!;
      shas.set(bin(version), pin.releases[arch].sha);
      active.add(name);
      start(name, version);
    },
    installDocker(image: string) {
      files.set(dir, "");
      files.set(`${dir}/owner.json`, owner);
      files.set(`${dir}/runtime`, "docker");
      files.set(`${dir}/token`, "token");
      containers.set(name, { image, label: c.id });
      start(name, /:([0-9.]+)@?/.exec(image)?.[1] ?? "unknown");
    },
    /** A connector on another server sharing the tunnel. */
    addPeer(version: string) {
      connectors.push({ id: `peer-${++next}`, version, connected: true });
    },
  };
}
/** The fix must never weaken origin verification, whatever path it takes. */
function expectNoTlsBypass(s: ReturnType<typeof server>) {
  const written = s.writeFile.mock.calls.map(([, content]) => content);
  for (const text of [...s.commands, ...written])
    expect(text).not.toMatch(/no-?tls-?verify|insecure|--no-verify|-k /i);
}
const index = (s: ReturnType<typeof server>, needle: string | RegExp) =>
  s.commands.findIndex((cmd) =>
    typeof needle === "string" ? cmd.includes(needle) : needle.test(cmd),
  );

describe("pinned cloudflared release", () => {
  it("pins 2026.10.3, which no longer trusts the compromised eMudhra intermediates", () => {
    const [y, m, p] = CURRENT.version.split(".").map(Number);
    expect(y * 10_000 + m * 100 + p).toBeGreaterThanOrEqual(2026_10_02);
    expect(CURRENT.version).toBe("2026.10.3");
    expect(CURRENT.releases.x86_64.sha).toBe(
      "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0",
    );
    expect(CURRENT.releases.aarch64.sha).toBe(
      "89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8",
    );
    expect(CURRENT.image).toBe(
      "cloudflare/cloudflared:2026.10.3@sha256:faa8e0a1475f137c910be6025f43c8e4092fdd35461b31e19fd1390657a1ff39",
    );
  });
  it("keeps every earlier pin so installed connectors can be recognised", () => {
    expect(OLD.image).toBe(
      "cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07",
    );
    expect(OLD.releases.x86_64.sha).toBe(
      "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
    );
    expect(OLD.releases.aarch64.sha).toBe(
      "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
    );
    expect(PREVIOUS.map((p) => p.version)).not.toContain(CURRENT.version);
    for (const pin of [CURRENT, ...PREVIOUS]) {
      expect(pin.image).toMatch(/^cloudflare\/cloudflared:[0-9.]+@sha256:[a-f0-9]{64}$/);
      for (const r of Object.values(pin.releases)) expect(r.sha).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("destination-owned cloudflared connector", () => {
  it.each([
    ["aarch64", "arm64"],
    ["x86_64", "amd64"],
  ])(
    "installs a checksum-verified %s binary of the pinned release and a credential-isolated service without logging the token",
    async (arch, asset) => {
      const s = server({ arch });
      await manageConnector(s.adapter, c, "sensitive-token");
      expect(s.files.get("/tmp/kovalio-ingress.ABC123/token")).toBe("sensitive-token");
      const unit = s.files.get(unitPath)!;
      expect(unit).toBe(unitFor(CURRENT.version));
      expect(unit).toContain("\nDynamicUser=yes\n");
      expect(unit).toContain("LoadCredential=token:/etc/kovalio/ingress/igc_test/token");
      expect(unit).toContain(`ExecStart=${bin("2026.10.3")} tunnel --no-autoupdate run`);
      const all = s.commands.join("\n");
      expect(all).not.toContain("sensitive-token");
      expect(all).not.toContain("docker run");
      expect(all).toContain(
        `https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-linux-${asset}`,
      );
      const checksum = s.commands.find((cmd) => cmd.includes("sha256sum -c -"))!;
      expect(checksum).toContain(CURRENT.releases[arch].sha);
      const bytes = execFileSync("sh", ["-c", checksum.split("|")[0]]).toString();
      expect(bytes.endsWith("\n")).toBe(true);
      expect(bytes).not.toContain("\\n");
      expect(bytes).toContain("/tmp/kovalio-ingress.ABC123/cloudflared");
      expectNoTlsBypass(s);
    },
  );
  it.each(["docker", "systemd 240"])(
    "uses the pinned nonprivileged Docker image on %s without a Docker socket mount",
    async (mode) => {
      const s = server({ mode });
      await manageConnector(s.adapter, c, "sensitive-token");
      const run = s.commands.find((cmd) => cmd.includes("docker run"))!;
      expect(run).toContain(`'${CURRENT.image}'`);
      expect(run).toContain("--network host");
      expect(run).toContain("--read-only");
      expect(run).toContain("--cap-drop ALL");
      expect(run).toContain("--user 65532:65532");
      expect(run).toContain("readonly");
      expect(run).not.toContain("docker.sock");
      expect(run).not.toContain("--privileged");
      expect(run).not.toContain("sensitive-token");
      expectNoTlsBypass(s);
    },
  );
  it("fails a download whose checksum does not match before installing it", async () => {
    const s = server({ checksumFails: true });
    await expect(manageConnector(s.adapter, c, "token")).rejects.toThrow(/did NOT match/);
    expect(s.files.has(bin(CURRENT.version))).toBe(false);
    expect(s.files.has(unitPath)).toBe(false);
    expect(index(s, "systemctl enable")).toBe(-1);
  });
  it("generates a checksum command that rejects a tampered download", async () => {
    const s = server();
    await manageConnector(s.adapter, c, "token");
    const checksum = s.commands.find((cmd) => cmd.includes("sha256sum -c -"))!;
    const work = mkdtempSync(join(tmpdir(), "kovalio-cf-sha-"));
    try {
      const file = join(work, "cloudflared").replace(/\\/g, "/");
      writeFileSync(file, "not the pinned release");
      const command = checksum.replace("/tmp/kovalio-ingress.ABC123/cloudflared", file);
      expect(() => execFileSync("sh", ["-c", command], { stdio: "pipe" })).toThrow();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
  it("refuses an unsupported architecture before downloading anything", async () => {
    const s = server({ arch: "riscv64" });
    await expect(manageConnector(s.adapter, c, "token")).rejects.toThrow(/x86-64 and ARM64/);
    expect(index(s, "curl ")).toBe(-1);
    expect(s.files.has(unitPath)).toBe(false);
  });
  it("does not delete ownership metadata when the Docker daemon cannot confirm cleanup", async () => {
    const s = server({ mode: "docker", dockerUnavailable: true });
    s.files.set(dir, "");
    s.files.set(`${dir}/owner.json`, owner);
    s.files.set(`${dir}/runtime`, "docker");
    await expect(manageConnector(s.adapter, c, null, true)).rejects.toThrow("Docker unavailable");
    expect(index(s, "rm -rf")).toBe(-1);
  });
  it("refuses foreign directories and changed service units before modifying them", async () => {
    const foreign = server();
    foreign.files.set(dir, "");
    foreign.files.set(`${dir}/owner.json`, "{}");
    const edited = server();
    edited.installSystemd(OLD.version);
    edited.files.set(unitPath, unitFor(OLD.version).replace("RestartSec=5", "RestartSec=1"));
    for (const s of [foreign, edited]) {
      await expect(manageConnector(s.adapter, c, null, true)).rejects.toThrow(
        /owned|edited outside/,
      );
      expect(index(s, /disable --now|rm -rf/)).toBe(-1);
    }
  });
  it("removes a connector Kovalio installed on an earlier pin", async () => {
    const s = server();
    s.installSystemd(OLD.version);
    await manageConnector(s.adapter, c, null, true);
    expect(s.files.has(unitPath)).toBe(false);
    expect(s.files.has(dir)).toBe(false);
  });
  it("leaves a healthy native connector running on retry and reloads it after token rotation", async () => {
    const unchanged = server({ sameToken: true });
    unchanged.installSystemd(CURRENT.version);
    await manageConnector(unchanged.adapter, c, "token", false, unchanged.hooks);
    expect(index(unchanged, "systemctl restart")).toBe(-1);
    expect(index(unchanged, "curl ")).toBe(-1);
    const rotated = server({ sameToken: false });
    rotated.installSystemd(CURRENT.version);
    await manageConnector(rotated.adapter, c, "new-token", false, rotated.hooks);
    expect(index(rotated, "systemctl restart")).toBeGreaterThan(-1);
  });
  it("recreates only its owned Docker connector after token rotation", async () => {
    const unchanged = server({ mode: "docker", sameToken: true });
    unchanged.installDocker(CURRENT.image);
    await manageConnector(unchanged.adapter, c, "token", false, unchanged.hooks);
    expect(index(unchanged, "docker rm")).toBe(-1);
    const rotated = server({ mode: "docker", sameToken: false });
    rotated.installDocker(CURRENT.image);
    await manageConnector(rotated.adapter, c, "new-token", false, rotated.hooks);
    expect(index(rotated, "docker rm -f")).toBeGreaterThan(-1);
    expect(rotated.containers.get(name)?.image).toBe(CURRENT.image);
  });
  it("requires host privileges and rejects shell-unsafe identities before any command", async () => {
    const s = server({ uid: "1000" });
    await expect(manageConnector(s.adapter, c, "token")).rejects.toThrow(
      /root or passwordless sudo/,
    );
    expect(s.writeFile).not.toHaveBeenCalled();
    const safe = server();
    await expect(
      manageConnector(safe.adapter, { ...c, id: "'; touch /tmp/owned" }, "token"),
    ).rejects.toThrow(/identity/);
    expect(safe.exec).not.toHaveBeenCalled();
  });
});

describe("upgrading connectors Kovalio already installed", () => {
  it("upgrades the only 2026.10.0 systemd connector through a temporary replica", async () => {
    const s = server({ sameToken: true });
    s.installSystemd(OLD.version);
    s.setOrigins([{ hostname: "legacy.example.test", service: "https://127.0.0.1:8443" }]);
    await manageConnector(s.adapter, c, "token", false, s.hooks);

    expect(s.files.get(unitPath)).toBe(unitFor(CURRENT.version));
    expect(s.files.has(bin(CURRENT.version))).toBe(true);
    expect(s.files.has(bin(OLD.version))).toBe(false);
    expect(s.files.has(replicaPath)).toBe(false);
    expect(s.connectors).toEqual([
      expect.objectContaining({ version: CURRENT.version, connected: true }),
    ]);
    // Origins first; replica up before the original restarts; old binary last.
    const origins = index(s, "openssl s_client");
    const download = index(s, "curl ");
    const replica = index(s, `systemctl start '${name}-upgrade.service'`);
    const restart = index(s, `systemctl restart '${name}.service'`);
    const removeReplica = index(s, `disable --now '${name}-upgrade.service'`);
    const prune = index(s, `rm -f '${bin(OLD.version)}'`);
    expect(origins).toBeGreaterThan(-1);
    expect(origins).toBeLessThan(download);
    expect(download).toBeLessThan(replica);
    expect(replica).toBeLessThan(restart);
    expect(restart).toBeLessThan(removeReplica);
    expect(removeReplica).toBeLessThan(prune);
    expect(s.warnings.join("\n")).toMatch(/only connector.*temporary replica.*long-lived/s);
    expectNoTlsBypass(s);
  });
  it("upgrades one connector at a time without a replica when others serve the tunnel", async () => {
    const s = server({ sameToken: true });
    s.installSystemd(OLD.version);
    s.addPeer(CURRENT.version);
    await manageConnector(s.adapter, c, "token", false, s.hooks);
    expect(
      index(s, /systemctl start '.*-upgrade\.service'|install -m 644 '[^']+' '[^']*-upgrade/),
    ).toBe(-1);
    expect(s.files.get(unitPath)).toBe(unitFor(CURRENT.version));
    expect(s.files.has(bin(OLD.version))).toBe(false);
    expect(s.warnings.join("\n")).toMatch(/other connectors keep serving/);
  });
  it("keeps an old binary that another owned connector on this server still uses", async () => {
    const s = server({ sameToken: true });
    s.installSystemd(OLD.version);
    s.addPeer(CURRENT.version);
    s.files.set("/etc/systemd/system/kovalio-cloudflare-igc_other.service", unitFor(OLD.version));
    await manageConnector(s.adapter, c, "token", false, s.hooks);
    expect(s.files.has(bin(OLD.version))).toBe(true);
  });
  it("upgrades the only 2026.10.0 Docker connector by recreating it on the pinned image", async () => {
    const s = server({ mode: "docker", sameToken: true });
    s.installDocker(OLD.image);
    await manageConnector(s.adapter, c, "token", false, s.hooks);
    const replica = index(s, `--name '${name}-upgrade'`);
    const removeOld = index(s, `docker rm -f '${name}'`);
    const recreate = s.commands.findIndex(
      (cmd, i) => i > removeOld && cmd.includes(`docker run -d --name '${name}' `),
    );
    expect(s.commands[replica]).toContain(`'${CURRENT.image}'`);
    expect(s.commands[replica]).toContain("kovalio.ingress.role=upgrade");
    expect(replica).toBeLessThan(removeOld);
    expect(removeOld).toBeLessThan(recreate);
    expect(s.containers.get(name)?.image).toBe(CURRENT.image);
    expect(s.containers.has(`${name}-upgrade`)).toBe(false);
    expect(s.connectors).toEqual([expect.objectContaining({ version: CURRENT.version })]);
    expectNoTlsBypass(s);
  });
  it("leaves the original untouched when the temporary replica never connects", async () => {
    const s = server({ sameToken: true, offline: [CURRENT.version] });
    s.installSystemd(OLD.version);
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /temporary replica.*has not connected/,
    );
    expect(s.files.get(unitPath)).toBe(unitFor(OLD.version));
    expect(s.files.has(replicaPath)).toBe(false);
    expect(index(s, `systemctl restart '${name}.service'`)).toBe(-1);
  });
  it("keeps the rollback binary when the upgraded connector does not connect, then finishes on retry", async () => {
    const s = server({ sameToken: true });
    s.installSystemd(OLD.version);
    // The replica connects; the restarted original does not.
    const connectors = s.hooks.connectors;
    let calls = 0;
    s.hooks.connectors = async () =>
      (await connectors()).map((x) =>
        ++calls > 3 && x.id === "connector-3" ? { ...x, connected: false } : x,
      );
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /upgraded connector.*has not connected.*rollback/,
    );
    expect(s.files.has(bin(OLD.version))).toBe(true);
    expect(s.files.has(replicaPath)).toBe(true);
    s.hooks.connectors = connectors;
    await manageConnector(s.adapter, c, "token", false, s.hooks);
    expect(s.files.has(replicaPath)).toBe(false);
    expect(s.files.has(bin(OLD.version))).toBe(false);
  });
  it.each([
    [
      "an extra flag",
      unitFor(OLD.version).replace("run --token-file", "run --loglevel debug --token-file"),
    ],
    ["an unknown version", unitFor("2026.9.9")],
    ["edited hardening", unitFor(OLD.version).replace("ProtectHome=yes\n", "")],
  ])("refuses a hand-edited unit with %s instead of upgrading it", async (_label, text) => {
    const s = server();
    s.installSystemd(OLD.version);
    s.files.set(unitPath, text);
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /edited outside Kovalio/,
    );
    expect(s.files.get(unitPath)).toBe(text);
    expect(index(s, /curl |systemctl (start|restart|enable)/)).toBe(-1);
  });
  it("refuses to upgrade when the previous binary changed outside Kovalio", async () => {
    const s = server();
    s.installSystemd(OLD.version);
    s.shas.set(bin(OLD.version), "0".repeat(64));
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /binary changed outside Kovalio/,
    );
    expect(index(s, /curl |systemctl (start|restart)/)).toBe(-1);
  });
  it("refuses a Docker connector whose image Kovalio never pinned", async () => {
    const s = server({ mode: "docker" });
    s.installDocker("cloudflare/cloudflared:latest");
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /changed outside Kovalio/,
    );
    expect(index(s, /docker (rm|run)/)).toBe(-1);
  });
  it("needs the tunnel's live status before replacing an installed connector", async () => {
    const s = server();
    s.installSystemd(OLD.version);
    await expect(manageConnector(s.adapter, c, "token")).rejects.toThrow(/live status/);
    expect(s.files.get(unitPath)).toBe(unitFor(OLD.version));
  });
  it("stops before upgrading when an HTTPS origin chains to eMudhra", async () => {
    const s = server({ chain: EMUDHRA_CHAIN });
    s.installSystemd(OLD.version);
    s.setOrigins([{ hostname: "legacy.example.test", service: "https://legacy.internal:8443" }]);
    await expect(manageConnector(s.adapter, c, "token", false, s.hooks)).rejects.toThrow(
      /legacy\.example\.test.*eMudhra.*replace that certificate.*Do not turn off TLS verification/s,
    );
    expect(s.files.get(unitPath)).toBe(unitFor(OLD.version));
    expect(index(s, /curl |systemctl (start|restart)|install -m 644/)).toBe(-1);
    expectNoTlsBypass(s);
  });
});

describe("origin certificate check", () => {
  const check = async (origins: TunnelOrigin[], chain = CLEAN_CHAIN) => {
    const s = server({ chain });
    const warnings: string[] = [];
    const result = assertOriginsTrusted(s.adapter, origins, (m) => warnings.push(m));
    return { s, warnings, result };
  };
  it("reports an origin it cannot inspect and lets the upgrade continue", async () => {
    const { result, warnings } = await check(
      [{ hostname: "a.test", service: "https://a.test" }],
      "",
    );
    await expect(result).resolves.toBeUndefined();
    expect(warnings.join()).toMatch(/Could not read the certificate chain of a\.test/);
  });
  it("warns about rules that already turn verification off, without changing them", async () => {
    const { result, warnings, s } = await check([
      { hostname: "b.test", service: "https://b.test", noTLSVerify: true },
    ]);
    await expect(result).resolves.toBeUndefined();
    expect(warnings.join()).toMatch(/b\.test turns off TLS verification/);
    expect(s.writeFile).not.toHaveBeenCalled();
  });
  it("checks only HTTPS origins and passes the SNI the connector would use", async () => {
    const { result, s } = await check([
      { service: "http://127.0.0.1:80" },
      { service: "http_status:404" },
      { hostname: "c.test", service: "https://10.0.0.5:8443", originServerName: "c.internal" },
    ]);
    await result;
    const probes = s.commands.filter((cmd) => cmd.includes("openssl"));
    expect(probes).toHaveLength(1);
    expect(probes[0]).toContain("-connect '10.0.0.5:8443'");
    expect(probes[0]).toContain("-servername 'c.internal'");
    expect(probes[0]).not.toMatch(/-verify|-no_|insecure/i);
  });
  it("never passes a shell-unsafe origin to the server", async () => {
    const { result, s, warnings } = await check([
      { hostname: "d.test", service: "https://d.test", originServerName: "x; touch /tmp/owned" },
    ]);
    await result;
    expect(s.commands.join("\n")).not.toContain("touch");
    expect(warnings.join()).toMatch(/not a plain host name/);
  });
});
