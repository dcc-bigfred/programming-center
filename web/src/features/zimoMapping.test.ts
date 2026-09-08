import {
  CV_HIGH_BEAM_SPEED,
  CV_NO_LEFT_SHIFT,
  CV_PWM_DIM,
  DIM_CV_START,
  F0_KEY,
  M_HIGH_BEAM,
  NMRA_KEYS,
  NO_LEFT_SHIFT_VALUE,
  SWISS_GROUP_COUNT,
  allMappingReadCvs,
  decodeDim,
  decodeFKey,
  decodeMKey,
  decodeSwissOutput,
  encodeDim,
  encodeFKey,
  encodeMKey,
  encodeSwissOutput,
  isNoLeftShift,
  nmraBitForOutput,
  nmraBitOutputs,
  nmraBitSet,
  nmraSetBit,
  swissGroupCvs,
} from "./zimoMapping";

describe("zimoMapping", () => {
  it("lists NMRA CVs 33–46", () => {
    expect(NMRA_KEYS[0]).toEqual({ cv: 33, index: 0 });
    expect(NMRA_KEYS[13]).toEqual({ cv: 46, index: 13 });
  });

  it("uses the same 8 outputs for every key when CV 61 = 97", () => {
    expect(isNoLeftShift(NO_LEFT_SHIFT_VALUE)).toBe(true);
    expect(isNoLeftShift(0)).toBe(false);
    const cols = nmraBitOutputs(true, 10);
    expect(cols).toEqual(["front", "rear", "fo1", "fo2", "fo3", "fo4", "fo5", "fo6"]);
    expect(nmraBitOutputs(true, 0)).toEqual(cols);
  });

  it("shifts higher keys in factory NMRA mode", () => {
    expect(nmraBitOutputs(false, 0)[0]).toBe("front");
    expect(nmraBitOutputs(false, 4)[1]).toBe("fo3");
    expect(nmraBitOutputs(false, 8)[2]).toBe("fo7");
    expect(nmraBitForOutput(false, 4, "fo3")).toBe(1);
    expect(nmraBitForOutput(false, 4, "front")).toBeNull();
    expect(nmraBitForOutput(true, 10, "front")).toBe(0);
  });

  it("toggles NMRA bits", () => {
    expect(nmraBitSet(4, 2)).toBe(true);
    expect(nmraSetBit(0, 2, true)).toBe(4);
    expect(nmraSetBit(4, 2, false)).toBe(0);
  });

  it("places Swiss groups 1–13 at 430 and 14–17 at 800", () => {
    expect(swissGroupCvs(1)).toEqual({ f: 430, m: 431, a1f: 432, a2f: 433, a1r: 434, a2r: 435 });
    expect(swissGroupCvs(13).f).toBe(502);
    expect(swissGroupCvs(14).f).toBe(800);
    expect(swissGroupCvs(17).a2r).toBe(823);
  });

  it("round-trips F-key, invert, and unused", () => {
    expect(decodeFKey(0)).toEqual({ key: 0, invert: false });
    expect(encodeFKey(0, true)).toBe(0);
    expect(decodeFKey(15)).toEqual({ key: 15, invert: false });
    expect(decodeFKey(15 + 128)).toEqual({ key: 15, invert: true });
    expect(encodeFKey(F0_KEY, false)).toBe(29);
    expect(encodeFKey(15, true)).toBe(143);
  });

  it("round-trips M-key flags and high beam", () => {
    expect(decodeMKey(0).key).toBe(0);
    expect(decodeMKey(M_HIGH_BEAM).highBeam).toBe(true);
    expect(encodeMKey({ highBeam: true, key: 1, requireBoth: true, keepFwd: true, keepRev: true })).toBe(
      M_HIGH_BEAM,
    );
    const master = encodeMKey({
      highBeam: false,
      key: F0_KEY,
      requireBoth: true,
      keepFwd: false,
      keepRev: false,
    });
    expect(master).toBe(157);
    expect(decodeMKey(master)).toEqual({
      highBeam: false,
      key: 29,
      requireBoth: true,
      keepFwd: false,
      keepRev: false,
    });
    const flagged = encodeMKey({
      highBeam: false,
      key: 5,
      requireBoth: false,
      keepFwd: true,
      keepRev: true,
    });
    expect(decodeMKey(flagged)).toMatchObject({ key: 5, keepFwd: true, keepRev: true });
  });

  it("packs Swiss outputs and dim slots", () => {
    expect(decodeSwissOutput(0)).toEqual({ output: 0, dimSlot: 0 });
    expect(decodeSwissOutput(14)).toEqual({ output: 14, dimSlot: 0 });
    expect(encodeSwissOutput(3, 1)).toBe(3 | (1 << 5));
    expect(decodeSwissOutput(encodeSwissOutput(15, 5))).toEqual({ output: 15, dimSlot: 5 });
  });

  it("stores dim brightness in bits 3–7 as n×8", () => {
    expect(encodeDim(31, false, false)).toBe(248);
    expect(decodeDim(248).brightness).toBe(31);
    expect(decodeDim(encodeDim(10, true, true))).toEqual({
      brightness: 10,
      flash: true,
      flashInv: true,
    });
  });

  it("lists every mapping CV once", () => {
    const cvs = allMappingReadCvs();
    expect(cvs).toContain(33);
    expect(cvs).toContain(46);
    expect(cvs).toContain(CV_NO_LEFT_SHIFT);
    expect(cvs).toContain(CV_PWM_DIM);
    expect(cvs).toContain(CV_HIGH_BEAM_SPEED);
    expect(cvs).toContain(430);
    expect(cvs).toContain(823);
    expect(cvs).toContain(DIM_CV_START);
    expect(cvs).toContain(512);
    expect(new Set(cvs).size).toBe(cvs.length);
    expect(cvs).toHaveLength(14 + 3 + 17 * 6 + 5);
    expect(swissGroupCvs(SWISS_GROUP_COUNT).a2r).toBe(823);
  });
});
