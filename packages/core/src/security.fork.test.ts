// Fork guard: Kovalio's ReDoS fixes in upstream-owned core code. See FORK_PATCHES.md.
// Each input below took seconds before the fix (quadratic backtracking); a linear
// regex handles it in well under the bound.
import { describe, expect, it } from "vitest";
import { renderMetadataParser } from "./metadata/render";
import { isLoopbackHost } from "./network";

const BOUND_MS = 250;
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

describe("render.yaml envVars key parsing", () => {
  it("parses keys with and without the list dash", () => {
    const parsed = renderMetadataParser.parse({
      "render.yaml": [
        "services:",
        "  - type: web",
        "    envVars:",
        "      - key: FIRST",
        "        value: one",
        "      key: SECOND",
        "        value: two",
      ].join("\n"),
    });
    expect(parsed?.env).toMatchObject({ FIRST: "one", SECOND: "two" });
  });

  it("stays linear on a long whitespace line from an untrusted repository", () => {
    const { ms } = timed(() => renderMetadataParser.parse({ "render.yaml": `${" ".repeat(50_000)}x` }));
    expect(ms).toBeLessThan(BOUND_MS);
  });
});

describe("isLoopbackHost trailing-dot normalization", () => {
  it("still ignores trailing dots", () => {
    expect(isLoopbackHost("localhost.")).toBe(true);
    expect(isLoopbackHost("127.0.0.1...")).toBe(true);
    expect(isLoopbackHost("example.com.")).toBe(false);
  });

  it("stays linear on a long run of dots", () => {
    const { value, ms } = timed(() => isLoopbackHost(`a${".".repeat(50_000)}x`));
    expect(value).toBe(false);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
