import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  "out",
  ".cache",
]);

const IGNORE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".pdf",
  ".wasm",
  ".mmdb",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".db",
  ".sqlite",
  ".lock",
]);

const IGNORE_FILES = new Set([
  "scripts/rebrand-kovalio.mjs",
  "scripts/rebrand-kovalio.ts",
  "pnpm-lock.yaml",
  "bun.lock",
]);

const REPLACEMENTS = [
  // Repos & URLs
  [/https:\/\/github\.com\/oblien\/openship\.git/g, "https://github.com/Nextrium/kovalio.git"],
  [/https:\/\/github\.com\/oblien\/openship/g, "https://github.com/Nextrium/kovalio"],
  [/https:\/\/app\.openship\.io/g, "https://kovalio.nextrium.org"],
  [/https:\/\/api\.openship\.io/g, "https://api.nextrium.org"],
  [/https:\/\/openship\.io/g, "https://nextrium.org"],
  [/https:\/\/get\.openship\.io/g, "https://get.kovalio.nextrium.org"],
  [/app\.openship\.io/g, "kovalio.nextrium.org"],
  [/api\.openship\.io/g, "api.nextrium.org"],
  [/openship\.io/g, "nextrium.org"],
  [/noreply@openship\.io/g, "noreply@nextrium.org"],
  [/OpenShip/g, "Kovalio"],
  [/Openship/g, "Kovalio"],
  [/openship/g, "kovalio"],
  [/OPENSHIP/g, "KOVALIO"],
];

let filesScanned = 0;
let filesModified = 0;

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = relative(ROOT, fullPath).replace(/\\/g, "/");

    if (IGNORE_DIRS.has(entry) || IGNORE_FILES.has(relPath)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (IGNORE_EXTENSIONS.has(ext)) {
        continue;
      }
      processFile(fullPath, relPath);
    }
  }
}

function processFile(fullPath, relPath) {
  filesScanned++;
  try {
    const original = readFileSync(fullPath, "utf8");
    let modified = original;

    for (const [pattern, replacement] of REPLACEMENTS) {
      modified = modified.replace(pattern, replacement);
    }

    if (modified !== original) {
      writeFileSync(fullPath, modified, "utf8");
      filesModified++;
      console.log(`[rebrand] Updated: ${relPath}`);
    }
  } catch (err) {
    // Skip binary files
  }
}

console.log("🚀 Starting Kovalio Brand Overlay Engine...");
walk(ROOT);
console.log(`\n✅ Finished rebranding: Scanned ${filesScanned} files, Modified ${filesModified} files.`);
