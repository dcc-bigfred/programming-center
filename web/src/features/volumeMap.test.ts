import { decodeVolume, encodeVolume, volumeMapFor } from "./volumeMap";

describe("volumeMap", () => {
  it("looks up catalogue maps", () => {
    expect(volumeMapFor("zimo-ms450")).toEqual({ cv: 266, max: 65 });
    expect(volumeMapFor("loksound-v5")).toEqual({ cv: 63, max: 192 });
    expect(volumeMapFor("loksound-v4")).toEqual({ cv: 63, max: 64 });
    expect(volumeMapFor("rb23xx")).toEqual({ cv: 203, max: 64 });
    expect(volumeMapFor("rb2300")).toEqual({ cv: 203, max: 64 });
    expect(volumeMapFor("nmra")).toBeUndefined();
  });

  it("encodes percent 0–100 into 0–max", () => {
    expect(encodeVolume(0, 64)).toBe(0);
    expect(encodeVolume(100, 64)).toBe(64);
    expect(encodeVolume(50, 64)).toBe(32);
    expect(encodeVolume(-10, 65)).toBe(0);
    expect(encodeVolume(150, 65)).toBe(65);
    expect(encodeVolume(49.6, 100)).toBe(50);
  });

  it("decodes a CV byte back to percent", () => {
    expect(decodeVolume(0, 64)).toBe(0);
    expect(decodeVolume(64, 64)).toBe(100);
    expect(decodeVolume(32, 64)).toBe(50);
    expect(decodeVolume(999, 64)).toBe(100);
    expect(decodeVolume(10, 0)).toBe(0);
  });
});
