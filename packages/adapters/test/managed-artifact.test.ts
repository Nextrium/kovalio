import { describe, it, expect, vi } from "vitest";
import {
  MANAGED_ARTIFACT_BASE,
  assertManagedArtifactPath,
  isArtifactPathRef,
  removeManagedArtifact,
} from "../src/runtime/managed-artifact";

/**
 * The `rm -rf` boundary.
 *
 * `destroy()` accepts an absolute-path ref because the columns it reads —
 * `deployment.container_id`, `service_deployment.image_ref` — legitimately hold a
 * host directory for a static deploy. That makes it a function that removes a
 * directory named by a DB value, reached from a dozen callers. Two properties have
 * to hold at the operation, not at any one caller: it only ever removes inside our
 * own tree, and it cannot silently fail.
 */

const makeExecutor = (over: Record<string, unknown> = {}) =>
  ({
    exec: vi.fn(async () => ""),
    exists: vi.fn(async () => false),
    ...over,
  }) as never;

describe("assertManagedArtifactPath", () => {
  it("accepts a static release dir and a build dir", () => {
    expect(() =>
      assertManagedArtifactPath("/opt/kovalio/static/releases/dep_1"),
    ).not.toThrow();
    expect(() =>
      assertManagedArtifactPath("/opt/kovalio/static/.builds/bld_1-svc_1"),
    ).not.toThrow();
    expect(() => assertManagedArtifactPath("/opt/kovalio/releases/dep_1")).not.toThrow();
  });

  it("refuses anything outside the managed base", () => {
    for (const ref of ["/etc", "/", "/var/lib/docker", "/home/deploy/site"]) {
      expect(() => assertManagedArtifactPath(ref)).toThrow(/outside \/opt\/kovalio/);
    }
  });

  it("matches on a path BOUNDARY, not a bare prefix", () => {
    // `/opt/kovaliomore` shares the prefix but is a different tree entirely.
    expect(() => assertManagedArtifactPath("/opt/kovaliomore/x")).toThrow(
      /outside \/opt\/kovalio/,
    );
    expect(() => assertManagedArtifactPath("/opt/kovalio-evil/x")).toThrow(
      /outside \/opt\/kovalio/,
    );
  });

  it("refuses the shared parents themselves", () => {
    // Removing one of these takes out every project's output at once, plus the
    // bind mount the edge reads through. A ref that lands exactly here is a bug
    // upstream, not a target.
    for (const ref of [
      MANAGED_ARTIFACT_BASE,
      "/opt/kovalio/static",
      "/opt/kovalio/static/",
      "/opt/kovalio/static/releases",
      "/opt/kovalio/static/.builds",
      "/opt/kovalio/releases",
      "/opt/kovalio/.builds",
    ]) {
      expect(() => assertManagedArtifactPath(ref)).toThrow(/shared parent directory/);
    }
  });

  it("refuses traversal and relative refs", () => {
    expect(() => assertManagedArtifactPath("/opt/kovalio/static/../../etc")).toThrow(/"\.\."/);
    expect(() => assertManagedArtifactPath("opt/kovalio/static/x")).toThrow(/absolute/);
  });
});

describe("removeManagedArtifact", () => {
  const REF = "/opt/kovalio/static/releases/dep_1";

  it("shell-quotes the path and verifies the removal", async () => {
    const executor = makeExecutor();
    await removeManagedArtifact(executor, REF);
    expect(executor.exec).toHaveBeenCalledWith(`rm -rf '${REF}'`);
    expect(executor.exists).toHaveBeenCalledWith(REF);
  });

  it("never execs for a refused path", async () => {
    const executor = makeExecutor();
    await expect(removeManagedArtifact(executor, "/etc")).rejects.toThrow(/outside/);
    expect(executor.exec).not.toHaveBeenCalled();
  });

  it("THROWS when the directory survives the rm", async () => {
    // `rm -rf` exits 0 on some partial failures, so the post-check is the only
    // thing standing between a leak and a cleanup that reports success.
    const executor = makeExecutor({ exists: vi.fn(async () => true) });
    await expect(removeManagedArtifact(executor, REF)).rejects.toThrow(/still present/);
  });

  it("propagates a real removal failure instead of swallowing it", async () => {
    // The old implementation `.catch(() => {})`'d this, which made an artifact
    // destroy incapable of failing — teardown then reported N/N ok over a
    // directory still on disk.
    const executor = makeExecutor({
      exec: vi.fn(async () => {
        throw new Error("rm: cannot remove: Permission denied");
      }),
    });
    await expect(removeManagedArtifact(executor, REF)).rejects.toThrow(/Permission denied/);
  });

  it("treats an already-absent path as success", async () => {
    // Idempotency is required — partial-cleanup retries must not re-fail. `rm -rf`
    // exits 0 for a missing path, and `exists` then answers false.
    const executor = makeExecutor();
    await expect(removeManagedArtifact(executor, REF)).resolves.toBeUndefined();
  });
});

describe("isArtifactPathRef", () => {
  it("keys on a LEADING slash, so image tags are never mistaken for paths", () => {
    expect(isArtifactPathRef("/opt/kovalio/static/releases/dep_1")).toBe(true);
    // Tags contain slashes but never start with one — the distinction the whole
    // classification rests on.
    expect(isArtifactPathRef("kovalio/my-app:bld_1")).toBe(false);
    expect(isArtifactPathRef("ghcr.io/org/img:tag")).toBe(false);
    expect(isArtifactPathRef("postgres:16-alpine")).toBe(false);
    expect(isArtifactPathRef("compose")).toBe(false);
  });
});
