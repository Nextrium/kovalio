#!/usr/bin/env node
// Fork guard: proves Kovalio's own changes survive an upstream sync.
//
//   node scripts/fork-guard.mjs
//
// 1. Branding: no upstream branding left (scripts/rebrand-kovalio.mjs --check).
// 2. Sync tooling: the overlay rules and the brand-aware merge driver (scripts/test).
// 3. Fork patches: every *.fork.test.* file, run with its own package's vitest.
//
// Fork tests live in fork-only files, so upstream can never edit or delete them.
// Each one pins a fork fix or feature that sits in upstream-owned code; when a sync
// silently undoes one, this fails on the sync PR. FORK_PATCHES.md lists them.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const failures = [];

function run(label, cmd, args, cwd = ROOT) {
  console.log(`\n▶ ${label}`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) failures.push(label);
}

run("Branding", "node", ["scripts/rebrand-kovalio.mjs", "--check"]);

const scriptTests = readdirSync(join(ROOT, "scripts", "test"))
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => join("scripts", "test", f));
run("Sync tooling", "node", ["--test", ...scriptTests]);

const forkTests = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\0")
  .filter((p) => /\.fork\.test\.[cm]?[jt]sx?$/.test(p) && existsSync(join(ROOT, p)));

const byPackage = new Map();
for (const file of forkTests) {
  let dir = dirname(join(ROOT, file));
  while (dir !== ROOT && !existsSync(join(dir, "package.json"))) dir = dirname(dir);
  const list = byPackage.get(dir) ?? [];
  list.push(relative(dir, join(ROOT, file)).replace(/\\/g, "/"));
  byPackage.set(dir, list);
}

const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");
for (const [pkg, files] of byPackage) {
  run(`Fork patches: ${relative(ROOT, pkg) || "."}`, "node", [vitest, "run", ...files], pkg);
}

console.log(`\nFork guard: ${forkTests.length} fork test file(s) in ${byPackage.size} package(s).`);
if (failures.length > 0) {
  console.error(`Fork guard failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Fork guard passed.");
