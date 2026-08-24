import { readFileSync, writeFileSync, readdirSync, statSync, renameSync, existsSync } from "node:fs";
import { join, extname, relative, basename, dirname } from "node:path";

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

const FILE_RENAMES = [
  ["apps/api/src/lib/openship-cloud.ts", "apps/api/src/lib/kovalio-cloud.ts"],
  ["apps/api/src/lib/openship-manifest-sync.ts", "apps/api/src/lib/kovalio-manifest-sync.ts"],
  ["apps/api/src/lib/openship-manifest.ts", "apps/api/src/lib/kovalio-manifest.ts"],
  ["apps/api/src/lib/openship-server-store.test.ts", "apps/api/src/lib/kovalio-server-store.test.ts"],
  ["apps/api/src/lib/openship-server-store.ts", "apps/api/src/lib/kovalio-server-store.ts"],
  ["apps/api/src/lib/openship-snapshot-read.test.ts", "apps/api/src/lib/kovalio-snapshot-read.test.ts"],
  ["apps/api/src/modules/system/migration/openship-dist.ts", "apps/api/src/modules/system/migration/kovalio-dist.ts"],
  ["apps/api/src/modules/system/migration/openship-project.service.ts", "apps/api/src/modules/system/migration/kovalio-project.service.ts"],
  ["apps/web/content/docs/guides/openship-json.mdx", "apps/web/content/docs/guides/kovalio-json.mdx"],
  ["apps/web/content/docs/reference/openship-json.mdx", "apps/web/content/docs/reference/kovalio-json.mdx"],
  ["apps/web/content/resources/introducing-openship.mdx", "apps/web/content/resources/introducing-kovalio.mdx"],
  ["apps/web/public/openship.schema.json", "apps/web/public/kovalio.schema.json"],
  ["packages/core/src/metadata/openship.ts", "packages/core/src/metadata/kovalio.ts"],
  ["packages/core/src/openship-config", "packages/core/src/kovalio-config"],
];

let filesScanned = 0;
let filesModified = 0;

function handleFileRenames() {
  for (const [from, to] of FILE_RENAMES) {
    const fromPath = join(ROOT, from);
    const toPath = join(ROOT, to);
    if (existsSync(fromPath) && !existsSync(toPath)) {
      renameSync(fromPath, toPath);
      console.log(`[rebrand] Renamed: ${from} -> ${to}`);
    }
  }
}

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
handleFileRenames();
walk(ROOT);
console.log(`\n✅ Finished rebranding: Scanned ${filesScanned} files, Modified ${filesModified} files.`);
