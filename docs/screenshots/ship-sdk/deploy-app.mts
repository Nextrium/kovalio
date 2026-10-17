import { resolve } from "node:path";
import { KovalioClient } from "kovalio/client";

const ship = new KovalioClient({
  baseUrl: "https://ship.example.com",
  token: process.env.KOVALIO_TOKEN!,
  organizationId: process.env.KOVALIO_ORGANIZATION_ID!,
});

const run = await ship.deploy({
  name: "commerce-api",
  source: { type: "directory", path: resolve("./app") },
  onStep: console.log,
});

const result = await ship.deployment(run.deployment_id)
  .wait({ timeoutMs: 120_000 });

if (!result.success) throw new Error(result.status);
console.log("Ready:", run.project_id);
