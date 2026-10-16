#!/usr/bin/env node
// Kovalio brand overlay: rewrites upstream Openship branding to Kovalio.
//
//   node scripts/rebrand-kovalio.mjs           apply the overlay (renames + content)
//   node scripts/rebrand-kovalio.mjs --check   report leftover branding, exit 1 if any
//
// Run after every upstream merge (the Upstream Sync workflow does this) so new or
// moved upstream files are branded too. CI runs --check so branding can't regress.
//
// Only git-visible files are touched (tracked + untracked-not-ignored), so build
// output and node_modules are never rewritten. A line containing `brand-guard:keep`
// is left verbatim, for places that must name the upstream project.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// The overlay itself and the sync workflow (which needs the real upstream URL).
const EXEMPT_FILES = new Set(["scripts/rebrand-kovalio.mjs", ".github/workflows/upstream-sync.yml"]);
const KEEP_MARKER = "brand-guard:keep";

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".avif", ".svgz", ".pdf",
  ".wasm", ".mmdb", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".zip", ".tar", ".gz",
  ".tgz", ".exe", ".dll", ".so", ".dylib", ".db", ".sqlite", ".lockb", ".mp4", ".webm",
]);

// Most specific first: URLs and domains before the bare brand word.
const REPLACEMENTS = [
  [/https:\/\/github\.com\/oblien\/openship\.git/g, "https://github.com/Nextrium/kovalio.git"],
  [/https:\/\/github\.com\/oblien\/openship/g, "https://github.com/Nextrium/kovalio"],
  [/github\.com\/oblien\/openship/g, "github.com/Nextrium/kovalio"],
  [/noreply@openship\.io/g, "noreply@nextrium.org"],
  [/https:\/\/app\.openship\.io/g, "https://kovalio.nextrium.org"],
  [/https:\/\/api\.openship\.io/g, "https://api.nextrium.org"],
  [/https:\/\/get\.openship\.io/g, "https://get.kovalio.nextrium.org"],
  [/https:\/\/openship\.io/g, "https://nextrium.org"],
  [/app\.openship\.io/g, "kovalio.nextrium.org"],
  [/api\.openship\.io/g, "api.nextrium.org"],
  [/get\.openship\.io/g, "get.kovalio.nextrium.org"],
  [/openship\.io/g, "nextrium.org"],
  [/OpenShip/g, "Kovalio"],
  [/Openship/g, "Kovalio"],
  [/OPENSHIP/g, "KOVALIO"],
  [/openship/g, "kovalio"],
  // Any other casing (e.g. "OpenSHIP") falls back to lowercase.
  [/openship/gi, "kovalio"],
];

function rebrandText(text) {
  const apply = (s) => REPLACEMENTS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), s);
  if (!text.includes(KEEP_MARKER)) return apply(text);
  return text
    .split("\n")
    .map((line) => (line.includes(KEEP_MARKER) ? line : apply(line)))
    .join("\n");
}

function listFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return [...new Set(out.split("\0").filter(Boolean))].filter((p) => existsSync(join(ROOT, p)));
}

function removeEmptyParents(relDir) {
  let dir = relDir;
  while (dir && dir !== ".") {
    const abs = join(ROOT, dir);
    if (!existsSync(abs) || readdirSync(abs).length > 0) return;
    rmdirSync(abs);
    dir = dirname(dir);
  }
}

const findings = [];
let renamed = 0;
let rewritten = 0;

// 1. Paths: any file whose path carries the brand moves to the Kovalio name. If the
//    target already exists, it is a stale fork copy of a file upstream has since
//    changed under its original name, so the upstream version wins.
for (const from of listFiles()) {
  if (EXEMPT_FILES.has(from) || !/openship/i.test(from)) continue;
  const to = rebrandText(from);
  if (CHECK) {
    findings.push(`path: ${from} -> ${to}`);
    continue;
  }
  if (existsSync(join(ROOT, to))) {
    rmSync(join(ROOT, to), { force: true });
    console.log(`[rebrand] Replaced stale ${to} with upstream ${from}`);
  }
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  renameSync(join(ROOT, from), join(ROOT, to));
  removeEmptyParents(dirname(from));
  renamed++;
  console.log(`[rebrand] Renamed: ${from} -> ${to}`);
}

// 2. Contents.
for (const rel of listFiles()) {
  if (EXEMPT_FILES.has(rel) || BINARY_EXTENSIONS.has(extname(rel).toLowerCase())) continue;
  const abs = join(ROOT, rel);
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const text = buf.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buf)) continue; // not valid UTF-8; don't risk corrupting it
  const branded = rebrandText(text);
  if (branded === text) continue;
  if (CHECK) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/openship/i.test(line) && !line.includes(KEEP_MARKER)) findings.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
    continue;
  }
  writeFileSync(abs, branded);
  rewritten++;
  console.log(`[rebrand] Updated: ${rel}`);
}

if (CHECK) {
  if (findings.length === 0) {
    console.log("Brand guard: no Openship branding found.");
    process.exit(0);
  }
  console.error(`Brand guard: ${findings.length} Openship reference(s) found. Run \`node scripts/rebrand-kovalio.mjs\` to fix.`);
  for (const f of findings.slice(0, 200)) console.error(`  ${f}`);
  if (findings.length > 200) console.error(`  ... and ${findings.length - 200} more`);
  process.exit(1);
}

console.log(`Brand overlay done: ${renamed} path(s) renamed, ${rewritten} file(s) rewritten.`);
