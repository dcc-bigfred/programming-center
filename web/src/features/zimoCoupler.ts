/** ZIMO MS/MN electric uncoupler (manual §3.23). Effect 48 + packed CV 115/116. */

export const ZIMO_COUPLER_DECODER_ID = "zimo-ms450";
export const UNCOUPLER_EFFECT = 48;

/** Tens-digit seconds for CV 115 pull-in and CV 116 disengage. */
export const ZIMO_TIME_SECONDS = [0, 0.1, 0.2, 0.4, 0.8, 1, 2, 3, 4, 5] as const;

export const KROIS_CV115_PRESETS = [60, 70, 80] as const;

export type CouplerDir = "both" | "fwd" | "rev";

export interface ZimoCouplerOutput {
  id: string;
  cv: number;
}

export const ZIMO_COUPLER_OUTPUTS: ZimoCouplerOutput[] = [
  { id: "front", cv: 125 },
  { id: "rear", cv: 126 },
  { id: "fo1", cv: 127 },
  { id: "fo2", cv: 128 },
  { id: "fo3", cv: 129 },
  { id: "fo4", cv: 130 },
  { id: "fo5", cv: 131 },
  { id: "fo6", cv: 132 },
  { id: "fo7", cv: 159 },
  { id: "fo8", cv: 160 },
];

export const ZIMO_COUPLER_CVS = [115, 116, ...ZIMO_COUPLER_OUTPUTS.map((o) => o.cv)];

export interface Cv115 {
  pullInIndex: number;
  holdPercent: number;
}

export interface Cv116 {
  unload: boolean;
  disengageIndex: number;
  speedStep: number;
}

export function isUncoupler(value: number): boolean {
  return (value & 0xfc) === UNCOUPLER_EFFECT;
}

export function uncouplerDirection(value: number): CouplerDir {
  const d = value & 3;
  if (d === 1) return "fwd";
  if (d === 2) return "rev";
  return "both";
}

export function encodeUncoupler(dir: CouplerDir): number {
  if (dir === "fwd") return UNCOUPLER_EFFECT + 1;
  if (dir === "rev") return UNCOUPLER_EFFECT + 2;
  return UNCOUPLER_EFFECT;
}

/** Enable writes 48/49/50. Disable clears only an uncoupler effect, leaving other effects. */
export function setUncoupler(current: number, enabled: boolean, dir: CouplerDir): number {
  if (!enabled) {
    return isUncoupler(current) ? 0 : current;
  }
  return encodeUncoupler(dir);
}

export function decodeCv115(value: number): Cv115 {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  const ones = v % 10;
  const tens = Math.floor(v / 10) % 10;
  return { pullInIndex: tens, holdPercent: ones * 10 };
}

export function encodeCv115(decoded: Cv115): number {
  const ones = Math.min(9, Math.max(0, Math.round(decoded.holdPercent / 10)));
  const tens = Math.min(9, Math.max(0, Math.round(decoded.pullInIndex)));
  return tens * 10 + ones;
}

export function decodeCv116(value: number): Cv116 {
  const v = Math.max(0, Math.min(199, Math.round(value)));
  const ones = v % 10;
  const tens = Math.floor(v / 10) % 10;
  const hundreds = Math.floor(v / 100) % 10;
  return {
    unload: hundreds === 1,
    disengageIndex: tens,
    speedStep: ones * 4,
  };
}

export function encodeCv116(decoded: Cv116): number {
  const ones = Math.min(9, Math.max(0, Math.round(decoded.speedStep / 4)));
  const tens = Math.min(9, Math.max(0, Math.round(decoded.disengageIndex)));
  const hundreds = decoded.unload ? 1 : 0;
  return hundreds * 100 + tens * 10 + ones;
}

export function timeSeconds(index: number): number {
  return ZIMO_TIME_SECONDS[Math.min(9, Math.max(0, Math.round(index)))] ?? 0;
}
