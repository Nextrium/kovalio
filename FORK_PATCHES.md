# Kovalio fork patches

Kovalio is a fork of [oblien/openship](https://github.com/oblien/openship) <!-- brand-guard:keep -->.
This file lists every change the fork makes to upstream-owned code, and the fork
test that proves it still holds after an upstream sync.

## How syncs work

- **Every Sunday**, [upstream-sync.yml](.github/workflows/upstream-sync.yml) merges
  upstream into `sync/upstream` and opens a PR into `develop`. It skips the run while a sync PR is
  still open.
- **Branding is factored out of the merge.** The [merge driver](scripts/brand-merge-driver.mjs)
  applies the overlay to upstream's side first, so only real changes are compared.
- **A conflict means a fork change overlaps an upstream change.** The sync stops and
  opens an issue. Nothing picks a winner automatically. Resolve it locally:
  `bash scripts/sync-upstream.sh`, decide each conflict, then commit and push.
- **The required Fork guard check** ([fork-guard.yml](.github/workflows/fork-guard.yml))
  runs on every PR. It fails if branding regressed, the sync tooling broke, or a
  fork patch below was undone.

## Adding a patch

1. Make the change in upstream-owned code.
2. Add a `*.fork.test.ts` file next to it that fails without the change. Fork test
   files exist only in the fork, so upstream never edits or deletes them.
3. Add a row below.
4. Consider proposing the fix upstream, so the patch can eventually be dropped.

## Patches

| Patch | Upstream-owned file | Fork test |
|---|---|---|
| Brand overlay: Kovalio names, domains, `ghcr.io/nextrium` images, encoded sources | all files | `scripts/test/rebrand.test.mjs`, Fork guard branding check |
| `wrapText` keeps backtick-quoted commands whole | `packages/core/src/utils.ts` | `packages/core/src/utils.fork.test.ts` |
| Retired WordPress and Odoo recipes: accept the Kovalio-branded recipe hash in `replacesBuilds` | `packages/core/src/apps/catalog/{wordpress,odoo}.json`, `catalog.json` | `scripts/catalog-image-repair.fork.test.ts` |
| ReDoS: trailing-run regexes (`/\/+$/`, `\|\/+$/`, `/\.+$/`, `/-+$/`, `\|-+$/`, `/[ \t]+#+$/`) rewritten with a lookbehind, by the overlay (`hardenText`) | ~80 files | overlay `--check` in Fork guard, `packages/core/src/security.fork.test.ts` |
| ReDoS: `render.yaml` and `railway.toml` field parsers (`prefix\s*(.+)$`) use `matchTrailingField` | `packages/core/src/metadata/render.ts`, `railway.ts` | `packages/core/src/linear-match.fork.test.ts`, `security.fork.test.ts` |
| ReDoS: Gemfile `ruby(...)` call parser uses `matchParenthesizedCall` | `packages/core/src/languages/ruby.ts` | `packages/core/src/linear-match.fork.test.ts` |
| ReDoS: build-cache target scan uses `cacheMountTargets` (since v0.9.3) | `packages/adapters/src/runtime/docker-build-plan.ts` | `packages/adapters/src/runtime/cache-mount-targets.fork.test.ts` |
| ReDoS: email checks bounded to 254 characters (public waitlist, ACME email) | `apps/dashboard/src/app/api/cloud-waitlist/route.ts`, `packages/adapters/src/infra/nginx.ts` | `apps/dashboard/src/security.fork.test.ts` |
| Session ids use `randomUUID()` instead of 6 `Math.random` characters | `edge-consent-session.ts`, `setup-session.ts`, `server-container-session.ts` | `apps/api/src/security.fork.test.ts` |
| DMARC XML entities decode once (no `&amp;lt;` → `<`) | `apps/api/src/modules/mail/dmarc/xml-parser.ts` | `apps/api/src/security.fork.test.ts` |
| CLI installer passes paths to PowerShell and the app launch without shell re-parsing | `apps/cli/src/commands/install.ts` | manual (Windows path with `'`, `[`, `&`; see docs/codeql-triage.md) |
| Dashboard `settings` untranslated baseline +1 (Arabic "Kovalio Cloud" label) | `apps/dashboard/src/i18n/i18n-parity.test.ts` | the parity test itself |
