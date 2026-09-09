import {
  ADDRESS_CVS,
  ADDRESS_READ_CVS,
  CV29_LONG_BIT,
  LONG_MAX,
  RAILCOM_PLUS_MASK,
  SHORT_MAX,
  bitopForLong,
  decodeAddress,
  decodeAddressFromCvs,
  encodeLongBytes,
  isLongAddressBit,
  planWrite,
  readRailcomPlus,
} from "./dccAddress";

describe("dccAddress", () => {
  it("treats CV 29 bit 5 as long address by default", () => {
    expect(isLongAddressBit(0)).toBe(false);
    expect(isLongAddressBit(1 << CV29_LONG_BIT)).toBe(true);
    expect(isLongAddressBit(1 << 3, 3)).toBe(true);
  });

  it("decodes short address from CV 1", () => {
    expect(decodeAddress(3, 0xc0, 0, 0)).toEqual({ address: 3, long: false });
    expect(decodeAddress(0xff, 0, 0, 0).address).toBe(0x7f);
  });

  it("decodes long address from CV 17/18 when bit is set", () => {
    const { cv17, cv18 } = encodeLongBytes(128);
    expect(decodeAddress(3, cv17, cv18, 1 << CV29_LONG_BIT)).toEqual({
      address: 128,
      long: true,
    });
    const high = encodeLongBytes(10239);
    expect(decodeAddress(0, high.cv17, high.cv18, 1 << CV29_LONG_BIT).address).toBe(10239);
  });

  it("round-trips long bytes for 128–LONG_MAX", () => {
    for (const addr of [128, 255, 256, 1000, LONG_MAX]) {
      const { cv17, cv18 } = encodeLongBytes(addr);
      expect(cv17 & 0xc0).toBe(0xc0);
      expect(decodeAddress(0, cv17, cv18, 1 << CV29_LONG_BIT).address).toBe(addr);
    }
  });

  it("clamps encodeLongBytes", () => {
    expect(encodeLongBytes(-10)).toEqual(encodeLongBytes(0));
    expect(encodeLongBytes(99999)).toEqual(encodeLongBytes(LONG_MAX));
  });

  it("returns null from decodeAddressFromCvs unless all four CVs are present", () => {
    expect(decodeAddressFromCvs([{ cv: 1, value: 3 }])).toBeNull();
    expect(
      decodeAddressFromCvs([
        { cv: 1, value: 3 },
        { cv: 17, value: 0 },
        { cv: 18, value: 0 },
        { cv: 29, value: 0 },
      ]),
    ).toEqual({ address: 3, long: false });
  });

  it("plans short and long writes", () => {
    expect(planWrite(0)).toBeNull();
    expect(planWrite(1.5)).toBeNull();
    expect(planWrite(LONG_MAX + 1)).toBeNull();
    expect(planWrite(SHORT_MAX)).toEqual({ cvs: [{ cv: 1, value: 127 }], long: false });
    expect(planWrite(SHORT_MAX + 1)?.long).toBe(true);
    expect(planWrite(128)?.cvs.map((c) => c.cv)).toEqual([17, 18]);
  });

  it("bitopForLong sets or clears the long-address bit", () => {
    expect(bitopForLong(true)).toEqual({ andMask: 0xff, orMask: 1 << 5 });
    expect(bitopForLong(false).orMask).toBe(0);
    expect((0xff & bitopForLong(false).andMask) & (1 << 5)).toBe(0);
    const railbox = bitopForLong(true, 3);
    expect(railbox.orMask).toBe(1 << 3);
  });

  it("exposes address CVs for a programming-track read", () => {
    expect([...ADDRESS_CVS]).toEqual([1, 17, 18, 29]);
    expect([...ADDRESS_READ_CVS]).toEqual([1, 17, 18, 28, 29]);
  });

  it("reads RailComPlus from CV 28 bit 7", () => {
    expect(readRailcomPlus([])).toBeNull();
    expect(readRailcomPlus([{ cv: 28, value: 131 }])).toBe(true);
    expect(readRailcomPlus([{ cv: 28, value: 3 }])).toBe(false);
    expect(RAILCOM_PLUS_MASK).toBe(0x80);
  });
});
