/** ZIMO MS/MN function mapping (manual §3.14–3.17). */

export const ZIMO_MAPPING_DECODER_ID = "zimo-ms450";

export const NMRA_CV_START = 33;
export const NMRA_KEY_COUNT = 14;
export const CV_NO_LEFT_SHIFT = 61;
export const NO_LEFT_SHIFT_VALUE = 97;
export const CV_PWM_DIM = 60;
export const CV_HIGH_BEAM_SPEED = 399;
export const DIM_CV_START = 508;
export const DIM_SLOT_COUNT = 5;
export const SWISS_GROUP_COUNT = 17;
export const M_HIGH_BEAM = 255;
export const F0_KEY = 29;

export const NMRA_OUTPUTS: NmraOutput[] = [
  "front",
  "rear",
  "fo1",
  "fo2",
  "fo3",
  "fo4",
  "fo5",
  "fo6",
  "fo7",
  "fo8",
  "fo9",
  "fo10",
  "fo11",
  "fo12",
];

export type NmraOutput =
  | "front"
  | "rear"
  | "fo1"
  | "fo2"
  | "fo3"
  | "fo4"
  | "fo5"
  | "fo6"
  | "fo7"
  | "fo8"
  | "fo9"
  | "fo10"
  | "fo11"
  | "fo12";

export interface NmraKey {
  cv: number;
  /** 0 = F0 forward, 1 = F0 reverse, 2 = F1 … 13 = F12 */
  index: number;
}

export const NMRA_KEYS: NmraKey[] = Array.from({ length: NMRA_KEY_COUNT }, (_, i) => ({
  cv: NMRA_CV_START + i,
  index: i,
}));

export function isNoLeftShift(cv61: number): boolean {
  return cv61 === NO_LEFT_SHIFT_VALUE;
}

function rangeFo(from: number, to: number): NmraOutput[] {
  const out: NmraOutput[] = [];
  for (let n = from; n <= to; n++) {
    out.push(`fo${n}` as NmraOutput);
  }
  return out;
}

/** Bit 0…7 → output for one NMRA mapping CV. */
export function nmraBitOutputs(noLeftShift: boolean, keyIndex: number): NmraOutput[] {
  if (noLeftShift || keyIndex <= 3) {
    return ["front", "rear", ...rangeFo(1, 6)];
  }
  if (keyIndex <= 7) {
    return ["fo2", "fo3", "fo4", "fo5", "fo6", "fo7", "fo8", "fo9"];
  }
  return ["fo5", "fo6", "fo7", "fo8", "fo9", "fo10", "fo11", "fo12"];
}

/** Which bit (0–7) drives `output` for this key, or `null` if that wire is not in the mask. */
export function nmraBitForOutput(
  noLeftShift: boolean,
  keyIndex: number,
  output: NmraOutput,
): number | null {
  const bit = nmraBitOutputs(noLeftShift, keyIndex).indexOf(output);
  return bit >= 0 ? bit : null;
}

export function nmraBitSet(value: number, bit: number): boolean {
  return ((value >> bit) & 1) === 1;
}

export function nmraSetBit(value: number, bit: number, on: boolean): number {
  const mask = 1 << bit;
  return on ? value | mask : value & ~mask & 0xff;
}

export interface SwissGroupCvs {
  f: number;
  m: number;
  a1f: number;
  a2f: number;
  a1r: number;
  a2r: number;
}

/** Groups 1–13 at CV 430+, groups 14–17 at CV 800+. `group` is 1–17. */
export function swissGroupCvs(group: number): SwissGroupCvs {
  const start = group <= 13 ? 430 + (group - 1) * 6 : 800 + (group - 14) * 6;
  return {
    f: start,
    m: start + 1,
    a1f: start + 2,
    a2f: start + 3,
    a1r: start + 4,
    a2r: start + 5,
  };
}

export function dimCv(slot: number): number {
  return DIM_CV_START + slot - 1;
}

export interface FKey {
  /** 0 = unused group; 1–28 = F1–F28; 29 = F0 */
  key: number;
  invert: boolean;
}

export function decodeFKey(cv: number): FKey {
  const invert = (cv & 0x80) !== 0;
  const key = cv & 0x7f;
  if (key === 0) return { key: 0, invert: false };
  return { key: Math.min(F0_KEY, key), invert };
}

export function encodeFKey(key: number, invert: boolean): number {
  if (key <= 0) return 0;
  const k = Math.min(F0_KEY, Math.max(0, Math.round(key)));
  return (invert ? 0x80 : 0) + k;
}

export interface MKey {
  highBeam: boolean;
  /** 0 = none; 1–28 = Fn; 29 = F0 */
  key: number;
  requireBoth: boolean;
  keepFwd: boolean;
  keepRev: boolean;
}

export function decodeMKey(cv: number): MKey {
  if (cv === M_HIGH_BEAM) {
    return { highBeam: true, key: 0, requireBoth: false, keepFwd: false, keepRev: false };
  }
  return {
    highBeam: false,
    key: cv & 0x1f,
    requireBoth: (cv & 0x80) !== 0,
    keepFwd: (cv & 0x40) !== 0,
    keepRev: (cv & 0x20) !== 0,
  };
}

export function encodeMKey(m: MKey): number {
  if (m.highBeam) return M_HIGH_BEAM;
  if (m.key <= 0) return 0;
  const k = Math.min(F0_KEY, m.key) & 0x1f;
  return k | (m.keepRev ? 0x20 : 0) | (m.keepFwd ? 0x40 : 0) | (m.requireBoth ? 0x80 : 0);
}

/** 0 unused, 1–13 FO, 14 = front light, 15 = rear light. */
export interface SwissOutput {
  output: number;
  /** 0 = none; 1–5 = CV 508–512 */
  dimSlot: number;
}

export function decodeSwissOutput(cv: number): SwissOutput {
  return { output: cv & 0x0f, dimSlot: Math.min(5, (cv >> 5) & 7) };
}

export function encodeSwissOutput(output: number, dimSlot: number): number {
  const o = Math.min(15, Math.max(0, Math.round(output)));
  const d = Math.min(5, Math.max(0, Math.round(dimSlot)));
  return (o & 0x0f) | ((d & 7) << 5);
}

export interface DimLevel {
  /** 0 = dark, 31 = full */
  brightness: number;
  flash: boolean;
  flashInv: boolean;
}

export function decodeDim(cv: number): DimLevel {
  return {
    brightness: (cv >> 3) & 31,
    flash: (cv & 2) !== 0,
    flashInv: (cv & 4) !== 0,
  };
}

export function encodeDim(brightness: number, flash: boolean, flashInv: boolean): number {
  const b = Math.min(31, Math.max(0, Math.round(brightness)));
  return (b << 3) | (flash ? 2 : 0) | (flashInv ? 4 : 0);
}

export function swissGroupList(): SwissGroupCvs[] {
  return Array.from({ length: SWISS_GROUP_COUNT }, (_, i) => swissGroupCvs(i + 1));
}

export function allMappingReadCvs(): number[] {
  const swiss = swissGroupList().flatMap((g) => [g.f, g.m, g.a1f, g.a2f, g.a1r, g.a2r]);
  const dims = Array.from({ length: DIM_SLOT_COUNT }, (_, i) => DIM_CV_START + i);
  return [
    ...NMRA_KEYS.map((k) => k.cv),
    CV_NO_LEFT_SHIFT,
    CV_PWM_DIM,
    CV_HIGH_BEAM_SPEED,
    ...swiss,
    ...dims,
  ];
}
