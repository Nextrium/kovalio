/** Immutable fixtures from main f9cf8890. Existing purchases must not be
 * regenerated from the current catalog in renewal/compatibility tests. */
import snapshots from "../fixtures/cloud-offers-v5.json";
import { planLimitsSchema } from "@repo/core";
import type { OblienOffer } from "@repo/platform/engine/lib/oblien-billing-api";
type Tier = keyof typeof snapshots;
export function savedOffer(tier: Tier, _interval: "monthly" = "monthly"): OblienOffer {
  return structuredClone(snapshots[tier].offer) as OblienOffer;
}
export const savedLimits = (tier: Tier) =>
  planLimitsSchema.parse(structuredClone(snapshots[tier].limits));
export function savedMetadata(
  tier: Tier,
  organizationId: string,
  namespace: string,
): Record<string, string> {
  return {
    kovalio_plan: tier,
    kovalio_offer_version: "5",
    kovalio_organization: organizationId,
    kovalio_namespace: namespace,
    kovalio_limits: JSON.stringify(savedLimits(tier)),
  };
}
