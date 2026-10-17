// Fork guard: cacheMountTargets returns exactly what the regex it replaces returns in
// docker-build-plan.ts, and stays fast on CodeQL's trigger. See FORK_PATCHES.md.
import { describe, expect, it } from "vitest";
import type { BuildConfig } from "../types";
import { cacheMountTargets } from "./cache-mount-targets";
import { generateDockerfile } from "./docker-build-plan";

const ORIGINAL = /--mount=type=cache,[^\s]*target=([^,\s]+)/g;
const original = (recipe: string) => [...recipe.matchAll(ORIGINAL)].map((m) => m[1]);

// Whole tokens, so short strings still reach the long literal parts of the pattern.
const TOKENS = ["--mount=type=cache,", "--mount=type=cache", "target=", "target", ",", "x", "/c", " ", "\n", "\t"];

function* sequences(maxLen: number): Generator<string> {
  let frontier = [""];
  yield "";
  for (let len = 1; len <= maxLen; len++) {
    frontier = frontier.flatMap((s) => TOKENS.map((t) => s + t));
    yield* frontier;
  }
}

describe("cacheMountTargets equals the build-plan regex", () => {
  it("on every sequence of up to 5 tokens", () => {
    const mismatches: string[] = [];
    for (const recipe of sequences(5)) {
      if (JSON.stringify(cacheMountTargets(recipe)) !== JSON.stringify(original(recipe))) mismatches.push(recipe);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  }, 120_000);

  it("on random recipes mixing tokens and characters", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const pieces = [...TOKENS, "a", "=", "-", "type=cache,", "id=npm,", "target=/root/.npm"];
    const mismatches: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      let recipe = "";
      for (let k = rand(12); k >= 0; k--) recipe += pieces[rand(pieces.length)];
      if (JSON.stringify(cacheMountTargets(recipe)) !== JSON.stringify(original(recipe))) mismatches.push(recipe);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("reads real cache mounts", () => {
    const recipe = [
      "FROM node:22",
      "RUN --mount=type=cache,id=npm,target=/root/.npm --mount=type=cache,target=/app/.next/cache npm ci",
    ].join("\n");
    expect(cacheMountTargets(recipe)).toEqual(["/root/.npm", "/app/.next/cache"]);
  });
});

describe("linear on CodeQL's trigger", () => {
  it("repeated cache mounts with no target and no whitespace", () => {
    const recipe = "--mount=type=cache,".repeat(20_000);
    const start = performance.now();
    expect(cacheMountTargets(recipe)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(250);
  });

  // End to end: a project's build command lands in the generated Dockerfile, so this
  // also fails if docker-build-plan.ts goes back to the regex.
  it("generateDockerfile with a hostile build command and build cache on", () => {
    const config: BuildConfig = {
      sessionId: "s1",
      projectId: "p1",
      repoUrl: "https://github.com/acme/app.git",
      branch: "main",
      stack: "vite",
      buildImage: "node:22",
      runtimeImage: "node:22",
      packageManager: "npm",
      installCommand: "npm ci",
      buildCommand: "--mount=type=cache,".repeat(20_000),
      outputDirectory: "dist",
      port: 8080,
      envVars: {},
      resources: { cpuCores: 1, memoryMb: 512, diskMb: 1024 },
      buildCache: true,
    };
    const start = performance.now();
    generateDockerfile(config);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
