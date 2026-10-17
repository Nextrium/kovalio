import { expect, it, vi } from "vitest";
import { KovalioClient } from "../src";
import { createTheme, defaultAppearance } from "@repo/core";
it("reads, saves and resets the authenticated user's portable theme library", async () => {
  const appearance = {
    ...defaultAppearance("personal"),
    themes: [createTheme("dim", "personal", "Personal")],
  };
  const fetcher = vi.fn(async (_url: unknown, request: RequestInit | undefined) =>
    Response.json(request?.method === "PUT" ? JSON.parse(String(request.body)) : { appearance }),
  );
  const client = new KovalioClient({
    baseUrl: "https://kovalio.test",
    token: "test-token",
    fetch: fetcher,
  });
  expect(await client.settings.getAppearance()).toEqual({ appearance });
  expect(await client.settings.setAppearance({ appearance })).toEqual({ appearance });
  expect(await client.settings.setAppearance({ appearance: null })).toEqual({ appearance: null });
  expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual(
    Array(3).fill("https://kovalio.test/api/settings/appearance"),
  );
});
