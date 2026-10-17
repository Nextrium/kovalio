// Fork guard: Kovalio's ReDoS fixes in upstream-owned core code. See FORK_PATCHES.md.
// Inputs follow the shapes CodeQL reported (prefix, a long repeated run, then a
// character that makes the match fail). Each took seconds before the fix; with it
// they finish well under the bound.
import { describe, expect, it } from "vitest";
import { railwayMetadataParser } from "./metadata/railway";
import { renderMetadataParser } from "./metadata/render";
import { isLoopbackHost } from "./network";
import { normalizeServiceLabel } from "./service-routing";

const BOUND_MS = 250;
const N = 100_000;
// Characters that end a "line" for `.` but survive splitting on \r?\n.
const FAILING_TAILS = ["\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

describe("render.yaml parsing", () => {
  it("parses commands and envVars, with and without the list dash", () => {
    const parsed = renderMetadataParser.parse({
      "render.yaml": [
        "services:",
        "  - type: web",
        "    startCommand: npm start",
        "    envVars:",
        "      - key: FIRST",
        "        value: one",
        "      key: SECOND",
        "        value: two",
      ].join("\n"),
    });
    expect(parsed?.startCommand).toBe("npm start");
    expect(parsed?.env).toMatchObject({ FIRST: "one", SECOND: "two" });
  });

  for (const field of ["startCommand:", "buildCommand:", "key:", "value:"])
    for (const tail of FAILING_TAILS)
      it(`stays linear on ${field} + spaces + ${JSON.stringify(tail)} from an untrusted repository`, () => {
        const { ms } = timed(() => renderMetadataParser.parse({ "render.yaml": `${field}${" ".repeat(N)}${tail}` }));
        expect(ms).toBeLessThan(BOUND_MS);
      });
});

describe("railway.toml parsing", () => {
  it("still reads key = value pairs", () => {
    const parsed = railwayMetadataParser.parse({ "railway.toml": '[deploy]\nstartCommand = "node server.js"\n' });
    expect(parsed?.startCommand).toBe("node server.js");
  });

  for (const tail of FAILING_TAILS)
    it(`stays linear on A= + spaces + ${JSON.stringify(tail)}`, () => {
      const { ms } = timed(() => railwayMetadataParser.parse({ "railway.toml": `A=${" ".repeat(N)}${tail}` }));
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
    const { value, ms } = timed(() => isLoopbackHost(`a${".".repeat(N)}x`));
    expect(value).toBe(false);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});

describe("service label normalization", () => {
  it("still trims edge dashes", () => {
    expect(normalizeServiceLabel("--My Service--")).toBe("my-service");
  });

  it("stays linear on a long run of dashes", () => {
    const { ms } = timed(() => normalizeServiceLabel(`a${"-".repeat(N)}x`));
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
