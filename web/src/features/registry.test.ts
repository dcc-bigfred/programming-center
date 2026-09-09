import { getDecoder } from "../decoders/registry";
import { featuresFor, isFeatureEnabled, listFeatures } from "./registry";

describe("feature modules", () => {
  it("keeps backup available without a decoder", () => {
    const backup = listFeatures().find((f) => f.id === "backup");
    expect(backup?.requiresDecoder).toBe(false);
    expect(backup?.path).toBe("/backup");
    expect(isFeatureEnabled(backup!, undefined)).toBe(true);
    expect(isFeatureEnabled(listFeatures().find((f) => f.id === "cv")!, undefined)).toBe(false);
  });

  it("lists every kiosk module; profiles decide what is enabled", () => {
    const nmra = getDecoder("nmra");
    expect(nmra).toBeDefined();
    const ids = featuresFor(nmra!).map((f) => f.id);
    expect(ids).toEqual(listFeatures().map((f) => f.id));
    expect(ids).toContain("address");
    expect(ids).toContain("backup");
    expect(ids).toContain("volume");
    expect(ids).toContain("mapping");
    expect(isFeatureEnabled(listFeatures().find((f) => f.id === "volume")!, nmra)).toBe(false);
    expect(isFeatureEnabled(listFeatures().find((f) => f.id === "mapping")!, nmra)).toBe(false);
    expect(isFeatureEnabled(listFeatures().find((f) => f.id === "speed")!, nmra)).toBe(true);
    expect(
      isFeatureEnabled(listFeatures().find((f) => f.id === "volume")!, getDecoder("zimo-ms450")),
    ).toBe(true);
    expect(
      isFeatureEnabled(listFeatures().find((f) => f.id === "mapping")!, getDecoder("zimo-ms450")),
    ).toBe(true);
    expect(
      isFeatureEnabled(listFeatures().find((f) => f.id === "mapping")!, getDecoder("loksound-v5")),
    ).toBe(true);
    expect(
      isFeatureEnabled(listFeatures().find((f) => f.id === "mapping")!, getDecoder("loksound-v4")),
    ).toBe(true);
  });
});
