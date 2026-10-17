// Fork guard: Kovalio's security fixes in upstream-owned API and platform code.
// See FORK_PATCHES.md.
import { createContainerApplySession, finishContainerApplySession } from "@repo/platform/engine/lib/server-container-session";
import { createSetupSession, finishSetupSession } from "@repo/platform/engine/modules/system/setup-session";
import { describe, expect, it } from "vitest";
import { createEdgeConsentSession, finishEdgeConsentSession } from "./modules/domains/edge-consent-session";
import { parseDmarcXml } from "./modules/mail/dmarc/xml-parser";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const idPattern = (prefix: string) => new RegExp(`^${prefix}_\\d+_${UUID}$`);

// Session ids gate prompt answers and log streams, and the routes look sessions up
// by id alone, so an id must not be guessable.
describe("session ids carry a random UUID, not 6 guessable Math.random characters", () => {
  it("edge-consent sessions", () => {
    const session = createEdgeConsentSession("project-fork-guard");
    try {
      expect(session.id).toMatch(idPattern("edge"));
    } finally {
      finishEdgeConsentSession(session.id, "completed");
    }
  });

  it("setup sessions", () => {
    const session = createSetupSession([{ name: "docker", label: "Docker" }], "server-fork-guard");
    try {
      expect(session.id).toMatch(idPattern("setup"));
    } finally {
      finishSetupSession(session.id, "completed");
    }
  });

  it("container apply sessions", () => {
    const session = createContainerApplySession("server-fork-guard", "edge");
    try {
      expect(session.id).toMatch(idPattern("capp"));
    } finally {
      finishContainerApplySession(session.id, "completed");
    }
  });
});

describe("DMARC report entity decoding", () => {
  const report = (orgName: string) => `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>${orgName}</org_name>
    <email>dmarc@example.com</email>
    <report_id>r-1</report_id>
    <date_range><begin>1700000000</begin><end>1700086400</end></date_range>
  </report_metadata>
  <policy_published><domain>example.com</domain><p>none</p></policy_published>
</feedback>`;

  it("decodes each entity exactly once", () => {
    expect(parseDmarcXml(report("A &amp; B")).metadata.orgName).toBe("A & B");
    expect(parseDmarcXml(report("&amp;lt;script&amp;gt;")).metadata.orgName).toBe("&lt;script&gt;");
    expect(parseDmarcXml(report("&#60;&#x3e;&quot;&apos;")).metadata.orgName).toBe(`<>"'`);
  });
});
