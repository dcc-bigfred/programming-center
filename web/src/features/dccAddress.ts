/** NMRA short (CV 1) / long (CV 17+18, CV 29 bit 5) DCC address. */

export const SHORT_MAX = 127;
export const LONG_MAX = 10239;
export const CV29_LONG_BIT = 5;
export const CV29_LONG_MASK = 1 << CV29_LONG_BIT;

export const ADDRESS_CVS = [1, 17, 18, 29] as const;

export function isLongAddressBit(cv29: number, bit = CV29_LONG_BIT): boolean {
  return ((cv29 >> bit) & 1) === 1;
}

export function decodeAddressFromCvs(
  cvs: ReadonlyArray<{ cv: number; value: number }>,
  longBit = CV29_LONG_BIT,
): { address: number; long: boolean } | null {
  const byCv = new Map(cvs.map((e) => [e.cv, e.value]));
  const cv1 = byCv.get(1);
  const cv17 = byCv.get(17);
  const cv18 = byCv.get(18);
  const cv29 = byCv.get(29);
  if (cv1 === undefined || cv17 === undefined || cv18 === undefined || cv29 === undefined) {
    return null;
  }
  return decodeAddress(cv1, cv17, cv18, cv29, longBit);
}

export function decodeAddress(
  cv1: number,
  cv17: number,
  cv18: number,
  cv29: number,
  longBit = CV29_LONG_BIT,
): {
  address: number;
  long: boolean;
} {
  if (isLongAddressBit(cv29, longBit)) {
    return { address: ((cv17 & 0x3f) << 8) | (cv18 & 0xff), long: true };
  }
  return { address: cv1 & 0x7f, long: false };
}

export function encodeLongBytes(address: number): { cv17: number; cv18: number } {
  const n = Math.min(LONG_MAX, Math.max(0, address));
  return {
    cv17: ((n >> 8) & 0x3f) | 0xc0,
    cv18: n & 0xff,
  };
}

export function bitopForLong(
  long: boolean,
  bit = CV29_LONG_BIT,
): { andMask: number; orMask: number } {
  const mask = 1 << bit;
  if (long) {
    return { andMask: 0xff, orMask: mask };
  }
  return { andMask: (~mask) & 0xff, orMask: 0 };
}

/** 1–127 → short (CV 1); 128–10239 → long (CV 17/18). */
export function planWrite(address: number): {
  cvs: { cv: number; value: number }[];
  long: boolean;
} | null {
  if (!Number.isInteger(address) || address < 1 || address > LONG_MAX) {
    return null;
  }
  if (address <= SHORT_MAX) {
    return { cvs: [{ cv: 1, value: address }], long: false };
  }
  const { cv17, cv18 } = encodeLongBytes(address);
  return {
    cvs: [
      { cv: 17, value: cv17 },
      { cv: 18, value: cv18 },
    ],
    long: true,
  };
}
