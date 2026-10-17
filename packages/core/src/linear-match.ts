// Kovalio fork module: linear-time stand-ins for regexes that backtrack quadratically
// on hostile input (CodeQL js/polynomial-redos). Each function returns exactly what
// the regex it replaces returns; linear-match.fork.test.ts checks that against the
// original regex on every string up to a given length. See FORK_PATCHES.md.

/** Characters `.` does not match in a non-dotAll JavaScript regex. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * Exactly `line.match(new RegExp(prefix.source + String.raw`\s*(.+)$`))`, as
 * `[line, ...prefix groups, tail]`, without the quadratic backtracking between the
 * `\s*` and the `.+` when the match fails (e.g. a line ending in a lone `\r`).
 *
 * `prefix` must start with `^` and be able to match only one way, which holds when
 * it ends in a literal (`key:`, `=`) that its own repeats cannot consume.
 */
export function matchTrailingField(line: string, prefix: RegExp): string[] | null {
  const head = prefix.exec(line);
  if (!head || head.index !== 0) return null;
  const rest = line.slice(head[0].length);
  const body = rest.slice(/^\s*/.exec(rest)![0].length);
  let tail: string;
  if (body) {
    // `\s*` takes all leading whitespace; `.+` must take the rest, and giving `.+`
    // more leading whitespace can't help if the rest holds a line terminator.
    if (LINE_TERMINATOR.test(body)) return null;
    tail = body;
  } else {
    // All whitespace: `\s*` backs off one character so `.+` gets the last one.
    tail = rest.slice(-1);
    if (!tail || LINE_TERMINATOR.test(tail)) return null;
  }
  return [line, ...head.slice(1), tail];
}

/**
 * Exactly `value.match(/^\((.*)\)[\t ]*(?:#.*)?$/)` as `[value, inner]`: a
 * parenthesized call with an optional trailing comment. `inner` runs to the last `)`
 * that is followed only by blanks and an optional comment (the regex's greedy `.*`).
 */
export function matchParenthesizedCall(value: string): string[] | null {
  const n = value.length;
  if (value[0] !== "(") return null;
  // freeFrom[p]: no line terminator in value[p..]; tailOk[p]: value[p..] matches
  // `[\t ]*(?:#.*)?$`.
  const freeFrom = new Array<boolean>(n + 1);
  const tailOk = new Array<boolean>(n + 1);
  freeFrom[n] = true;
  tailOk[n] = true;
  for (let p = n - 1; p >= 0; p--) {
    freeFrom[p] = freeFrom[p + 1] && !LINE_TERMINATOR.test(value[p]);
    const c = value[p];
    tailOk[p] = ((c === " " || c === "\t") && tailOk[p + 1]) || (c === "#" && freeFrom[p + 1]);
  }
  // `.*` cannot cross a line terminator, so the closing `)` sits at or before the first one.
  let limit = n - 1;
  for (let p = 1; p < n; p++) {
    if (LINE_TERMINATOR.test(value[p])) {
      limit = p;
      break;
    }
  }
  for (let q = limit; q >= 1; q--) {
    if (value[q] === ")" && tailOk[q + 1]) return [value, value.slice(1, q)];
  }
  return null;
}
