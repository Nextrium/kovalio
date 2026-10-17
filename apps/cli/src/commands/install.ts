/**
 * `kovalio install` — lazy-download and install the Kovalio desktop app for
 * the current OS/arch.
 *
 * This talks to GitHub, NOT the Kovalio API: assets are published to
 * github.com/Nextrium/kovalio/releases (asset names match the desktop updater,
 * apps/desktop/src/main/updater.ts — Kovalio-arm64.dmg / Kovalio-x64.dmg /
 * Kovalio.AppImage, plus Kovalio-win32-x64.zip for the CLI install path).
 *
 * Flow: resolve tag (--version, else releases/latest) → download the asset and
 * its <asset>.sha256 sidecar into ~/.kovalio/cache/releases/<tag>/ →
 * stream-verify with node:crypto (fail-closed if the sidecar is missing, unless
 * --no-verify) → install per-OS and launch.
 */
import { reportCaughtError as observeCaughtError } from "@repo/core/diagnostics";
import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import ora from "ora";
import {
  downloadToFile,
  formatBytes,
  hashFile,
  parseSha256,
  releaseDir,
} from "../lib/cache";
import { err, info, isJsonMode, ok, printJson } from "../lib/output";
import { RELEASES, resolveLatestTag, fetchSidecar } from "../lib/github-releases";

type AssetKind = "dmg" | "appimage" | "zip";

function assetForPlatform(): { name: string; kind: AssetKind } {
  const { platform, arch } = process;
  if (platform === "darwin") {
    return { name: arch === "arm64" ? "Kovalio-arm64.dmg" : "Kovalio-x64.dmg", kind: "dmg" };
  }
  if (platform === "win32") return { name: "Kovalio-win32-x64.zip", kind: "zip" };
  if (platform === "linux") {
    return { name: arch === "arm64" ? "Kovalio-arm64.AppImage" : "Kovalio.AppImage", kind: "appimage" };
  }
  throw new Error(`Unsupported platform: ${platform} (${arch})`);
}

/* ── per-OS install ─────────────────────────────────────────────────────── */

function installDmg(dmg: string): string {
  const homeApps = join(homedir(), "Applications");
  let dest = homeApps;
  try {
    mkdirSync(homeApps, { recursive: true });
  } catch (diagnosticFailure) {
    observeCaughtError(diagnosticFailure, "cli/commands/install");
    dest = "/Applications";
  }

  const attach = spawnSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", dmg], {
    encoding: "utf8",
  });
  if (attach.status !== 0) throw new Error(`hdiutil attach failed: ${attach.stderr?.trim()}`);
  const mount = (attach.stdout.match(/\/Volumes\/[^\n]*/g) ?? []).pop()?.trim();
  if (!mount) throw new Error("Could not determine the mounted volume");

  let target = join(dest, "Kovalio.app");
  try {
    const appInDmg = join(mount, "Kovalio.app");
    if (!existsSync(appInDmg)) throw new Error("Kovalio.app not found in the disk image");
    spawnSync("rm", ["-rf", target]);
    let copy = spawnSync("ditto", [appInDmg, target], { encoding: "utf8" });
    if (copy.status !== 0 && dest === homeApps) {
      // ~/Applications write failed (rare perms case) → fall back to /Applications.
      target = join("/Applications", "Kovalio.app");
      spawnSync("rm", ["-rf", target]);
      copy = spawnSync("ditto", [appInDmg, target], { encoding: "utf8" });
    }
    if (copy.status !== 0) throw new Error(`ditto copy failed: ${copy.stderr?.trim()}`);
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-quiet"]);
  }
  return target;
}

function installAppImage(appImage: string): string {
  chmodSync(appImage, 0o755);
  return appImage; // AppImages run in place; the cached file IS the install.
}

function installZip(zip: string): string {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const target = join(localAppData, "Programs", "Kovalio");
  mkdirSync(target, { recursive: true });
  // Paths travel as environment variables, never inside the command text, so a
  // quote or wildcard in a path can't change what PowerShell runs.
  const expand = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:KOVALIO_INSTALL_ZIP -DestinationPath $env:KOVALIO_INSTALL_DEST -Force",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, KOVALIO_INSTALL_ZIP: zip, KOVALIO_INSTALL_DEST: target },
    },
  );
  if (expand.status !== 0) throw new Error(`Expand-Archive failed: ${expand.stderr?.trim()}`);
  return target;
}

function launch(kind: AssetKind, target: string): void {
  if (kind === "dmg") {
    spawnSync("open", [target]);
    return;
  }
  if (kind === "appimage") {
    // Try native launch; fall back to the FUSE-free extractor if it exits fast.
    const child = spawn(target, [], { detached: true, stdio: "ignore" });
    child.on("error", (diagnosticFailure) => {
      observeCaughtError(diagnosticFailure, "cli/commands/install");
      spawn(target, ["--appimage-extract-and-run"], { detached: true, stdio: "ignore" }).unref();
    });
    child.unref();
    return;
  }
  // zip: start the exe under the install dir directly (not via `cmd /c start`, which
  // re-parses the path, so an `&` in the user's profile path would split it).
  const exe = join(target, "Kovalio.exe");
  if (existsSync(exe)) {
    const child = spawn(exe, [], { detached: true, stdio: "ignore" });
    child.on("error", (diagnosticFailure) => observeCaughtError(diagnosticFailure, "cli/commands/install"));
    child.unref();
    return;
  }
  spawnSync("explorer.exe", [target]);
}

export const installCommand = new Command("install")
  .description("Download and install the Kovalio desktop app for this OS")
  .option("--version <tag>", "Release tag to install (e.g. v1.2.3)")
  .option("--latest", "Install the latest release (default)")
  .option("--force", "Re-download even if a verified copy is cached")
  .option("--no-verify", "Skip SHA-256 verification (allowed when no sidecar exists)")
  .option("--no-launch", "Install without launching the app")
  .action(async (opts) => {
    let asset: { name: string; kind: AssetKind };
    try {
      asset = assetForPlatform();
    } catch (e) {
      err((e as Error).message);
      process.exit(1);
    }

    const spin = (text: string) => (isJsonMode() ? null : ora(text).start());

    let tag: string;
    try {
      if (opts.version) {
        tag = opts.version;
      } else {
        const s = spin("Resolving latest release…");
        tag = await resolveLatestTag();
        s?.succeed(`Latest release: ${tag}`);
      }
    } catch (e) {
      err(`Could not resolve a release tag: ${(e as Error).message}`);
      process.exit(1);
    }

    const dir = releaseDir(tag);
    const assetPath = join(dir, asset.name);
    const sidecarPath = `${assetPath}.sha256`;
    const assetUrl = `${RELEASES}/download/${tag}/${asset.name}`;
    const sidecarUrl = `${assetUrl}.sha256`;

    // Reuse a cached, sidecar-verified copy unless --force.
    let downloaded = false;
    let sha: string | undefined;
    const cachedUsable =
      !opts.force &&
      existsSync(assetPath) &&
      (existsSync(sidecarPath) || opts.verify === false);

    if (cachedUsable) {
      info(`  Using cached ${asset.name} (${tag}).`);
    } else {
      const s = spin(`Downloading ${asset.name}…`);
      try {
        const res = await downloadToFile(assetUrl, assetPath, (recv, total) => {
          if (s && total) s.text = `Downloading ${asset.name} — ${formatBytes(recv)} / ${formatBytes(total)}`;
        });
        sha = res.sha256;
        downloaded = true;
        s?.succeed(`Downloaded ${asset.name} (${formatBytes(res.size)})`);
      } catch (e) {
        s?.fail("Download failed");
        err((e as Error).message);
        process.exit(1);
      }
    }

    // Verify against the .sha256 sidecar. Fail-closed when it's missing.
    if (opts.verify !== false) {
      const s = spin("Verifying checksum…");
      try {
        let sidecarBody: string | null;
        if (existsSync(sidecarPath) && !downloaded) {
          sidecarBody = readFileSync(sidecarPath, "utf8");
        } else {
          sidecarBody = await fetchSidecar(sidecarUrl);
        }
        if (sidecarBody === null) {
          s?.fail("No checksum sidecar published for this asset");
          err(
            "Refusing to install an unverified download. Re-run with --no-verify to override.",
          );
          process.exit(1);
        }
        const expected = parseSha256(sidecarBody);
        if (!expected) {
          s?.fail("Malformed checksum sidecar");
          err(`Could not parse a SHA-256 from ${sidecarUrl}`);
          process.exit(1);
        }
        const actual = sha ?? (await hashFile(assetPath));
        if (actual !== expected) {
          s?.fail("Checksum mismatch");
          err(`Expected ${expected}, got ${actual}. The download may be corrupt or tampered with.`);
          process.exit(1);
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(sidecarPath, sidecarBody);
        s?.succeed("Checksum verified");
      } catch (e) {
        s?.fail("Verification failed");
        err((e as Error).message);
        process.exit(1);
      }
    } else {
      info("  Skipping checksum verification (--no-verify).");
    }

    // Install.
    let target: string;
    const s = spin("Installing…");
    try {
      if (asset.kind === "dmg") target = installDmg(assetPath);
      else if (asset.kind === "appimage") target = installAppImage(assetPath);
      else target = installZip(assetPath);
      s?.succeed(`Installed → ${target}`);
    } catch (e) {
      s?.fail("Install failed");
      err((e as Error).message);
      process.exit(1);
    }

    const willLaunch = opts.launch !== false;
    if (willLaunch) {
      try {
        launch(asset.kind, target);
      } catch (diagnosticFailure) {
        observeCaughtError(diagnosticFailure, "cli/commands/install");
        // Launch is best-effort; the install already succeeded.
      }
    }

    if (isJsonMode()) {
      printJson({ tag, asset: asset.name, path: target, cached: !downloaded, launched: willLaunch });
    } else {
      ok(`\n  Kovalio ${tag} is installed.${willLaunch ? " Launching…" : ""}\n`);
    }
  });
