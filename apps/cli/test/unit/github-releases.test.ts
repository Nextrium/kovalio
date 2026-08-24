import { describe, expect, it } from "vitest";

import { assetUrl, RELEASES, REPO } from "../../src/lib/github-releases";

describe("github-releases constants", () => {
  it("points at the oblien/kovalio releases page", () => {
    expect(REPO).toBe("oblien/kovalio");
    expect(RELEASES).toBe("https://github.com/Nextrium/kovalio/releases");
  });
});

describe("assetUrl", () => {
  it("builds a release download URL from a tag + asset name", () => {
    expect(assetUrl("v1.2.3", "Kovalio-arm64.dmg")).toBe(
      "https://github.com/Nextrium/kovalio/releases/download/v1.2.3/Kovalio-arm64.dmg",
    );
  });
});
