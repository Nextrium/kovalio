// Fork guard: fork installs store the rebranded retired recipes the fork's catalog
// served, so each one's hash must be accepted by `replacesBuilds`. See FORK_PATCHES.md.
import { describe, expect, it } from "bun:test";
import catalog from "../packages/core/src/apps/catalog.json";
import { catalogBuildRecipeHash } from "./catalog-image-repair";
import retiredBuilds from "./fixtures/catalog-retired-builds.json";

const replacesBuildsFor = (app: string): string[] =>
  (catalog as { apps: Array<{ id?: string; slug?: string; services?: Array<{ replacesBuilds?: string[] }> }> }).apps
    .filter((t) => t.id === app || t.slug === app)
    .flatMap((t) => t.services ?? [])
    .flatMap((s) => s.replacesBuilds ?? []);

describe("rebranded retired catalog recipes stay repairable", () => {
  for (const [app, build] of Object.entries(retiredBuilds)) {
    it(`accepts the Kovalio-branded ${app} recipe`, () => {
      const hash = catalogBuildRecipeHash(build);
      expect(hash).not.toBeNull();
      expect(replacesBuildsFor(app)).toContain(hash!);
    });
  }
});
