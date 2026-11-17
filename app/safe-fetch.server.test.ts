import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === "rebind.example") return [{ address: "10.0.0.5", family: 4 }];
    if (hostname === "v6private.example") return [{ address: "fd00::1", family: 6 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

const { isPrivateAddress, isPublicHostname, isPublicUrlReachable } = await import("./safe-fetch.server");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private address detection", () => {
  it("classifies IPv4 and IPv6 ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it("rejects local hostnames", () => {
    expect(isPublicHostname("localhost")).toBe(false);
    expect(isPublicHostname("api.internal")).toBe(false);
    expect(isPublicHostname("[::1]")).toBe(false);
    expect(isPublicHostname("example.org")).toBe(true);
  });
});

describe("isPublicUrlReachable", () => {
  it("never fetches hostnames that resolve to private networks", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await isPublicUrlReachable("https://rebind.example/a")).toBe(false);
    expect(await isPublicUrlReachable("https://v6private.example/a")).toBe(false);
    expect(await isPublicUrlReachable("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-checks redirect targets", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await isPublicUrlReachable("https://example.org/start")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 404 as broken and bot-blocking statuses as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await isPublicUrlReachable("https://example.org/missing")).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    expect(await isPublicUrlReachable("https://example.org/limited")).toBe(true);
  });
});
