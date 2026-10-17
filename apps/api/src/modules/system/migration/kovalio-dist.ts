/**
 * Locate the prebuilt Kovalio source release used by installation preflight.
 * Thin wrapper over the shared platform release resolver — this file only pins the
 * kovalio-specific spec (repo, asset name, repo-local dev path) and preserves
 * the typed KovalioReleaseDistMissingError the wizard controller catches.
 */

import type { ReleaseSource } from "@repo/core";
import {
  ReleaseDistMissingError,
  apiRootPath,
  readApiVersion,
  resolveReleaseDist,
  resolveReleaseDistOrNull,
  type ReleaseDistSpec,
} from "@repo/platform/engine/lib/release-resolver";

/**
 * The asset name is a literal, and `linux-amd64` in it is NOT a host assumption.
 *
 * `.github/workflows/release.yml` packages exactly one kovalio artifact per tag —
 * `kovalio-${TAG}-linux-amd64.tar.gz` — and its payload is architecture-agnostic:
 * TypeScript the target runs under Bun, plus a prebuilt Next standalone. The only
 * native resolution happens in `bun install --production` on the target itself
 * (see the README emitted by apps/api/scripts/build-release.ts). So the suffix is the
 * publisher's naming, and templating `{os}-{arch}` here would ask GitHub for
 * `kovalio-v0.6.1-linux-arm64.tar.gz` — a file no release contains — turning a
 * working arm64 install into `ReleaseDistMissingError`.
 *
 * If kovalio ever ships per-arch artifacts, the template and the workflow's
 * ARTIFACT name change together; `renderAssetName` already supports the placeholders.
 */
const KOVALIO_SOURCE: ReleaseSource = {
  mode: "github",
  repo: "Nextrium/kovalio",
  assetTemplate: "kovalio-{tag}-linux-amd64.tar.gz",
};

function kovalioDistSpec(): ReleaseDistSpec {
  return {
    name: "kovalio",
    version: readApiVersion(),
    source: KOVALIO_SOURCE,
    envOverride: "KOVALIO_RELEASE_DIST_PATH",
    repoLocalPath: apiRootPath("release-dist"),
  };
}

export class KovalioReleaseDistMissingError extends Error {
  readonly code = "KOVALIO_RELEASE_DIST_MISSING" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KovalioReleaseDistMissingError";
  }
}

/** Resolve (download on miss) the Kovalio release dist directory. */
export async function resolveKovalioDistDir(): Promise<string> {
  try {
    return (await resolveReleaseDist(kovalioDistSpec())).dir;
  } catch (err) {
    if (err instanceof ReleaseDistMissingError) {
      throw new KovalioReleaseDistMissingError(
        `${err.message} Build it with \`bun run --cwd apps/api build-release\` or set KOVALIO_RELEASE_DIST_PATH.`,
        { cause: (err as { cause?: unknown }).cause },
      );
    }
    throw err;
  }
}

/** Non-throwing, no-download variant for preflight. */
export function resolveKovalioDistDirOrNull(): string | null {
  return resolveReleaseDistOrNull(kovalioDistSpec());
}
