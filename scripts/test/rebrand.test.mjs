// Fork guard: the brand overlay's rewrite rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rebrandText } from "../rebrand-kovalio.mjs";

test("rebrands every casing of the product name", () => {
  assert.equal(rebrandText("Openship OpenShip OPENSHIP openship OpenSHIP"), "Kovalio Kovalio KOVALIO kovalio kovalio");
});

test("maps upstream URLs and domains to the fork's", () => {
  assert.equal(rebrandText("https://github.com/oblien/openship.git"), "https://github.com/Nextrium/kovalio.git");
  assert.equal(rebrandText("https://app.openship.io/x"), "https://kovalio.nextrium.org/x");
  assert.equal(rebrandText("noreply@openship.io"), "noreply@nextrium.org");
  assert.equal(
    rebrandText("https://raw.githubusercontent.com/oblien/openship/main/a.json"),
    "https://raw.githubusercontent.com/Nextrium/kovalio/main/a.json",
  );
});

test("points product images and the default registry at ghcr.io/nextrium", () => {
  assert.equal(rebrandText("ghcr.io/oblien/openship-edge:1.2.3"), "ghcr.io/nextrium/kovalio-edge:1.2.3");
  assert.equal(rebrandText("ghcr.io/oblien/kovalio-api:1"), "ghcr.io/nextrium/kovalio-api:1");
  assert.equal(rebrandText('DEFAULT_IMAGE_REGISTRY = "ghcr.io/oblien";'), 'DEFAULT_IMAGE_REGISTRY = "ghcr.io/nextrium";');
  assert.equal(rebrandText("${REG:-ghcr.io/oblien}/openship-api"), "${REG:-ghcr.io/nextrium}/kovalio-api");
});

test("leaves upstream's non-product images alone", () => {
  assert.equal(rebrandText("ghcr.io/oblien/mindwire-runtime:0.1.3"), "ghcr.io/oblien/mindwire-runtime:0.1.3");
});

test("keeps lines carrying the keep marker verbatim", () => {
  const text = "Openship\nForked from Openship // brand-guard:keep\n";
  assert.equal(rebrandText(text), "Kovalio\nForked from Openship // brand-guard:keep\n");
});

test("rebrands base64-embedded text and leaves other base64 alone", () => {
  const encoded = Buffer.from('require("openship.maxminddb") -- embedded lua source').toString("base64");
  const decoded = Buffer.from(rebrandText(`"${encoded}"`).slice(1, -1), "base64").toString("utf8");
  assert.equal(decoded, 'require("kovalio.maxminddb") -- embedded lua source');
  const unrelated = Buffer.from("no brand in this payload at all, just bytes and text").toString("base64");
  assert.equal(rebrandText(unrelated), unrelated);
});

test("is idempotent", () => {
  const once = rebrandText("Openship at ghcr.io/oblien/openship-edge, https://openship.io");
  assert.equal(rebrandText(once), once);
});
