// Fork guard: the brand-aware merge driver, end to end in a scratch repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const DRIVER = resolve(fileURLToPath(new URL("../brand-merge-driver.mjs", import.meta.url)));
let repo;

// Isolated from the machine's global/system git config (signing, hooks, aliases).
let env;
const git = (...args) =>
  execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (name, text) => writeFileSync(join(repo, name), text);
const read = (name) => readFileSync(join(repo, name), "utf8");

/** Commit `upstream` on a branch off base, `fork` on main, then merge upstream into main. */
function merge(name, base, fork, upstream) {
  git("checkout", "-q", "-B", "main", "root");
  write(name, base);
  git("add", name);
  git("commit", "-q", "-m", `base ${name}`);
  const baseSha = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "-B", "upstream", baseSha);
  write(name, upstream);
  git("commit", "-q", "-am", `upstream ${name}`);
  git("checkout", "-q", "main");
  write(name, fork);
  git("commit", "-q", "-am", `fork ${name}`);
  try {
    git("merge", "--no-ff", "--no-edit", "upstream");
    return { clean: true, text: read(name) };
  } catch {
    const result = { clean: false, text: read(name) };
    git("merge", "--abort");
    return result;
  }
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "brand-merge-test-"));
  const emptyConfig = `${repo}.gitconfig`;
  writeFileSync(emptyConfig, "");
  env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  git("config", "merge.kovalio-brand.driver", `node "${DRIVER}" %O %A %B %L %P`);
  writeFileSync(join(repo, ".git", "info", "attributes"), "* merge=kovalio-brand\n");
  git("commit", "-q", "--allow-empty", "-m", "root");
  git("tag", "root");
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(env.GIT_CONFIG_GLOBAL, { force: true });
});

test("an upstream edit to a branded line merges cleanly, already branded", () => {
  const base = "const name = 'Openship';\nconst port = 3000;\n";
  const fork = "const name = 'Kovalio';\nconst port = 3000;\n";
  const upstream = "const name = 'Openship Cloud';\nconst port = 3000;\n";
  const { clean, text } = merge("brand.js", base, fork, upstream);
  assert.equal(clean, true);
  assert.equal(text, "const name = 'Kovalio Cloud';\nconst port = 3000;\n");
});

test("non-overlapping fork and upstream changes both survive", () => {
  const base = "a = 1\nb = 'openship'\nc = 3\n";
  const fork = "a = 10\nb = 'kovalio'\nc = 3\n";
  const upstream = "a = 1\nb = 'openship'\nc = 30\n";
  const { clean, text } = merge("both.txt", base, fork, upstream);
  assert.equal(clean, true);
  assert.equal(text, "a = 10\nb = 'kovalio'\nc = 30\n");
});

test("a fork change overlapping an upstream change is left for a person", () => {
  const base = "timeout = 30 // openship default\n";
  const fork = "timeout = 60 // kovalio default\n";
  const upstream = "timeout = 45 // openship default\n";
  const { clean, text } = merge("conflict.txt", base, fork, upstream);
  assert.equal(clean, false);
  assert.match(text, /<<<<<<< conflict\.txt \(fork\)\ntimeout = 60/);
  assert.match(text, /timeout = 45 \/\/ kovalio default\n>>>>>>> conflict\.txt \(upstream, rebranded\)/);
});
