# CodeQL triage — PR #2 (upstream sync to v0.9.2)

CodeQL reported 289 open alerts on the synced branch, 83 of them new in PR #2. All of
them are in upstream (oblien/openship) code that the sync brought in, not in <!-- brand-guard:keep -->
fork-only code. This file records the verdict for each group and what was done, so the
remaining alerts can be dismissed in the Security tab with a reason.

**Correction (follow-up PR):** the first pass fixed only one of two ambiguities in the
`render.yaml` parser and its fork test used an input that missed the second. Fork tests
now use the exact trigger shapes CodeQL reports (prefix, long run, failing last
character), and run against the pre-fix code to confirm they fail.

Fixes live on `security/codeql-fixes` and `security/redos-followup` and are listed in [FORK_PATCHES.md](../FORK_PATCHES.md),
each pinned by a fork test that fails without it.

## Where the alerts are

| Location | Alerts |
|---|---|
| Shipped runtime code | 166 |
| Tests and fixtures | 56 |
| CI workflows | 42 |
| Build and release scripts | 25 |

## Real, fixed

| Alert | Where | Impact | Fix | Measured |
|---|---|---|---|---|
| Polynomial ReDoS (`js/polynomial-redos`) | public `/api/cloud-waitlist` email check | **Unauthenticated** request stalls the dashboard server | length ≤ 254 before the regex | 200 KB body: **106 s** before, < 250 ms after |
| Polynomial ReDoS | ~70 files: trailing-run trims (`/\/+$/`, `/^\/+\|\/+$/g`, `/\.+$/`, `/[ \t]+#+$/`) on paths, hostnames, image refs, changelogs | Authenticated users (project settings, volume paths, domains) can stall the API | lookbehind rewrite, applied and enforced by the overlay | 20 KB: 1–2 s before, ~0 ms after; identical results on all 223,948 strings up to length 6 |
| Polynomial ReDoS | `render.yaml` (`startCommand:`, `buildCommand:`, `key:`, `value:`) and `railway.toml` (`key = value`) parsers | Repository content (e.g. a PR preview) can stall a deploy | `matchTrailingField` in the fork-only `packages/core/src/linear-match.ts`, identical to `prefix\s*(.+)$` on every string checked | 100 KB ending in a lone `\r` or U+2028: **12–23 s** before |
| Polynomial ReDoS | Gemfile `ruby(...)` call parser | Same | `matchParenthesizedCall`, identical to the regex on every string up to length 7 | 20 KB ending in U+2028: 377 ms before, quadratic |
| Polynomial ReDoS | service-label and static-root slugs (`/^-+\|-+$/g`) | Service names and hostnames | lookbehind rewrite, added to the overlay | 20 KB of `-`: 1.6 s before |
| Polynomial ReDoS (new in v0.9.3) | build-cache target scan in `docker-build-plan.ts` | A project's build command lands in the scanned Dockerfile | `cacheMountTargets` in the fork-only `packages/adapters/src/runtime/cache-mount-targets.ts`, identical to the regex on all token sequences up to length 5 and 20,000 random recipes | build command of 20,000 repeated `--mount=type=cache,`: **14.3 s** before |
| Polynomial ReDoS | `isLoopbackHost` trailing dots | Same | lookbehind rewrite | 50 KB: **5.2 s** before |
| Polynomial ReDoS | ACME email check | Admin-set value | length ≤ 254 | |
| Insecure randomness (`js/insecure-randomness`) | setup, edge-consent and container-apply session ids | Ids were a timestamp plus 6 random characters, and `respond`/`events` look a session up by id alone | `crypto.randomUUID()` | |
| Double escaping (`js/double-escaping`) | DMARC XML entity decoder | `&amp;lt;` decoded to `<` | single-pass decode | |
| Command-line injection (`js/command-line-injection`, critical) | CLI `install` on Windows | A `'` in a path broke the PowerShell unzip command (injectable); an `&` in the profile path split `cmd /c start` | paths via environment variables and `-LiteralPath`; launch the exe directly | path `it's [x] & y`: old command fails to parse, new one extracts |

## Real, accepted (input comes from the operator's own server)

| Alert | Where | Why accepted |
|---|---|---|
| Polynomial ReDoS | toolchain version parsing (`node --version` and similar output) | Output of tools on the managed server |
| Polynomial ReDoS | certbot `certonly` output, `Detail:`/`Hint:` diagnosis, renewal `.conf` parsing | Root-owned files and certbot's own output |
| Polynomial ReDoS | `container .* is paused` on Docker error text | Bounded stderr; 200 ms at 20 KB |
| File-system race (`js/file-system-race`) | data-transfer export (`stat` then `readFile` of an admin-set SSH key path) | Exploiting the window needs write access to that path, which is already admin-level |
| File-system race | data-transfer staged payload | Re-reads a file inside its own `mkdtemp` (0700) directory |

## False positives (dismiss with reason)

| Alert | Count | Why |
|---|---|---|
| Command-line injection (critical) | 1 | `node-bootstrap.ts` re-executes the CLI with an argument array, no shell |
| Command-line injection | 2 | AppImage launch: `spawn` without a shell |
| Shell command built from input (`js/shell-command-constructed-from-input`) | 26 | Values are `sq()`-quoted where assigned, numeric (ports, pids, line counts), base64, or fixed constants; CodeQL doesn't follow quoting through variables. `bare.ts` runs the project's own install command by design |
| Indirect command-line injection | 7 | Executors run commands the platform composes; the alert is at the executor boundary |
| Improper code sanitization (`js/bad-code-sanitization`, new in v0.9.3) | 2 | `node-output.ts`: options are `JSON.stringify`-ed into a script that is base64-encoded and shell-quoted before `node -e`; JSON is valid JavaScript on Node 22+, and no HTML is involved |
| Polynomial ReDoS, `semver` range | 1 | Each comparator comes from splitting on `/\s+/`, so it never holds the whitespace the trigger needs |
| Polynomial ReDoS, `env-file` trailing backslashes | 1 | Measured 0 ms on CodeQL's trigger |
| Polynomial ReDoS, already fixed | ~4 | CodeQL still reports the old shape at lines rewritten to `matchTrailingField` or a lookbehind |
| Insufficient password hash (`js/insufficient-password-hash`) | 4 | SHA-256 of ids, OAuth state and file contents, not passwords |
| Incomplete URL substring sanitization | most | UI provider detection from a user's own endpoint; PostHog host is an exact-match allow-list |
| XSS through DOM | 1 | `href` has a fixed `https://github.com/` prefix |
| User-controlled bypass | 2 | OAuth callback pages display the error; the server validates `state` |
| File-system race | 13 | CLI and build scripts on the user's own machine; no privilege boundary |
| Anything in tests and fixtures | 56 | Not shipped |

## Not fixed in the fork

| Alert | Count | Why |
|---|---|---|
| Unpinned action tags, missing workflow permissions | 44 | Hardening in upstream-owned workflows: pinning here would conflict on every sync. Better proposed upstream. Fork workflows (`fork-guard.yml`, `upstream-sync.yml`) set permissions explicitly. |

## Upstream

The real findings are worth reporting to oblien/openship, especially the public <!-- brand-guard:keep -->
waitlist ReDoS and the session ids. Once fixed upstream, the matching fork patches can
be dropped (the merge driver will show them as no-ops).
