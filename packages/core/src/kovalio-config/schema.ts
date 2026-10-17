/**
 * `kovalio.json` — the native, declarative deploy config (à la vercel.json /
 * railway.toml). A repo-root file that tells Kovalio how to build, run, route,
 * and scale a project, covering the deploy wizard's options. It's an
 * AUTHORITATIVE OVERLAY: auto-detection runs first, then each field present here
 * overrides it (absent fields keep the detected value). It seeds the wizard and
 * is authoritative for headless deploys (auto-deploy on push, `kovalio deploy`).
 *
 * This is the typed shape. `parse.ts` validates/coerces raw JSON into it; the
 * published JSON Schema (for editor autocomplete) is generated from the same
 * field set. Every field maps 1:1 to an existing API option — see the docs
 * reference page for the mapping table.
 */

import type { StackId, StackRole } from "../stacks";
import type { RoutingConfig } from "../metadata/types";
import type { KovalioReadiness } from "../types";

export type KovalioRuntime = "bare" | "docker";
export type KovalioProductionMode = "host" | "static" | "standalone";
/** The runtime WORKLOAD (issue #538): a `web` app listens on a port and is
 *  routed, a `worker` is a portless long-running container reached by nothing, a
 *  `static` site is served as files. The modern spelling of the runtime axis;
 *  `productionMode` stays supported and maps onto it (host/standalone → web,
 *  static → static) so existing configs keep working. */
export type KovalioWorkload = "web" | "worker" | "static";
export type KovalioDomainType = "free" | "custom";
export type KovalioRestart = "no" | "always" | "on-failure" | "unless-stopped";
/** Cloud sizing presets, plus "unlimited" — no caps, the self-hosted default
 *  (the machine itself is the ceiling). */
export type KovalioResourceTier = "unlimited" | "micro" | "low" | "medium" | "high" | "xlarge";

export const KOVALIO_RUNTIMES: readonly KovalioRuntime[] = ["bare", "docker"];
export const KOVALIO_PRODUCTION_MODES: readonly KovalioProductionMode[] = [
  "host",
  "static",
  "standalone",
];
export const KOVALIO_WORKLOADS: readonly KovalioWorkload[] = ["web", "worker", "static"];
export const KOVALIO_DOMAIN_TYPES: readonly KovalioDomainType[] = ["free", "custom"];
export const KOVALIO_RESTARTS: readonly KovalioRestart[] = [
  "no",
  "always",
  "on-failure",
  "unless-stopped",
];
export const KOVALIO_RESOURCE_TIERS: readonly KovalioResourceTier[] = [
  "unlimited",
  "micro",
  "low",
  "medium",
  "high",
  "xlarge",
];

/** Env value: a plain string, or `{ value, secret }` to encrypt it at rest. */
export type KovalioEnvValue = { value: string; secret?: boolean };
export type KovalioEnv = Record<string, string | KovalioEnvValue>;

export interface KovalioDomain {
  /** Hostname. A `.opsh.io`-style label = a free subdomain; anything with a dot = custom. */
  domain: string;
  /** Which service/exposed port this hostname routes to (defaults to the app port). */
  port?: number;
  /** Path prefix on the target (defaults to "/"). */
  targetPath?: string;
  type?: KovalioDomainType;
}

export interface KovalioHealthcheck {
  test?: string | string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  startPeriod?: string;
  disable?: boolean;
}

/**
 * The deploy-time readiness gate lives in ../types alongside ComposeHealthcheck,
 * because a compose SERVICE can carry one too (`service.advanced.readiness`) and
 * both surfaces must reference one definition. Re-exported here so `kovalio.json`
 * authoring types stay importable from one place.
 */
export type { KovalioReadiness, KovalioReadinessFailureAction } from "../types";
export { KOVALIO_READINESS_FAILURE_ACTIONS } from "../types";

export interface KovalioService {
  name: string;
  image?: string;
  build?: string;
  dockerfile?: string;
  /**
   * Dockerfile build arguments for this service. A null value inherits the
   * same-named value from the project's `env`; a string is an explicit
   * service-local override. Runtime variables continue to live in `env`.
   */
  buildArgs?: Record<string, string | null>;
  ports?: string[];
  volumes?: string[];
  dependsOn?: string[];
  env?: KovalioEnv;
  command?: string;
  restart?: KovalioRestart;
  exposed?: boolean;
  exposedPort?: string;
  domain?: string;
  healthcheck?: KovalioHealthcheck;
  /**
   * Per-service DEPLOY-TIME readiness gate, overriding the top-level `readiness`
   * for this service. Absent ⇒ inherit the project's; neither ⇒ off.
   *
   * Not the same field as `healthcheck` above: that's the Docker HEALTHCHECK the
   * daemon runs on a loop, this is the pipeline's one-shot "did it come up?" and
   * the only one that can fail a deploy.
   */
  readiness?: KovalioReadiness;
  /** Per-service cpu/memory caps, overriding the top-level `resources` field by
   *  field. Parity with compose `mem_limit` / `deploy.resources.limits`, which
   *  the compose parser now honors. `0` = no limit. */
  resources?: KovalioResources;
}

/**
 * Per-sub-app overrides for a monorepo. These override what the detector found
 * for the sub-app at `rootDirectory` (matched by path). Only build-shaping
 * fields are supported in v1 — per-app `domain`/`env`/`exposed` are set in the
 * wizard, not here (declare shared vars under the top-level `env`/`domains`).
 */
export interface KovalioMonorepoApp {
  name: string;
  rootDirectory: string;
  framework?: StackId;
  packageManager?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDirectory?: string;
  buildImage?: string;
  port?: number;
}

export interface KovalioMonorepo {
  workspace?: { packageManager: string; prepareCommand?: string };
  apps?: KovalioMonorepoApp[];
}

/** Cloud sizing tier OR an explicit production resource allocation. */
export interface KovalioResources {
  tier?: KovalioResourceTier;
  cpuCores?: number;
  memoryMb?: number;
  diskMb?: number;
}

export interface KovalioConfig {
  // ── Build ──
  framework?: StackId;
  packageManager?: string;
  rootDirectory?: string;
  /**
   * Where the compose file lives, when it isn't at the project root — either the
   * file itself (`"deploy/stack.yml"`, which also covers non-standard filenames)
   * or the directory holding it (`"deploy/docker-compose"`). Declaring this makes
   * the project a compose/services deploy.
   */
  composePath?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  /**
   * Commands run ONCE per deploy, after the build and before the new version is
   * activated — for example, database migrations. A non-zero exit FAILS the
   * deploy, so the old version keeps serving rather than a new one coming up
   * against a schema it can't use.
   *
   * Each command gets its own execution context and log marker. Only effects in
   * a database or persistent volume survive a Docker release container. Commands
   * must be idempotent; a code rollback does not undo their data changes.
   * Absent/[] disables the phase. Nothing is auto-injected per framework.
   */
  releaseCommands?: string[];
  outputDirectory?: string;
  buildImage?: string;
  /** Explicit runtime version; validated by the detected stack's image policy. */
  runtimeVersion?: string;
  runtimeImage?: string;
  productionPaths?: string[];
  /**
   * Paths the app keeps across deploys. Either the short app form — a path
   * relative to the app root (`"storage"`, `"public/uploads"`) — or full compose
   * syntax (`"uploads:/app/storage"`, `"/srv/data:/app/storage"`). Omit to inherit
   * the framework's defaults (Laravel keeps `storage/`); declare `[]` to opt out.
   * Compose services keep declaring their own under `services[].volumes`.
   */
  volumes?: string[];
  // ── Runtime ──
  runtime?: KovalioRuntime;
  productionMode?: KovalioProductionMode;
  /**
   * The runtime workload: `web` (port + route), `worker` (portless long-running
   * container, no route), or `static` (files). The modern spelling of the runtime
   * axis; when both are set, `workload` wins over `productionMode` (#538).
   */
  workload?: KovalioWorkload;
  port?: number;
  /**
   * Runtime roles beyond the web process - workers, schedulers (issue #935).
   * Presence of this field, EVEN `[]`, overrides the stack's own presets
   * (`STACKS[framework].defaultRoles`) outright; absence derives them from
   * detected deps/files. See `resolveStackRoles` in `../stack-roles`. A role
   * with `kind: "web"` is rejected here - the web role is always derived from
   * `startCommand`. Deriving presets is a creation-time act: the deploy path
   * resolves the persisted `project.roles`, where null means web only, so an
   * existing project never gains a process on redeploy (#935 Q2).
   */
  roles?: StackRole[];
  /**
   * Opt-in Laravel cache warming (issue #19). When `true`, the resolved WEB role
   * command gains a `php artisan optimize && ` prefix, which warms Laravel's
   * config/route/event/view caches once at startup for higher per-request
   * throughput. Default `false`: an absent or `false` flag keeps the web command
   * byte-identical, so existing projects are unaffected. Laravel web role only —
   * workers and schedulers stay unwarmed. It applies only to the `laravel` stack.
   *
   * Warming must run at startup, never at build or in `releaseCommands`:
   * `config:cache` (inside `optimize`) freezes the env present when it runs and
   * makes every `env()` call outside `config/*.php` return `null`, so it is only
   * correct after Kovalio injects the runtime env. See `resolveWebCommand` in
   * `../stack-roles`.
   */
  optimize?: boolean;
  // ── Env ──
  env?: KovalioEnv;
  // ── Domains + routing ──
  domains?: KovalioDomain[];
  routes?: RoutingConfig;
  // ── Resources ──
  resources?: KovalioResources;
  // ── Deploy-time readiness gate (all off by default) ──
  readiness?: KovalioReadiness;
  // ── Services (compose) ──
  services?: KovalioService[];
  // ── Monorepo ──
  monorepo?: KovalioMonorepo;
}

export interface ParseResult {
  /** Valid fields, partial — only what parsed cleanly. null if `raw` isn't an object. */
  config: KovalioConfig | null;
  /** Hard validation failures (bad type / unknown enum / out-of-range). */
  errors: string[];
  /** Soft issues (unknown keys) — non-fatal; the field is ignored. */
  warnings: string[];
}
