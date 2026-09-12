import {
  decodeCv115,
  decodeCv116,
  encodeCv115,
  encodeCv116,
  encodeUncoupler,
  isUncoupler,
  KROIS_CV115_PRESETS,
  setUncoupler,
  timeSeconds,
  uncouplerDirection,
  ZIMO_COUPLER_OUTPUTS,
} from "./zimoCoupler";

describe("zimoCoupler", () => {
  it("packs CV 115 tens = pull-in and ones = hold percent", () => {
    expect(decodeCv115(60)).toEqual({ pullInIndex: 6, holdPercent: 0 });
    expect(encodeCv115({ pullInIndex: 6, holdPercent: 0 })).toBe(60);
    expect(encodeCv115({ pullInIndex: 7, holdPercent: 30 })).toBe(73);
    expect(decodeCv115(73)).toEqual({ pullInIndex: 7, holdPercent: 30 });
    expect(decodeCv115(160).pullInIndex).toBe(6);
    expect(KROIS_CV115_PRESETS).toEqual([60, 70, 80]);
    expect(timeSeconds(6)).toBe(2);
    expect(timeSeconds(8)).toBe(4);
  });

  it("packs CV 116 hundreds = unload, tens = time, ones × 4 = speed step", () => {
    expect(decodeCv116(155)).toEqual({ unload: true, disengageIndex: 5, speedStep: 20 });
    expect(encodeCv116({ unload: true, disengageIndex: 5, speedStep: 20 })).toBe(155);
    expect(encodeCv116({ unload: false, disengageIndex: 0, speedStep: 0 })).toBe(0);
    expect(decodeCv116(60)).toEqual({ unload: false, disengageIndex: 6, speedStep: 0 });
  });

  it("treats effect 48/49/50 as uncoupler and leaves other effects when disabling", () => {
    expect(isUncoupler(48)).toBe(true);
    expect(isUncoupler(49)).toBe(true);
    expect(isUncoupler(50)).toBe(true);
    expect(isUncoupler(0)).toBe(false);
    expect(isUncoupler(52)).toBe(false);
    expect(uncouplerDirection(48)).toBe("both");
    expect(uncouplerDirection(49)).toBe("fwd");
    expect(uncouplerDirection(50)).toBe("rev");
    expect(encodeUncoupler("both")).toBe(48);
    expect(encodeUncoupler("fwd")).toBe(49);
    expect(encodeUncoupler("rev")).toBe(50);
    expect(setUncoupler(0, true, "both")).toBe(48);
    expect(setUncoupler(48, false, "both")).toBe(0);
    expect(setUncoupler(52, false, "both")).toBe(52);
    expect(ZIMO_COUPLER_OUTPUTS.map((o) => o.cv)).toEqual([
      125, 126, 127, 128, 129, 130, 131, 132, 159, 160,
    ]);
  });
});
