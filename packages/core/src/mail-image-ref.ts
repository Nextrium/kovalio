import { buildImageRef } from "./image-ref";

/**
 * THE single precedence for the mail-engine container image reference, shared by
 * `pinnedMailImage` (apps/api) and `resolveMailImage` (packages/adapters) so the
 * two can never drift — the same trap `buildEdgeImageRef` fixed for the edge. Order:
 *
 *   explicit → KOVALIO_MAIL_IMAGE → injectedDefault → `<registry>/kovalio-mail:<tag>`
 *
 * where `registry = KOVALIO_IMAGE_REGISTRY || DEFAULT_IMAGE_REGISTRY` and
 *       `tag      = KOVALIO_MAIL_TAG || KOVALIO_VERSION || fallbackTag || "latest"`.
 *
 * `KOVALIO_MAIL_TAG` sits ahead of `KOVALIO_VERSION` on purpose: the mail engine
 * bundles upstream daemons (Postfix/Dovecot/etc.) whose security cadence differs
 * from the kovalio release, so an operator can float the engine independently.
 * `fallbackTag` is the only per-layer difference (apps/api pins APP_VERSION; the
 * version-agnostic adapters layer omits it and relies on the injected default).
 *
 * The resolution order lives in `buildImageRef`, shared with `buildEdgeImageRef`;
 * only the image name + these two env overrides differ.
 */
export function buildMailImageRef(opts?: {
  explicit?: string | null;
  injectedDefault?: string | null;
  fallbackTag?: string;
}): string {
  return buildImageRef(opts, {
    name: "kovalio-mail",
    imageOverride: process.env.KOVALIO_MAIL_IMAGE,
    tagOverride: process.env.KOVALIO_MAIL_TAG,
  });
}
