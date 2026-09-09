import {
  INDEX_CV31,
  INDEX_CV32,
  INDEX_CV31_VALUE,
  applyBatches,
  decodeConditions,
  decodeLogic,
  encodeConditions,
  encodeLogic,
  encodeRow,
  indexedKey,
  loksoundV4Mapping,
  loksoundV5Mapping,
  packPair,
  parseIndexedKey,
  rowGroups,
  rowLayout,
  unpackPair,
  type CondState,
} from "./esuMapping";

describe("esuMapping", () => {
  it("computes v5 row 1 addresses without the PDF OCR 363", () => {
    const layout = rowLayout(loksoundV5Mapping, 1);
    expect(layout.conditionPage).toBe(3);
    expect(layout.outputPage).toBe(8);
    expect(layout.conditionCvs).toEqual([257, 258, 259, 260, 261, 262, 263, 264, 265, 266]);
    expect(layout.outputCvs).toEqual([257, 258, 259, 260, 261, 262, 263, 264, 265, 266]);
    expect(layout.conditionCvs[6]).toBe(263);
  });

  it("keeps v4 row 1 conditions and outputs on the same page", () => {
    const layout = rowLayout(loksoundV4Mapping, 1);
    expect(layout.conditionPage).toBe(2);
    expect(layout.outputPage).toBe(2);
    expect(layout.conditionCvs).toEqual([257, 258, 259, 260, 261, 262, 263, 264, 265]);
    expect(layout.outputCvs).toEqual([266, 267, 268, 269, 270, 271, 272]);
  });

  it("allows v4 row 16 to use CV 512", () => {
    const layout = rowLayout(loksoundV4Mapping, 16);
    expect(layout.outputCvs[layout.outputCvs.length - 1]).toBe(512);
  });

  it("splits v5 groups into condition then output pages", () => {
    const groups = rowGroups(loksoundV5Mapping);
    expect(groups).toHaveLength(5);
    expect(groups[0]).toMatchObject({ firstRow: 1, lastRow: 16 });
    expect(groups[0].pages.map((p) => p.cv32)).toEqual([3, 8]);
    expect(groups[4]).toMatchObject({ firstRow: 65, lastRow: 72 });
    expect(groups[4].pages.map((p) => p.cv32)).toEqual([7, 12]);
  });

  it("packs stop/forward/F0 on as CV A = 20 in the manual example (fwd + F0)", () => {
    expect(packPair("on", 1) | packPair("on", 2)).toBe(20);
    expect(unpackPair(20, 1)).toBe("on");
    expect(unpackPair(20, 2)).toBe("on");
    const cond = encodeConditions(loksoundV5Mapping, {
      moving: "ignore",
      direction: "on",
      keys: Array.from({ length: 32 }, (_, i) => (i === 0 ? "on" : "ignore")),
      wheelSensor: "ignore",
      sensors: ["ignore", "ignore", "ignore", "ignore"],
    });
    expect(cond[0]).toBe(20);
  });

  it("packs F4 off onto CV B = 32", () => {
    const keys: CondState[] = Array.from({ length: 32 }, () => "ignore");
    keys[4] = "off";
    const cond = encodeConditions(loksoundV5Mapping, {
      moving: "ignore",
      direction: "ignore",
      keys,
      wheelSensor: "ignore",
      sensors: ["ignore", "ignore", "ignore", "ignore"],
    });
    expect(cond[1]).toBe(32);
  });

  it("round-trips F29–F31 and sensors only on v5", () => {
    const keys: CondState[] = Array.from({ length: 32 }, () => "ignore");
    keys[29] = "on";
    keys[31] = "off";
    const encoded = encodeConditions(loksoundV5Mapping, {
      moving: "off",
      direction: "on",
      keys,
      wheelSensor: "on",
      sensors: ["on", "ignore", "off", "ignore"],
    });
    const decoded = decodeConditions(loksoundV5Mapping, encoded);
    expect(decoded.keys[29]).toBe("on");
    expect(decoded.keys[31]).toBe("off");
    expect(decoded.wheelSensor).toBe("on");
    expect(decoded.sensors[0]).toBe("on");
    expect(decoded.sensors[2]).toBe("off");
    expect(loksoundV4Mapping.conditionCvCount).toBe(9);
    expect(encodeConditions(loksoundV4Mapping, decoded)).toHaveLength(9);
  });

  it("does not treat the same logic bit as the same function on v4 vs v5", () => {
    expect(decodeLogic(loksoundV4Mapping, [1, 0])).toEqual(["abvOff"]);
    expect(decodeLogic(loksoundV5Mapping, [1, 0, 0])).toEqual(["optionalLoad"]);
    expect(encodeLogic(loksoundV4Mapping, ["shunting"])[0]).toBe(2);
    expect(encodeLogic(loksoundV5Mapping, ["shunting"])[0]).toBe(2);
    expect(encodeLogic(loksoundV4Mapping, ["doppler"])[1]).toBe(32);
    expect(encodeLogic(loksoundV5Mapping, ["doppler"])).toEqual([0, 0, 0]);
  });

  it("emits CV31 then CV32 then payload, with a new batch per v5 page", () => {
    const batches = applyBatches([
      { cv32: 8, cv: 257, value: 1 },
      { cv32: 3, cv: 263, value: 20 },
      { cv32: 3, cv: 257, value: 4 },
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].cvs[0]).toEqual({ cv: INDEX_CV31, value: INDEX_CV31_VALUE });
    expect(batches[0].cvs[1]).toEqual({ cv: INDEX_CV32, value: 3 });
    expect(batches[0].cvs.slice(2)).toEqual([
      { cv: 257, value: 4 },
      { cv: 263, value: 20 },
    ]);
    expect(batches[1].cvs[1]).toEqual({ cv: INDEX_CV32, value: 8 });
    expect(batches[1].cvs[2]).toEqual({ cv: 257, value: 1 });
  });

  it("parses indexed keys", () => {
    expect(indexedKey(3, 257)).toBe("16.3.257");
    expect(parseIndexedKey("16.3.257")).toEqual({ cv31: 16, cv32: 3, cv: 257 });
    expect(parseIndexedKey("nope")).toBeNull();
  });

  it("places v5 AUX4 and Config 2 where the manuals do, not v4 Config 2 numbers", () => {
    const aux4 = loksoundV5Mapping.outputConfigs.find((o) => o.id === "aux4");
    expect(aux4).toMatchObject({ modeCv: 299, brightnessCv: 302, spec1Cv: 303, spec3Cv: 298 });
    const v5Hl2 = loksoundV5Mapping.outputConfigs.find((o) => o.id === "headlight2");
    const v4Hl2 = loksoundV4Mapping.outputConfigs.find((o) => o.id === "headlight2");
    expect(v4Hl2?.modeCv).toBe(355);
    expect(v5Hl2?.modeCv).toBe(419);
    expect(loksoundV4Mapping.outputConfigs.find((o) => o.id === "rearlight")?.spec2Cv).toBe(273);
  });

  it("encodes a v5 row onto split pages with matching CV numbers", () => {
    const encoded = encodeRow(loksoundV5Mapping, {
      conditions: decodeConditions(loksoundV5Mapping, [20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      physical: ["headlight"],
      logic: ["shunting"],
      slots: [1, 2],
    });
    expect(encoded.conditions).toHaveLength(10);
    expect(encoded.outputs).toHaveLength(10);
    expect(encoded.outputs[0]).toBe(1);
    expect(encoded.outputs[3]).toBe(2);
    expect(encoded.outputs[6]).toBe(1 + 2);
  });
});
