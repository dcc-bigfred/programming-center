import { matchManufacturer } from "./detectDecoder";

describe("matchManufacturer", () => {
  it("maps known CV 8 IDs", () => {
    expect(matchManufacturer(145)).toEqual({ decoderId: "zimo-ms450" });
    expect(matchManufacturer(151)).toEqual({ decoderId: "loksound-v5", esuAmbiguous: true });
    expect(matchManufacturer(172)).toEqual({ decoderId: "rb23xx" });
  });

  it("returns null for unknown IDs", () => {
    expect(matchManufacturer(0)).toBeNull();
    expect(matchManufacturer(99)).toBeNull();
    expect(matchManufacturer(255)).toBeNull();
  });
});
