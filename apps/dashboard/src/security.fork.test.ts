// Fork guard: Kovalio's security fixes in upstream-owned dashboard code. See FORK_PATCHES.md.
import { describe, expect, it } from "vitest";
import { POST } from "./app/api/cloud-waitlist/route";

const post = (email: string) =>
  POST(new Request("http://localhost/api/cloud-waitlist", { method: "POST", body: JSON.stringify({ email }) }));

describe("public cloud-waitlist endpoint", () => {
  it("still accepts a normal address and rejects a malformed one", async () => {
    expect((await post("someone@example.com")).status).not.toBe(400);
    expect((await post("not-an-email")).status).toBe(400);
  });

  it("rejects an over-long address without backtracking for seconds", async () => {
    const start = performance.now();
    const res = await post(`a@${".".repeat(200_000)}@`);
    expect(res.status).toBe(400);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
