#!/usr/bin/env node
// Git merge driver for upstream syncs: three-way merge with branding factored out.
//
//   git config merge.kovalio-brand.driver "node scripts/brand-merge-driver.mjs %O %A %B %L %P"
//   echo "* merge=kovalio-brand" >> "$(git rev-parse --git-path info/attributes)"
//
// scripts/sync-upstream.sh sets both up. Git hands us the common ancestor (%O), our
// fork's version (%A, rewritten in place with the result) and upstream's (%B). The
// fork is already branded while base and upstream are not, so a plain merge would
// report a conflict on every upstream edit to a line that names the brand. Branding
// base and upstream with the overlay's own rules first leaves only real changes on
// each side; what still conflicts is a fork change overlapping an upstream change,
// and that is left with conflict markers for a person to decide. Nothing here picks
// a winner.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asText, rebrandText } from "./rebrand-kovalio.mjs";

const [basePath, oursPath, theirsPath, markerSize = "7", filePath = "file"] = process.argv.slice(2);

const base = readFileSync(basePath);
const ours = readFileSync(oursPath);
const theirs = readFileSync(theirsPath);
const [baseText, oursText, theirsText] = [base, ours, theirs].map(asText);

if (baseText === null || oursText === null || theirsText === null) {
  // Binary: only a one-sided change merges. Both changed means a decision.
  if (ours.equals(theirs) || theirs.equals(base)) process.exit(0);
  if (ours.equals(base)) {
    writeFileSync(oursPath, theirs);
    process.exit(0);
  }
  console.error(`brand-merge: ${filePath}: binary file changed on both sides`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "brand-merge-"));
try {
  const brandedBase = join(dir, "base");
  const brandedTheirs = join(dir, "theirs");
  writeFileSync(brandedBase, rebrandText(baseText));
  writeFileSync(brandedTheirs, rebrandText(theirsText));
  // merge-file exits with the number of conflicts (0 = clean), writing into oursPath.
  execFileSync(
    "git",
    [
      "merge-file",
      `--marker-size=${markerSize}`,
      "-L", `${filePath} (fork)`,
      "-L", `${filePath} (base, rebranded)`,
      "-L", `${filePath} (upstream, rebranded)`,
      oursPath,
      brandedBase,
      brandedTheirs,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  process.exit(0);
} catch (err) {
  if (typeof err.status === "number" && err.status > 0) process.exit(1);
  throw err;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
