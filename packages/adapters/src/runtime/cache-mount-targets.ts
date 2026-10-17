// Kovalio fork module: linear-time stand-in for a regex that backtracks quadratically
// on hostile input (CodeQL js/polynomial-redos). See FORK_PATCHES.md.

const CACHE_MOUNT = "--mount=type=cache,";
const TARGET = "target=";

/**
 * Exactly `[...recipe.matchAll(/--mount=type=cache,[^\s]*target=([^,\s]+)/g)].map(m => m[1])`.
 *
 * Every part of that pattern excludes whitespace, so a match lies inside one
 * whitespace-free run. In a run, the greedy `[^\s]*` reaches the last `target=` that
 * still has a value (a non-comma character after it), counted from the first cache
 * mount; that leaves no later `target=` for a second match, so each run gives at most
 * one. The regex retries from every cache mount in a long run, which is quadratic.
 */
export function cacheMountTargets(recipe: string): string[] {
  const targets: string[] = [];
  for (const run of recipe.split(/\s+/)) {
    const mount = run.indexOf(CACHE_MOUNT);
    if (mount < 0) continue;
    const earliest = mount + CACHE_MOUNT.length;
    for (let at = run.lastIndexOf(TARGET); at >= earliest; at = run.lastIndexOf(TARGET, at - 1)) {
      const value = at + TARGET.length;
      if (value < run.length && run[value] !== ",") {
        const end = run.indexOf(",", value);
        targets.push(run.slice(value, end < 0 ? run.length : end));
        break;
      }
      if (at === 0) break;
    }
  }
  return targets;
}
