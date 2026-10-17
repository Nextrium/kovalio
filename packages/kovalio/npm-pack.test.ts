import { describe, expect, it } from "bun:test";
import { readPackedArchive } from "./npm-pack";

const expected = { name: "kovalio", version: "0.8.0" };
const archive = { ...expected, filename: "kovalio-0.8.0.tgz", size: 100, unpackedSize: 400 };

describe("npm pack reports", () => {
  it.each([[archive], { kovalio: archive }].map(report => ({ report })))("accepts npm's supported report shapes (%j)", ({ report }) => {
    expect(readPackedArchive(JSON.stringify(report), expected)).toEqual(archive);
  });

  it.each([
    [], {}, null, [archive, archive], { kovalio: archive, unexpected: archive },
    { error: { code: "E404" } },
    [{ ...archive, name: "another-package" }],
    [{ ...archive, version: "0.7.0" }],
    [{ ...archive, filename: "../outside.tgz" }],
    [{ ...archive, filename: "/outside.tgz" }],
    [{ ...archive, filename: "kovalio.tar" }],
    [{ ...archive, size: 0 }],
    [{ ...archive, size: "100" }],
    [{ ...archive, unpackedSize: -1 }],
  ].map(report => ({ report })))("rejects missing, ambiguous or mismatched packages (%j)", ({ report }) => {
    expect(() => readPackedArchive(JSON.stringify(report), expected)).toThrow();
  });
});
