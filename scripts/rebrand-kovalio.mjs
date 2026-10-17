#!/usr/bin/env node
// Kovalio brand overlay: rewrites upstream Openship branding to Kovalio.
//
//   node scripts/rebrand-kovalio.mjs           apply the overlay (renames + content)
//   node scripts/rebrand-kovalio.mjs --check   report leftover branding, exit 1 if any
//
// Run after every upstream merge (the Upstream Sync workflow does this) so new or
// moved upstream files are branded too. CI runs --check so branding can't regress.
// `rebrandText` is also imported by scripts/brand-merge-driver.mjs, which applies
// the same rules to upstream's side of a merge so branding never shows as a conflict.
//
// Base64 literals that decode to branded text are rebranded too (see BASE64_LITERAL).
//
// Only git-visible files are touched (tracked + untracked-not-ignored), so build
// output and node_modules are never rewritten. A line containing `brand-guard:keep`
// is left verbatim, for places that must name the upstream project.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The overlay itself and the sync tooling (which needs the real upstream URL).
const EXEMPT_FILES = new Set([
  "scripts/rebrand-kovalio.mjs",
  "scripts/brand-merge-driver.mjs",
  "scripts/sync-upstream.sh",
  ".github/workflows/upstream-sync.yml",
]);
// The overlay's and merge driver's tests feed upstream branding in as input.
const isExempt = (rel) => EXEMPT_FILES.has(rel) || rel.startsWith("scripts/test/");
const KEEP_MARKER = "brand-guard:keep";

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".avif", ".svgz", ".pdf",
  ".wasm", ".mmdb", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".zip", ".tar", ".gz",
  ".tgz", ".exe", ".dll", ".so", ".dylib", ".db", ".sqlite", ".lockb", ".mp4", ".webm",
]);

// Product images live where docker-images.yml publishes them: ghcr.io/nextrium/kovalio-*.
// The code assembles refs from a registry default (DEFAULT_IMAGE_REGISTRY,
// ${KOVALIO_IMAGE_REGISTRY:-ghcr.io/oblien}) plus a bare name, so both halves move
// together. Other images upstream hosts under ghcr.io/oblien (e.g. mindwire-*) are
// untouched, and so is the `oblien` namespace on any other registry.
const UPSTREAM_IMAGE = /ghcr\.io\/oblien\/(?:openship|kovalio)-/g;
const UPSTREAM_REGISTRY = /ghcr\.io\/oblien(?=\/\*|[^\w/.-]|$)/gm;

// Most specific first: URLs and domains before the bare brand word.
const REPLACEMENTS = [
  [/https:\/\/github\.com\/oblien\/openship\.git/g, "https://github.com/Nextrium/kovalio.git"],
  [/https:\/\/github\.com\/oblien\/openship/g, "https://github.com/Nextrium/kovalio"],
  [/github\.com\/oblien\/openship/g, "github.com/Nextrium/kovalio"],
  [/raw\.githubusercontent\.com\/oblien\/openship/g, "raw.githubusercontent.com/Nextrium/kovalio"],
  [/api\.github\.com\/repos\/oblien\/openship/g, "api.github.com/repos/Nextrium/kovalio"],
  [UPSTREAM_IMAGE, "ghcr.io/nextrium/kovalio-"],
  [UPSTREAM_REGISTRY, "ghcr.io/nextrium"],
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

// Generated modules embed sources as base64 (e.g. packages/adapters/src/infra/
// lua-embedded.ts), where the brand is invisible to plain text replacement. A literal
// is re-encoded only if it round-trips exactly and decodes to UTF-8 text carrying the
// brand, so the result matches what the generator would emit from branded sources.
const BASE64_LITERAL = /[A-Za-z0-9+/]{40,}={0,2}/g;

function decodeBrandedBase64(token) {
  const buf = Buffer.from(token, "base64");
  if (buf.toString("base64") !== token) return null;
  const decoded = buf.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(buf) || !/openship/i.test(decoded)) return null;
  return decoded;
}

export function rebrandText(text) {
  const plain = (s) => REPLACEMENTS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), s);
  const apply = (s) =>
    plain(
      s.replace(BASE64_LITERAL, (token) => {
        const decoded = decodeBrandedBase64(token);
        return decoded === null ? token : Buffer.from(rebrandText(decoded), "utf8").toString("base64");
      }),
    );
  if (!text.includes(KEEP_MARKER)) return apply(text);
  return text
    .split("\n")
    .map((line) => (line.includes(KEEP_MARKER) ? line : apply(line)))
    .join("\n");
}

/** Text the overlay may rewrite: valid UTF-8 with no NUL bytes in its first 8 KB. */
export function asText(buf) {
  if (buf.subarray(0, 8000).includes(0)) return null;
  const text = buf.toString("utf8");
  return Buffer.from(text, "utf8").equals(buf) ? text : null;
}

function listFiles(ROOT) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return [...new Set(out.split("\0").filter(Boolean))].filter((p) => existsSync(join(ROOT, p)));
}

function removeEmptyParents(ROOT, relDir) {
  let dir = relDir;
  while (dir && dir !== ".") {
    const abs = join(ROOT, dir);
    if (!existsSync(abs) || readdirSync(abs).length > 0) return;
    rmdirSync(abs);
    dir = dirname(dir);
  }
}

function main() {
const CHECK = process.argv.includes("--check");
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const findings = [];
const collisions = [];
let renamed = 0;
let rewritten = 0;

// 1. Paths: any file whose path carries the brand moves to the Kovalio name. If the
//    Kovalio-named file already exists with different content, both versions are kept
//    and reported: which one wins is a human decision, never the overlay's.
for (const from of listFiles(ROOT)) {
  if (isExempt(from) || !/openship/i.test(from)) continue;
  const to = rebrandText(from);
  if (CHECK) {
    findings.push(`path: ${from} -> ${to}`);
    continue;
  }
  if (existsSync(join(ROOT, to))) {
    const incoming = readFileSync(join(ROOT, from));
    const incomingText = asText(incoming);
    const branded = incomingText === null ? incoming : Buffer.from(rebrandText(incomingText), "utf8");
    if (!branded.equals(readFileSync(join(ROOT, to)))) {
      collisions.push(`${from} and ${to}`);
      continue;
    }
    rmSync(join(ROOT, from), { force: true });
    removeEmptyParents(ROOT, dirname(from));
    console.log(`[rebrand] ${from} duplicates ${to}; removed`);
    continue;
  }
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  renameSync(join(ROOT, from), join(ROOT, to));
  removeEmptyParents(ROOT, dirname(from));
  renamed++;
  console.log(`[rebrand] Renamed: ${from} -> ${to}`);
}

// 2. Contents.
for (const rel of listFiles(ROOT)) {
  if (isExempt(rel) || BINARY_EXTENSIONS.has(extname(rel).toLowerCase())) continue;
  const abs = join(ROOT, rel);
  const text = asText(readFileSync(abs));
  if (text === null) continue; // binary or not UTF-8; don't risk corrupting it
  const branded = rebrandText(text);
  if (branded === text) continue;
  if (CHECK) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.includes(KEEP_MARKER)) return;
      if (/openship/i.test(line)) findings.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      else if (line.search(UPSTREAM_IMAGE) !== -1 || line.search(UPSTREAM_REGISTRY) !== -1)
        findings.push(`${rel}:${i + 1}: upstream image registry ${line.trim().slice(0, 100)}`);
      else if ([...line.matchAll(BASE64_LITERAL)].some(([t]) => decodeBrandedBase64(t) !== null))
        findings.push(`${rel}:${i + 1}: base64-encoded branding`);
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
if (collisions.length > 0) {
  console.error(
    `Brand overlay: ${collisions.length} path collision(s) need a decision. Each upstream file
` +
      "differs from the existing Kovalio-named file; keep one, delete the other, re-run:",
  );
  for (const c of collisions) console.error(`  ${c}`);
  process.exit(2);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
