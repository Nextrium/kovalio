// Fork guard: Kovalio patches to upstream-owned code in utils.ts. See FORK_PATCHES.md.
import { describe, expect, it } from "vitest";
import { wrapText } from "./utils";

describe("wrapText keeps backtick-quoted commands whole", () => {
  const remedy =
    "so there is no address to reach the host at and nothing has been dialed. Re-run `kovalio up` " +
    "to provision the host channel. `kovalio doctor` reports whether it worked.";

  it.each([20, 40, 60, 84, 88, 100])("never splits a quoted command at width %i", (width) => {
    for (const line of wrapText(remedy, width)) {
      expect((line.match(/`/g)?.length ?? 0) % 2).toBe(0);
    }
  });

  it("still wraps plain prose greedily", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("lets an over-long quoted command overflow rather than break", () => {
    expect(wrapText("run `kovalio deploy --all --force` now", 10)).toEqual([
      "run",
      "`kovalio deploy --all --force`",
      "now",
    ]);
  });
});
