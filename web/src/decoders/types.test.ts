import { decoderLabelKey, grouped } from "./types";

describe("decoder types", () => {
  it("stamps a group key onto catalogue items", () => {
    expect(grouped("catalog.nmra.speed", [{ cv: 2 }, { cv: 5 }])).toEqual([
      { cv: 2, groupKey: "catalog.nmra.speed" },
      { cv: 5, groupKey: "catalog.nmra.speed" },
    ]);
  });

  it("builds decoder i18n keys", () => {
    expect(decoderLabelKey("zimo-ms450")).toBe("decoder.zimo-ms450");
  });
});
