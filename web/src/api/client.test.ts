import { ApiError, TOKEN_KEY, api, getToken, isCancelled, setToken } from "./client";

describe("ApiError", () => {
  it("formats code and optional detail", () => {
    expect(new ApiError(503, "z21_unreachable").message).toBe("z21_unreachable");
    expect(new ApiError(503, "z21_unreachable", "timeout").message).toBe(
      "z21_unreachable: timeout",
    );
  });

  it("detects overlay cancel", () => {
    expect(isCancelled(new ApiError(0, "cancelled"))).toBe(true);
    expect(isCancelled(new ApiError(503, "decoder_absent"))).toBe(false);
    expect(isCancelled(new Error("cancelled"))).toBe(false);
  });
});

describe("session token", () => {
  it("round-trips through sessionStorage", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("abc");
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe("api", () => {
  it("parses JSON error payloads from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "z21_unreachable", detail: "no reply" }),
      }),
    );
    await expect(api.publicConfig()).rejects.toMatchObject({
      status: 503,
      code: "z21_unreachable",
      message: "z21_unreachable: no reply",
    });
  });

  it("falls back to http_status when the body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "bad gateway",
      }),
    );
    await expect(api.me()).rejects.toMatchObject({
      status: 502,
      code: "http_502",
    });
  });

  it("maps fetch failures to network_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(api.publicConfig()).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("returns JSON on success and skips auth when asked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ enabled: true, mode: "standalone" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setToken("secret");
    await expect(api.publicConfig()).resolves.toMatchObject({ mode: "standalone" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Accept: "application/json" });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
