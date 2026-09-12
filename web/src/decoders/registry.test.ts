import { canonicalDecoderId, getDecoder, listDecoders } from "./registry";

describe("decoder catalogue", () => {
  it("lists built-in profiles with NMRA last", () => {
    const ids = listDecoders().map((d) => d.id);
    expect(ids[ids.length - 1]).toBe("nmra");
    expect(ids).toContain("zimo-ms450");
    expect(ids).toContain("loksound-v5");
    expect(ids).toContain("loksound-v4");
    expect(ids).toContain("rb23xx");
  });

  it("resolves aliases and empty ids", () => {
    expect(canonicalDecoderId("rb2300")).toBe("rb23xx");
    expect(canonicalDecoderId("rb2302")).toBe("rb23xx");
    expect(getDecoder("rb2300")?.id).toBe("rb23xx");
    expect(getDecoder(null)).toBeUndefined();
    expect(getDecoder("nope")).toBeUndefined();
  });

  it("advertises programming features used by the kiosk", () => {
    expect(getDecoder("nmra")?.features).toEqual(["cv", "speed", "address"]);
    expect(getDecoder("zimo-ms450")?.features).toContain("volume");
    expect(getDecoder("zimo-ms450")?.features).toContain("mapping");
    expect(getDecoder("loksound-v5")?.features).toContain("mapping");
    expect(getDecoder("loksound-v4")?.features).toContain("mapping");
    expect(getDecoder("zimo-ms450")?.features).toContain("coupler");
    expect(getDecoder("loksound-v5")?.features).toContain("coupler");
    expect(getDecoder("loksound-v4")?.features).toContain("coupler");
    expect(getDecoder("loksound-v4")?.cvs.some((c) => c.cv === 246)).toBe(true);
    expect(getDecoder("loksound-v4")?.cvs.some((c) => c.cv === 247)).toBe(true);
    expect(getDecoder("loksound-v4")?.cvs.some((c) => c.cv === 248)).toBe(true);
    expect(getDecoder("nmra")?.features).not.toContain("coupler");
    expect(getDecoder("loksound-v5")?.longAddressBit ?? 5).toBe(5);
    expect(getDecoder("rb23xx")?.longAddressBit).toBe(3);
    expect(getDecoder("rb23xx")?.features).toContain("firmware");
    expect(getDecoder("nmra")?.features).not.toContain("firmware");
    expect(getDecoder("zimo-ms450")?.features).not.toContain("firmware");
  });
});
