import { AppError, shellQuote as q } from "@repo/core";
import type { CommandExecutor } from "@repo/adapters";
import type { IngressConnection } from "@repo/db";
export interface ConnectorPin {
  version: string;
  image: string;
  releases: Record<string, { asset: string; sha: string }>;
}
/** cloudflared below 2026.10.2 trusts the compromised eMudhra intermediates (October 2026).
 * Checksums are the release's published SHA-256 values; the image is pinned by its
 * multi-arch index digest. */
export const CURRENT: ConnectorPin = {
  version: "2026.10.3",
  image:
    "cloudflare/cloudflared:2026.10.3@sha256:faa8e0a1475f137c910be6025f43c8e4092fdd35461b31e19fd1390657a1ff39",
  releases: {
    x86_64: {
      asset: "amd64",
      sha: "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0",
    },
    aarch64: {
      asset: "arm64",
      sha: "89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8",
    },
  },
};
/** Every pin Kovalio installed before CURRENT. A unit, binary or container that matches one
 * exactly is upgraded; anything else is refused as edited outside Kovalio. When CURRENT
 * changes, move the outgoing pin here and never delete an entry. The unit template must stay
 * identical apart from the binary path, or older units stop matching. */
export const PREVIOUS: readonly ConnectorPin[] = [
  {
    version: "2026.10.0",
    image:
      "cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07",
    releases: {
      x86_64: {
        asset: "amd64",
        sha: "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
      },
      aarch64: {
        asset: "arm64",
        sha: "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
      },
    },
  },
];
const binary = (version: string) => `/usr/local/lib/kovalio/cloudflared-${version}`;
export interface TunnelConnector {
  id: string;
  version: string;
  connected: boolean;
}
export interface TunnelOrigin {
  hostname?: string;
  service: string;
  originServerName?: string;
  noTLSVerify?: boolean;
}
/** What an upgrade needs from Cloudflare. Without these, installed connectors are never
 * replaced, because only the tunnel can confirm that the new connector has connected. */
export interface ConnectorUpgradeHooks {
  connectors(): Promise<TunnelConnector[]>;
  httpsOrigins(): Promise<TunnelOrigin[]>;
  warn(message: string): void;
  sleep?(ms: number): Promise<void>;
  timeoutMs?: number;
}
function identity(connection: IngressConnection) {
  if (!/^[a-zA-Z0-9_-]+$/.test(connection.id) || !/^[a-zA-Z0-9-]+$/.test(connection.tunnelId ?? ""))
    throw new AppError("Invalid connector identity", 400, "INGRESS_CONNECTOR_ID");
  const name = `kovalio-cloudflare-${connection.id}`;
  return {
    name,
    dir: `/etc/kovalio/ingress/${connection.id}`,
    marker: JSON.stringify({ connectionId: connection.id, tunnelId: connection.tunnelId }),
  };
}
const HOST = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)$/;
const NAME = /^[a-zA-Z0-9.-]+$/;
/** Stops before an upgrade when an HTTPS origin's served chain names eMudhra (emSign): the
 * fixed connector rejects the compromised intermediates. No authoritative fingerprint list
 * was published, so this matches issuer names and errs towards stopping. An origin that
 * cannot be checked is reported and does not block the upgrade, which is the security fix. */
export async function assertOriginsTrusted(
  executor: CommandExecutor,
  origins: TunnelOrigin[],
  warn: (message: string) => void,
): Promise<void> {
  const flagged: string[] = [];
  for (const origin of origins) {
    const label = origin.hostname ?? origin.service;
    if (origin.noTLSVerify)
      warn(
        `The tunnel rule for ${label} turns off TLS verification (noTLSVerify). Kovalio does not change rules it does not own; turn verification back on in Cloudflare.`,
      );
    let url: URL;
    try {
      url = new URL(origin.service);
    } catch {
      warn(`Could not check ${label}: its origin is not a valid URL.`);
      continue;
    }
    if (url.protocol !== "https:") continue;
    const host = url.hostname;
    const sni = origin.originServerName ?? (/^\[|^[0-9.]+$/.test(host) ? undefined : host);
    if (!HOST.test(host) || (sni && !NAME.test(sni))) {
      warn(`Could not check ${label}: its origin address is not a plain host name.`);
      continue;
    }
    const output = await executor
      .exec(
        `if command -v openssl >/dev/null 2>&1; then timeout 15 openssl s_client -connect ${q(`${host}:${url.port || "443"}`)}${sni ? ` -servername ${q(sni)}` : ""} -showcerts </dev/null 2>/dev/null || true; fi`,
        { timeout: 20_000 },
      )
      .catch(() => "");
    const chain = output.split("\n").filter((line) => /^\s*(\d+\s+)?[si]:/.test(line));
    if (!chain.length) {
      warn(
        `Could not read the certificate chain of ${label} from this server. Check that it does not chain to an eMudhra (emSign) intermediate.`,
      );
      continue;
    }
    if (chain.some((line) => /emudhra|emsign/i.test(line))) flagged.push(label);
  }
  if (flagged.length)
    throw new AppError(
      `The HTTPS origin certificate for ${flagged.join(", ")} is issued through eMudhra (emSign). The updated connector rejects the compromised eMudhra intermediates, so replace that certificate, then retry. Do not turn off TLS verification.`,
      409,
      "INGRESS_ORIGIN_CERTIFICATE",
    );
}
async function waitForNewConnector(
  hooks: ConnectorUpgradeHooks,
  seen: Set<string>,
  message: string,
): Promise<void> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const polls = Math.max(1, Math.ceil((hooks.timeoutMs ?? 120_000) / 5_000));
  for (let poll = 0; poll < polls; poll++) {
    if (poll) await sleep(5_000);
    if (
      (await hooks.connectors()).some(
        (c) => c.connected && c.version === CURRENT.version && !seen.has(c.id),
      )
    )
      return;
  }
  throw new AppError(message, 409, "INGRESS_CONNECTOR_OFFLINE");
}
const ids = (connectors: TunnelConnector[]) => new Set(connectors.map((c) => c.id));
export async function manageConnector(
  executor: CommandExecutor,
  connection: IngressConnection,
  token: string | null,
  remove = false,
  hooks?: ConnectorUpgradeHooks,
): Promise<void> {
  const { name, dir, marker } = identity(connection);
  const fail = (message: string): never => {
    throw new AppError(message, 409, "INGRESS_CONNECTOR_SETUP");
  };
  const root = (await executor.exec("id -u")).trim() === "0";
  const sudo = root ? "" : "sudo -n ";
  if (
    !root &&
    (await executor.exec("sudo -n true >/dev/null 2>&1 && echo yes || echo no")).trim() !== "yes"
  )
    fail(
      "Connector setup needs root or passwordless sudo. Install cloudflared yourself, then choose an existing connector.",
    );
  if ((await executor.exec("uname -s")).trim() !== "Linux")
    fail(
      "Automatic connector setup supports Linux. Install cloudflared on this server, then choose an existing connector.",
    );
  const read = async (path: string) => executor.exec(`${sudo}cat ${q(path)}`);
  const exists = async (path: string) =>
    (await executor.exec(`${sudo}test -e ${q(path)} && echo yes || echo no`)).trim() === "yes";
  const present = await exists(dir);
  if (present && (await read(`${dir}/owner.json`)).trim() !== marker)
    fail(
      "This connector directory is not owned by this setup. Review it on the server before retrying.",
    );
  const unit = `/etc/systemd/system/${name}.service`;
  const replicaName = `${name}-upgrade`;
  const replicaUnit = `/etc/systemd/system/${replicaName}.service`;
  const mode = (
    await executor.exec(
      "if command -v systemctl >/dev/null 2>&1 && test -d /run/systemd/system; then systemctl --version | head -1; elif command -v docker >/dev/null 2>&1; then echo docker; else echo unavailable; fi",
    )
  ).trim();
  const systemd = /^systemd (\d+)/.exec(mode);
  const useSystemd = Boolean(systemd && Number(systemd[1]) >= 247);
  const hasDocker =
    (await executor.exec("command -v docker >/dev/null 2>&1 && echo yes || echo no")).trim() ===
    "yes";
  const kindFile = `${dir}/runtime`;
  const hasKind =
    present &&
    (await executor.exec(`${sudo}test -f ${q(kindFile)} && echo yes || echo no`)).trim() === "yes";
  const storedKind = hasKind ? (await read(kindFile)).trim() : null;
  if (storedKind && !["systemd", "docker"].includes(storedKind))
    fail("The connector's ownership metadata changed. Review it on the server before retrying.");
  const kind = storedKind ?? (useSystemd ? "systemd" : "docker");
  const containerExists = async (container: string) =>
    (
      await executor.exec(
        `${sudo}docker ps -a --filter ${q(`name=^/${container}$`)} --format '{{.Names}}'`,
      )
    ).trim() === container;
  const ownedContainer = async (container: string) =>
    (
      await executor.exec(
        `${sudo}docker inspect --format '{{index .Config.Labels "kovalio.ingress"}}' ${q(container)}`,
      )
    ).trim() === connection.id;

  const unitText = (bin: string, replica = false) => {
    const service = replica ? replicaName : name;
    return `[Unit]\nDescription=Kovalio Cloudflare connector ${connection.id}${replica ? " (temporary upgrade replica)" : ""}\nAfter=network-online.target\nWants=network-online.target\n[Service]\nExecStart=${bin} tunnel --no-autoupdate run --token-file /run/credentials/${service}.service/token\nLoadCredential=token:${dir}/token\nDynamicUser=yes\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n${replica ? "" : "[Install]\nWantedBy=multi-user.target\n"}`;
  };
  const expectedUnit = unitText(binary(CURRENT.version));
  const ownedUnit = (text: string, replica = false) =>
    [CURRENT, ...PREVIOUS].some((p) => unitText(binary(p.version), replica).trim() === text.trim());
  const stopReplica = async () => {
    if (kind === "docker") {
      if (!(await containerExists(replicaName))) return;
      if (!(await ownedContainer(replicaName)))
        fail("A container already uses the temporary replica name. Kovalio will not replace it.");
      await executor.exec(`${sudo}docker rm -f ${q(replicaName)}`);
      return;
    }
    if (!(await exists(replicaUnit))) return;
    if (!ownedUnit(await read(replicaUnit), true))
      fail(
        "The temporary connector replica was edited outside Kovalio. It has been retained for review.",
      );
    await executor.exec(`${sudo}systemctl disable --now ${q(replicaName + ".service")} || true`);
    await executor.exec(`${sudo}rm -f ${q(replicaUnit)} && ${sudo}systemctl daemon-reload`);
  };
  // A previous binary is the rollback copy; keep it while any owned unit still points at it.
  const prune = async () => {
    for (const pin of PREVIOUS) {
      const old = binary(pin.version);
      if (!(await exists(old))) continue;
      const users = (
        await executor.exec(
          `${sudo}grep -lF -- ${q(old)} /etc/systemd/system/kovalio-cloudflare-*.service 2>/dev/null || true`,
        )
      ).trim();
      if (!users) await executor.exec(`${sudo}rm -f ${q(old)}`);
    }
  };
  // Finishes an upgrade interrupted after the switch, once the tunnel shows it is safe.
  const settle = async () => {
    if (!hooks) return;
    const replica =
      kind === "docker" ? await containerExists(replicaName) : await exists(replicaUnit);
    let stale = false;
    if (kind === "systemd") for (const pin of PREVIOUS) stale ||= await exists(binary(pin.version));
    if (!replica && !stale) return;
    const current = (await hooks.connectors()).filter(
      (c) => c.connected && c.version === CURRENT.version,
    ).length;
    if (replica && current >= 2) await stopReplica();
    if (stale && current >= 1 && !(await exists(replicaUnit))) await prune();
  };

  if (remove) {
    if (!present) return;
    if (kind === "systemd") await stopReplica();
    if (await exists(unit)) {
      if (!ownedUnit(await read(unit)))
        fail("The connector service was edited outside Kovalio. It has been retained for review.");
      await executor.exec(`${sudo}systemctl disable --now ${q(name + ".service")}`);
      await executor.exec(`${sudo}rm -f ${q(unit)} && ${sudo}systemctl daemon-reload`);
    } else if (kind === "systemd") {
      const state = (
        await executor.exec(
          `${sudo}systemctl show ${q(name + ".service")} --property=ActiveState --value`,
        )
      ).trim();
      if (!["inactive", "failed"].includes(state))
        fail(
          "The connector service is still running but its unit file is missing. Restore the owned unit file or stop the service before retrying cleanup.",
        );
    } else if (await containerExists(name)) {
      if (!(await ownedContainer(name)))
        fail(
          "The connector container is not owned by this setup. It has been retained for review.",
        );
      await executor.exec(`${sudo}docker rm -f ${q(name)}`);
    }
    if (kind === "docker") await stopReplica();
    await executor.exec(`${sudo}rm -rf ${q(dir)}`);
    return;
  }
  if (!token || !/^[a-zA-Z0-9._=-]+$/.test(token))
    fail("Cloudflare did not return a usable connector token. Retry setup.");
  if ((kind === "systemd" && !useSystemd) || (kind === "docker" && !hasDocker))
    fail(
      "Connector setup needs systemd 247 or newer, or Docker. Install cloudflared yourself and choose an existing connector instead.",
    );
  // Checks shared by both runtimes before anything on the server changes.
  const prepareUpgrade = async (from: ConnectorPin, arch?: string) => {
    if (!hooks)
      fail("Upgrading this connector needs the tunnel's live status. Retry from Kovalio.");
    if (arch) {
      const old = binary(from.version);
      if (
        (await exists(old)) &&
        (await executor.exec(`${sudo}sha256sum ${q(old)} | cut -d ' ' -f 1`)).trim() !==
          from.releases[arch]?.sha
      )
        fail("The managed cloudflared binary changed outside Kovalio. Review it before retrying.");
    }
    await assertOriginsTrusted(executor, await hooks!.httpsOrigins(), hooks!.warn);
    const before = await hooks!.connectors();
    const single = before.filter((c) => c.connected).length < 2;
    hooks!.warn(
      single
        ? `Upgrading the only connector of tunnel ${connection.tunnelId} to cloudflared ${CURRENT.version}. A temporary replica serves requests during the restart; long-lived connections (WebSockets, SSH, TCP) on the original drop once and must reconnect.`
        : `Upgrading one connector of tunnel ${connection.tunnelId} to cloudflared ${CURRENT.version}. The other connectors keep serving; long-lived connections (WebSockets, SSH, TCP) on this one drop once and must reconnect.`,
    );
    return { before, single };
  };
  const offline = (what: string) =>
    `The ${what} on cloudflared ${CURRENT.version} has not connected yet. Kovalio kept the previous connector files for rollback and will retry. Check outbound connectivity.`;
  const tmp = (await executor.exec("mktemp -d /tmp/kovalio-ingress.XXXXXXXXXX")).trim();
  if (!/^\/tmp\/kovalio-ingress\.[a-zA-Z0-9]+$/.test(tmp))
    fail("Could not create a private setup directory.");
  try {
    await executor.writeFile(`${tmp}/token`, token!, { mode: 0o600 });
    await executor.writeFile(`${tmp}/owner.json`, marker, { mode: 0o600 });
    await executor.writeFile(`${tmp}/runtime`, kind, { mode: 0o600 });
    await executor.exec(
      `${sudo}install -d -m 700 ${q(dir)} && ${sudo}install -m 600 ${q(tmp + "/owner.json")} ${q(dir + "/owner.json")} && ${sudo}install -m 600 ${q(tmp + "/runtime")} ${q(kindFile)}`,
    );
    const sameToken =
      present &&
      (
        await executor.exec(
          `${sudo}test -f ${q(dir + "/token")} && ${sudo}cmp -s ${q(tmp + "/token")} ${q(dir + "/token")} && echo yes || echo no`,
        )
      ).trim() === "yes";
    if (kind === "systemd") {
      const arch = (await executor.exec("uname -m")).trim();
      const release = CURRENT.releases[arch];
      if (!release)
        fail(
          "Automatic connector setup supports Linux x86-64 and ARM64. Use an existing connector on this architecture.",
        );
      const installed = (await exists(unit)) ? (await read(unit)).trim() : null;
      const from =
        installed === null || installed === expectedUnit.trim()
          ? null
          : (PREVIOUS.find((p) => unitText(binary(p.version)).trim() === installed) ??
            fail("The connector service was edited outside Kovalio. Review it before retrying."));
      const plan = from ? await prepareUpgrade(from, arch) : null;
      const bin = binary(CURRENT.version);
      if (
        (await executor.exec(`${sudo}test -f ${q(bin)} && echo yes || echo no`)).trim() !== "yes"
      ) {
        await executor.exec(
          `curl --fail --location --silent --show-error --max-time 180 ${q(`https://github.com/cloudflare/cloudflared/releases/download/${CURRENT.version}/cloudflared-linux-${release.asset}`)} -o ${q(tmp + "/cloudflared")}`,
          { timeout: 190000 },
        );
        await executor.exec(
          `printf '%s  %s\\n' ${q(release.sha)} ${q(tmp + "/cloudflared")} | sha256sum -c -`,
        );
        await executor.exec(
          `${sudo}install -d -m 755 /usr/local/lib/kovalio && ${sudo}install -m 755 ${q(tmp + "/cloudflared")} ${q(bin)}`,
        );
      } else
        await executor.exec(`${sudo}sha256sum ${q(bin)} | cut -d ' ' -f 1`).then((sha) => {
          if (sha.trim() !== release.sha)
            fail(
              "The managed cloudflared binary changed outside Kovalio. Review it before retrying.",
            );
        });
      const active =
        (
          await executor.exec(`${sudo}systemctl is-active ${q(name + ".service")} || true`)
        ).trim() === "active";
      if (!plan) {
        if (sameToken && active) return await settle();
        await executor.writeFile(`${tmp}/unit`, expectedUnit, { mode: 0o600 });
        await executor.exec(
          `${sudo}install -m 600 ${q(tmp + "/token")} ${q(dir + "/token")} && ${sudo}install -m 644 ${q(tmp + "/unit")} ${q(unit)} && ${sudo}systemctl daemon-reload && ${sudo}systemctl enable --now ${q(name + ".service")}`,
        );
        if (active) await executor.exec(`${sudo}systemctl restart ${q(name + ".service")}`);
        return;
      }
      // Upgrade: the new binary sits beside the old one, the unit switches, then the old
      // binary goes only after the tunnel shows the new connector connected.
      await executor.exec(`${sudo}install -m 600 ${q(tmp + "/token")} ${q(dir + "/token")}`);
      if (plan.single) {
        await stopReplica();
        await executor.writeFile(`${tmp}/replica`, unitText(bin, true), { mode: 0o600 });
        await executor.exec(
          `${sudo}install -m 644 ${q(tmp + "/replica")} ${q(replicaUnit)} && ${sudo}systemctl daemon-reload && ${sudo}systemctl start ${q(replicaName + ".service")}`,
        );
        try {
          await waitForNewConnector(hooks!, ids(plan.before), offline("temporary replica"));
        } catch (error) {
          await stopReplica();
          throw error;
        }
      }
      const seen = ids(await hooks!.connectors());
      await executor.writeFile(`${tmp}/unit`, expectedUnit, { mode: 0o600 });
      await executor.exec(
        `${sudo}install -m 644 ${q(tmp + "/unit")} ${q(unit)} && ${sudo}systemctl daemon-reload && ${sudo}systemctl enable ${q(name + ".service")} && ${sudo}systemctl restart ${q(name + ".service")}`,
      );
      await waitForNewConnector(hooks!, seen, offline("upgraded connector"));
      // Also clears a replica left by an interrupted earlier attempt.
      await stopReplica();
      await prune();
    } else {
      const existing = await containerExists(name);
      let plan: Awaited<ReturnType<typeof prepareUpgrade>> | null = null;
      if (existing) {
        if (!(await ownedContainer(name)))
          fail("A container already uses this connector name. Kovalio will not replace it.");
        const image = (
          await executor.exec(`${sudo}docker inspect --format '{{.Config.Image}}' ${q(name)}`)
        ).trim();
        if (image !== CURRENT.image)
          plan = await prepareUpgrade(
            PREVIOUS.find((p) => p.image === image) ??
              fail(
                "The connector container was changed outside Kovalio. It has been retained for review.",
              ),
          );
        else if (sameToken) {
          await executor.exec(`${sudo}docker start ${q(name)}`);
          return await settle();
        }
        // Recreate on rotation: a bind mount can retain the old file inode.
        else await executor.exec(`${sudo}docker rm -f ${q(name)}`);
      }
      await executor.exec(
        `${sudo}install -o 65532 -g 65532 -m 400 ${q(tmp + "/token")} ${q(dir + "/token")}`,
      );
      const run = (container: string, replica = false) =>
        executor.exec(
          `${sudo}docker run -d --name ${q(container)} --label ${q(`kovalio.ingress=${connection.id}`)}${replica ? " --label kovalio.ingress.role=upgrade" : ""} --restart unless-stopped --network host --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --mount ${q(`type=bind,src=${dir}/token,dst=/run/secrets/token,readonly`)} ${q(CURRENT.image)} tunnel --no-autoupdate run --token-file /run/secrets/token`,
          { timeout: 190000 },
        );
      if (!plan) {
        await run(name);
        return;
      }
      if (plan.single) {
        await stopReplica();
        await run(replicaName, true);
        try {
          await waitForNewConnector(hooks!, ids(plan.before), offline("temporary replica"));
        } catch (error) {
          await stopReplica();
          throw error;
        }
      }
      const seen = ids(await hooks!.connectors());
      await executor.exec(`${sudo}docker rm -f ${q(name)}`);
      await run(name);
      await waitForNewConnector(hooks!, seen, offline("upgraded connector"));
      await stopReplica();
    }
  } finally {
    await executor.rm(tmp);
  }
}
