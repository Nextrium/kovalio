// Fork guard: linear-match.ts returns exactly what the regexes it replaces return,
// and stays fast on the inputs CodeQL reported. See FORK_PATCHES.md.
import { describe, expect, it } from "vitest";
import { matchParenthesizedCall, matchTrailingField } from "./linear-match";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

/** Every string over `alphabet` up to `maxLen` characters. */
function* strings(alphabet: string[], maxLen: number): Generator<string> {
  let frontier = [""];
  yield "";
  for (let len = 1; len <= maxLen; len++) {
    frontier = frontier.flatMap((s) => alphabet.map((c) => s + c));
    yield* frontier;
  }
}

const asArray = (m: RegExpMatchArray | null) => (m ? [...m] : null);
const same = (a: string[] | null, b: string[] | null) => JSON.stringify(a) === JSON.stringify(b);
// Exhaustive runs check hundreds of thousands of strings; one assertion at the end.
const EXHAUSTIVE_TIMEOUT_MS = 120_000;

// Whitespace, every kind of line terminator, and plain text.
const TAIL_ALPHABET = [" ", "\t", "\r", "\n", LINE_SEPARATOR, "a"];

describe("matchTrailingField equals prefix + \\s*(.+)$", () => {
  const prefixes = [
    /^\s*startCommand:/,
    /^\s*buildCommand:/,
    /^\s*(?:-\s*)?key:/,
    /^\s*value:/,
    /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=/,
  ];
  const leads = ["", "  ", "- ", "\t-", "startCommand:", " key:", "- key:", "value:", "A=", " a.b = ", "x"];

  for (const prefix of prefixes) {
    it(
      `for ${prefix}`,
      () => {
        const original = new RegExp(String.raw`${prefix.source}\s*(.+)$`);
        const mismatches: string[] = [];
        for (const lead of leads)
          for (const rest of strings(TAIL_ALPHABET, 6)) {
            const line = lead + rest;
            if (!same(matchTrailingField(line, prefix), asArray(line.match(original)))) mismatches.push(line);
          }
        expect(mismatches.slice(0, 5)).toEqual([]);
      },
      EXHAUSTIVE_TIMEOUT_MS,
    );
  }
});

describe("matchParenthesizedCall equals /^\\((.*)\\)[\\t ]*(?:#.*)?$/", () => {
  it(
    "on every string up to length 7",
    () => {
      const original = /^\((.*)\)[\t ]*(?:#.*)?$/;
      const mismatches: string[] = [];
      for (const s of strings(["(", ")", "#", " ", "\t", LINE_SEPARATOR, "a"], 7))
        if (!same(matchParenthesizedCall(s), asArray(s.match(original)))) mismatches.push(s);
      expect(mismatches.slice(0, 5)).toEqual([]);
    },
    EXHAUSTIVE_TIMEOUT_MS,
  );
});

describe("linear on CodeQL's trigger inputs", () => {
  const BOUND_MS = 250;
  const N = 200_000;
  const timed = (fn: () => unknown) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  for (const tail of ["", "x", "\r", LINE_SEPARATOR, " "]) {
    it(`trailing field, spaces then ${JSON.stringify(tail)}`, () => {
      expect(timed(() => matchTrailingField(`value:${" ".repeat(N)}${tail}`, /^\s*value:/))).toBeLessThan(BOUND_MS);
      expect(
        timed(() => matchTrailingField(`A=${" ".repeat(N)}${tail}`, /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=/)),
      ).toBeLessThan(BOUND_MS);
    });
  }
  it("parenthesized call, repeated )# then U+2028", () => {
    expect(timed(() => matchParenthesizedCall(`(${")#".repeat(N / 2)}${LINE_SEPARATOR}`))).toBeLessThan(BOUND_MS);
  });
});
