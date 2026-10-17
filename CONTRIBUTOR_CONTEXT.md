# Kovalio contributor context

Shared context for everyone working on this repository. Read it before your first PR;
it explains things you can't see from the code alone. Last reviewed 2026-10-17.

## 1. What this repository is

- **Kovalio is a fork.** It tracks [oblien/openship](https://github.com/oblien/openship), an <!-- brand-guard:keep -->
  open-source, self-hostable deployment platform licensed Apache-2.0. Nextrium maintains
  the fork at [Nextrium/kovalio](https://github.com/Nextrium/kovalio).
- **Almost all of the code is upstream's.** The fork's own work is small and listed in
  [FORK_PATCHES.md](FORK_PATCHES.md): the Kovalio branding, the sync tooling, security
  fixes, and a few compatibility fixes.
- **Upstream keeps moving fast** (about 1,400 commits in the six months before the first
  sync). Staying close to upstream is a design goal: every change we make to upstream
  code is a change we must carry through every future sync.

The product itself (what it does, how its parts fit) is described in [README.md](README.md),
[docs/](docs/) and [CONTRIBUTING.md](CONTRIBUTING.md). Those are upstream's documents with
the names rebranded; see section 9 for what in them is not yet true for Kovalio.

## 2. Where things stand (2026-10-17)

| Area | State |
|---|---|
| Upstream base on `main` | v0.9.2 (`480f17abf`) plus fork work |
| Next sync | PR #10 brings v0.9.3 (`2e42298df`, 43 commits). CI passes; CodeQL found 3 new alerts in the new upstream code (see section 8) |
| Releases | None yet. No desktop downloads, no `kovalio` npm package, no `ghcr.io/nextrium/kovalio-*` images |
| Install domain, docs site | `get.kovalio.nextrium.org` doesn't resolve; `nextrium.org/docs` returns 404 |
| CodeQL on `main` | 59 open alerts, all in categories not reviewed yet; 172 dismissed with reasons (see [docs/codeql-triage.md](docs/codeql-triage.md)) |
| Required checks on `main` | Fork guard, Typecheck, Test |

## 3. Ground rules

1. **Don't hand-edit branding.** The overlay ([scripts/rebrand-kovalio.mjs](scripts/rebrand-kovalio.mjs))
   owns it. Write code as you normally would; if upstream naming slips in, run
   `node scripts/rebrand-kovalio.mjs`.
2. **Prefer fork-only files.** A new file that upstream doesn't have can never conflict
   in a sync. Put fork logic there and touch upstream files as little as possible (one
   import and one call site is ideal; see `packages/core/src/linear-match.ts`).
3. **Every change to upstream-owned code is a fork patch, and every fork patch needs a
   fork test.** Add a `*.fork.test.ts` file (fork-only, so upstream can't edit or delete
   it) that fails without your change, and add a row to [FORK_PATCHES.md](FORK_PATCHES.md).
   Prove the test fails against the old code before you rely on it.
4. **Sync conflicts are human decisions.** Nothing in the tooling picks a winner. When
   a sync stops, someone decides each conflict and writes down why (section 5).
5. **Signed commits only.** `main` requires verified signatures. Configure commit signing
   (SSH or GPG) before your first commit.
6. **Merge commits only.** The ruleset allows only "Create a merge commit" into `main`.
   Squash or rebase would cut the link to upstream history and make the next sync
   re-merge everything.

## 4. Branding: how the overlay works

The overlay rewrites the repository from upstream's names to Kovalio's. It runs after every
sync and is checked on every PR.

- **What it changes:**
  - Names in every casing (`Openship` → `Kovalio`, `OPENSHIP` → `KOVALIO`). <!-- brand-guard:keep -->
  - Domains (`openship.io` → `nextrium.org`, `app.` → `kovalio.nextrium.org`). <!-- brand-guard:keep -->
  - GitHub URLs → `Nextrium/kovalio`.
  - Product images: `ghcr.io/oblien/openship-*` → `ghcr.io/nextrium/kovalio-*`, and the <!-- brand-guard:keep -->
    default registry `ghcr.io/oblien` → `ghcr.io/nextrium`. Other images upstream hosts there <!-- brand-guard:keep -->
    (for example `mindwire-*`) are left alone.
  - Paths: any file or folder with the old name is renamed.
  - Encoded sources: base64 literals that decode to branded text are re-encoded, which
    keeps generated files such as `packages/adapters/src/infra/lua-embedded.ts` consistent
    with their sources.
- **What it never touches:** files git ignores, binary files, the sync tooling itself
  (it must name the real upstream), and any line containing `brand-guard:keep`. Use that
  marker when a line must name upstream, for attribution for example.
- **Checking:** `node scripts/rebrand-kovalio.mjs --check` lists leftovers and exits 1.
  The Fork guard runs it on every PR.
- **One known limitation:** bare repo slugs such as `oblien/openship` become <!-- brand-guard:keep -->
  `oblien/kovalio`, a repo that doesn't exist. Upstream's tests build slugs from parts,
  so a blanket remap breaks them. Full GitHub URLs are remapped correctly. Fix individual
  release-source slugs by hand when you find them.

The overlay also carries the **ReDoS hardening** (section 7): it's deterministic and
meaning-preserving like branding, so it lives in the same pipeline.

## 5. Upstream syncs

- **Schedule:** [upstream-sync.yml](.github/workflows/upstream-sync.yml) runs every Sunday
  at 00:00 UTC, or on demand: `gh workflow run upstream-sync.yml --repo Nextrium/kovalio -f base=main`.
- **What it does:** runs [scripts/sync-upstream.sh](scripts/sync-upstream.sh), which merges
  upstream into `sync/upstream` using a brand-aware merge driver
  ([scripts/brand-merge-driver.mjs](scripts/brand-merge-driver.mjs)). The driver applies the
  overlay to upstream's side before the three-way merge, so branding never shows up as a
  conflict. Only real overlaps between a fork change and an upstream change do.
- **Clean merge:** it applies and verifies the overlay, pushes `sync/upstream`, and opens a
  PR into `main`. CI and the Fork guard then run on that PR. Review the upstream changes
  and the checks, then merge with a merge commit.
- **Conflict:** the run fails and opens (or updates) an issue titled "Upstream sync needs
  a decision", listing the files. To resolve:

  ```bash
  bash scripts/sync-upstream.sh main     # reproduces the same merge, leaves conflicts in place
  # decide each conflict, then:
  git add -A && node scripts/rebrand-kovalio.mjs && node scripts/rebrand-kovalio.mjs --check
  git add -A && git commit --no-edit
  git push --force origin sync/upstream  # then open a PR into main
  ```

  Each conflict is a fork change overlapping an upstream change. Before choosing, check
  [FORK_PATCHES.md](FORK_PATCHES.md) for why the fork's side exists, and say in the PR
  which side you kept and why.
- **Open sync PR:** while one is open, later runs skip, so hand-resolved work is never
  overwritten. Upstream commits wait for the next run.
- **Token:** the `SYNC_TOKEN` secret is a fine-grained token with Contents, Pull requests
  and Workflows set to read and write on this repository. The organization forbids
  Actions-created PRs, which is why `GITHUB_TOKEN` isn't used.

## 6. CI and the Fork guard

- **Required on `main`:** **Fork guard**, **Typecheck** and **Test**. Test is upstream's
  aggregate gate over every test suite and the Actions runs.
- **Fork guard** ([fork-guard.yml](.github/workflows/fork-guard.yml), [scripts/fork-guard.mjs](scripts/fork-guard.mjs))
  checks three things:
  1. branding and hardening (`rebrand-kovalio.mjs --check`);
  2. the sync tooling's own tests (`scripts/test/`), including a scratch-repository test
     proving branded edits merge cleanly and real overlaps stop for a person;
  3. every `*.fork.test.*` file, run with its own package's test runner.

  Run it locally with `node scripts/fork-guard.mjs`.
- **Upstream's CI** ([ci.yml](.github/workflows/ci.yml)) stays upstream's. Don't add fork
  jobs there: a sync conflict could drop them. Add them to a fork-only workflow file.
- **Checks that fail for known reasons:**
  - *Catalog image availability:* two Convex images pinned by upstream don't exist on
    GHCR, and `ghcr.io/nextrium/kovalio-webmail` isn't published until the first release.
  - *CodeQL:* fails while new alerts are open, often in incoming upstream code.

  Neither is required.

## 7. Security work in the fork

- **Triage record:** [docs/codeql-triage.md](docs/codeql-triage.md) records every CodeQL
  finding group: fixed, accepted, false positive, or not yet reviewed, with
  measurements. Dismissals in the Security tab point to it.
- **Policy:** dismiss an alert only after reading the code. The 59 alerts still open on
  `main` are unreviewed, not accepted.
- **ReDoS fixes, two mechanisms:**
  - **Trailing-run regexes** (`/\/+$/`, `/^\/+|\/+$/g`, `/\.+$/`, `/-+$/` and similar)
    are rewritten by the overlay with a lookbehind. They give identical results and run in
    linear time, and `--check` flags any new copy upstream adds.
  - **Other slow patterns** use exact linear functions in the fork-only
    [packages/core/src/linear-match.ts](packages/core/src/linear-match.ts), compared against
    the original regex on millions of generated strings.
- **When you fix a ReDoS:** measure it with the input CodeQL describes (prefix, long
  repeated run, and a final character that makes the match fail). A test that uses a
  different shape can pass while the bug is still there; it happened once here.
- **Report real findings upstream too.** Once upstream fixes one, its fork patch becomes
  a no-op and can be dropped.

## 8. Open decisions

| Item | Notes |
|---|---|
| Sync PR #10 (v0.9.3) | CodeQL flagged `packages/adapters/src/runtime/docker-build-plan.ts:46`, a build-cache regex that is quadratic on a long repeated `--mount=type=cache,` (about 7.6 s on 200 KB; needs an authenticated user and slows that user's own build). The two `node-output.ts` alerts are false positives (JSON in a base64, shell-quoted `node -e` script). Options: merge as is and track it, or patch it as a fork patch with a fork test. |
| First release | Publishing a `v*.*.*` tag runs `docker-images.yml` and creates the images, desktop builds and CLI package the README already links to. |
| `SYNC_TOKEN` permissions | The first run pushed but couldn't open its PR: the token needs Pull requests set to read and write. |
| README | Still upstream's content (section 9). |
| Remaining CodeQL alerts | 59 unreviewed, mostly missing regex anchors and file/HTTP data flow. |

## 9. Upstream content that isn't true for Kovalio yet

The README, docs and in-app copy came from upstream and were rebranded word for word, so
some claims describe upstream's project:

- **Badges:** the Trendshift badge shows upstream's repository stats, and the npm badge
  points at a `kovalio` package that isn't published.
- **Install and download links:** these return 404 or don't resolve until the first
  release and DNS exist.
- **Status line** ("production-ready core"): this is upstream's assessment.
- **License line:** "Kovalio-authored code is licensed under Apache 2.0" was upstream's
  sentence about its own code. The fork should credit upstream there (with a
  `brand-guard:keep` line).

Treat any user-facing claim you touch with the same care.

## 10. Local development

- **Requirements:**
  - Node 22 or newer.
  - Bun as pinned in `package.json` (`packageManager`, currently 1.3.14).
  - Git with commit signing configured.
- **Install:** run `bun install` on the machine you develop on. A `node_modules` copied
  from another OS lacks the native binaries (esbuild, the Next.js SWC compiler) and
  nothing will start.
- **Run:**
  - `bun run dev` starts the API (:4000) and dashboard (:3001).
  - `bun run dev:web` starts the marketing site (:3009).
- **Windows:** the dev scripts use Unix shell syntax, so run them from Git Bash. You can
  also start an app directly, for example
  `cd apps/api && KOVALIO_AUTH_MODE=none node --env-file=.env --import tsx src/index.ts`.
  With `DEPLOY_MODE=desktop`, `KOVALIO_AUTH_MODE` must be set; `.env.example` sets it to
  `none`.
- **Database and cache:** the default `.env` uses a SQLite file (`DATABASE_URL=file:./dev.db`).
  Redis is optional locally; without it the API logs connection errors and falls back to
  in-process runners.
- **Compose files:**
  - The **root** `docker-compose.yml` is the control-plane stack (no edge, no Docker
    socket). It does not run deployed apps; don't patch it to.
  - To deploy apps locally, use `docker/docker-compose.yml` or `kovalio up`.
- **Line endings:** Windows checkouts convert to CRLF. Some upstream tests compare files
  byte for byte and fail locally on Windows only; CI on Linux is the reference.
  `scripts/sync-upstream.sh` is pinned to LF in `.gitattributes`.

## 11. Workflow for a change

1. **Branch** from `develop`: `feature/...`, `fix/...`, `security/...` or `docs/...`.
2. **Before pushing,** run:
   - `node scripts/fork-guard.mjs`;
   - the tests and `tsc --noEmit` of the packages you touched.
3. **Open a PR into `develop`.** Changes reach `main` through a `develop` → `main` PR.
4. **Write PR descriptions for reviewers:** what changed, why, how it was verified. If
   you touch upstream-owned code, link the FORK_PATCHES row and the fork test.
5. **Review:** `main` needs one approval from someone other than the last pusher.
   Organization admins can bypass, but use that knowingly; it also skips the review
   that would catch problems.

## 12. Map of fork-specific files

| Path | Purpose |
|---|---|
| [FORK_PATCHES.md](FORK_PATCHES.md) | Every change to upstream-owned code and its guarding test |
| [CONTRIBUTOR_CONTEXT.md](CONTRIBUTOR_CONTEXT.md) | This document |
| [docs/codeql-triage.md](docs/codeql-triage.md) | Security finding decisions and measurements |
| [scripts/rebrand-kovalio.mjs](scripts/rebrand-kovalio.mjs) | The overlay: branding plus ReDoS hardening, `--check` |
| [scripts/brand-merge-driver.mjs](scripts/brand-merge-driver.mjs) | Git merge driver that factors the overlay out of syncs |
| [scripts/sync-upstream.sh](scripts/sync-upstream.sh) | The one merge procedure, for CI and for people |
| [scripts/fork-guard.mjs](scripts/fork-guard.mjs) | Runs the Fork guard locally and in CI |
| `scripts/test/` | Tests for the overlay and the merge driver |
| `**/*.fork.test.ts` | Fork tests pinning each fork patch |
| [packages/core/src/linear-match.ts](packages/core/src/linear-match.ts) | Linear replacements for slow upstream regexes |
| [.github/workflows/upstream-sync.yml](.github/workflows/upstream-sync.yml) | Weekly sync |
| [.github/workflows/fork-guard.yml](.github/workflows/fork-guard.yml) | Required Fork guard check |
