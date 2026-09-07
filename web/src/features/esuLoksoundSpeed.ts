/** ESU LokSound 5 speed curve and momentum (manual §1, Appendix B). */

export const LOKSOUND_V5_DECODER_ID = "loksound-v5";

export const CV29_SPEED_TABLE_BIT = 4;
/** LokSound 5 DCC: seconds per CV 3/4 unit (Appendix B). */
export const CAB_SEC_PER_UNIT = 0.896;
export const TIME_AXIS_MIN_S = 30;
export const SPEED_STEPS = 28;
export const TABLE_CV_START = 67;
export const VSTART_CV = 2;
export const VMID_CV = 6;
export const VHIGH_CV = 5;
export const MID_STEP = 14;
export const TABLE_FIRST_RAW = 1;
export const TABLE_LAST_RAW = 255;

export const THREE_POINT_CVS = [VSTART_CV, VMID_CV, VHIGH_CV] as const;
export const TABLE_CVS = Array.from({ length: SPEED_STEPS }, (_, i) => TABLE_CV_START + i);
/** CV 67 and 94 stay 1 and 255; only the middle 26 points are dragged. */
export const EDITABLE_TABLE_CVS = TABLE_CVS.filter((cv) => cv !== 67 && cv !== 94);
export const TRIM_CVS = [23, 24] as const;
export const BRAKE_REDUCE_CVS = [179, 180, 181] as const;
export const BRAKE_LIMIT_CVS = [182, 183, 184] as const;
export const MOMENTUM_CVS = [3, 4, ...TRIM_CVS, ...BRAKE_REDUCE_CVS, ...BRAKE_LIMIT_CVS] as const;

export type CurveMode = "three" | "table";

export function is28PointTable(cv29: number): boolean {
  return ((cv29 >> CV29_SPEED_TABLE_BIT) & 1) === 1;
}

export function bitopForSpeedTable(table28: boolean): { andMask: number; orMask: number } {
  const mask = 1 << CV29_SPEED_TABLE_BIT;
  if (table28) {
    return { andMask: 0xff, orMask: mask };
  }
  return { andMask: (~mask) & 0xff, orMask: 0 };
}

export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

/** NMRA CV 23/24: 0–127 add, 128–255 subtract (bit 7). */
export function applyTrim(base: number, trim: number): number {
  const t = clampByte(trim);
  const delta = t < 128 ? t : -(t - 128);
  return clampByte(base + delta);
}

export function inverseTrim(effective: number, trim: number): number {
  const t = clampByte(trim);
  const delta = t < 128 ? t : -(t - 128);
  return clampByte(effective - delta);
}

export function cabSeconds(cv: number): number {
  return Math.max(0, cv) * CAB_SEC_PER_UNIT;
}

export function secondsToCabCv(seconds: number): number {
  return clampByte(Math.round(seconds / CAB_SEC_PER_UNIT));
}

export function brakeReducedCv(cv4: number, reduction: number): number {
  const red = clampByte(reduction);
  return clampByte((cv4 * (255 - red)) / 255);
}

export interface ThreePoint {
  vstart: number;
  vmid: number;
  vhigh: number;
}

/** Keep CV 2 < CV 6 < CV 5 (ESU: violating the order is erratic). */
export function clampThreePoint(current: ThreePoint, which: 2 | 6 | 5, next: number): ThreePoint {
  let vstart = Math.max(1, Math.min(255, Math.round(current.vstart)));
  let vmid = Math.max(1, Math.min(255, Math.round(current.vmid)));
  let vhigh = Math.max(0, Math.min(255, Math.round(current.vhigh)));
  if (vmid <= vstart) vmid = Math.min(255, vstart + 1);
  if (vhigh <= vmid) vhigh = Math.min(255, vmid + 1);
  if (which === 2) {
    const v = Math.max(1, Math.min(vmid - 1, Math.round(next)));
    return { vstart: v, vmid, vhigh };
  }
  if (which === 6) {
    const v = Math.max(vstart + 1, Math.min(vhigh - 1, Math.round(next)));
    return { vstart, vmid: v, vhigh };
  }
  const v = Math.max(vmid + 1, Math.min(255, Math.round(next)));
  return { vstart, vmid, vhigh: v };
}

/** CV 67=1 … CV 94=255, ease in between. */
export function defaultTable28(): number[] {
  return Array.from({ length: SPEED_STEPS }, (_, i) => {
    if (i === 0) return TABLE_FIRST_RAW;
    if (i === SPEED_STEPS - 1) return TABLE_LAST_RAW;
    const t = i / (SPEED_STEPS - 1);
    return clampByte(TABLE_FIRST_RAW + Math.pow(t, 1.5) * (TABLE_LAST_RAW - TABLE_FIRST_RAW));
  });
}

/** Map a raw table byte through Vmin (CV 2) and Vmax (CV 5). */
export function scaleTableValue(raw: number, vmin: number, vmax: number): number {
  const lo = Math.max(1, Math.min(255, vmin));
  const hi = Math.max(lo, Math.min(255, vmax));
  if (hi <= lo) return lo;
  const r = Math.min(TABLE_LAST_RAW, Math.max(TABLE_FIRST_RAW, raw));
  return lo + ((r - TABLE_FIRST_RAW) * (hi - lo)) / (TABLE_LAST_RAW - TABLE_FIRST_RAW);
}

export function unscaleTableValue(scaled: number, vmin: number, vmax: number): number {
  const lo = Math.max(1, Math.min(255, vmin));
  const hi = Math.max(lo, Math.min(255, vmax));
  if (hi <= lo) return TABLE_FIRST_RAW;
  const y = Math.min(hi, Math.max(lo, scaled));
  return clampByte(
    TABLE_FIRST_RAW + ((y - lo) * (TABLE_LAST_RAW - TABLE_FIRST_RAW)) / (hi - lo),
  );
}

export function scaledTable(table: number[], vmin: number, vmax: number): number[] {
  return table.map((raw, i) => {
    if (i === 0) return scaleTableValue(TABLE_FIRST_RAW, vmin, vmax);
    if (i === SPEED_STEPS - 1) return scaleTableValue(TABLE_LAST_RAW, vmin, vmax);
    return scaleTableValue(raw, vmin, vmax);
  });
}

export interface Point {
  x: number;
  y: number;
}

function hermite(y0: number, y1: number, m0: number, m1: number, t: number, h: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  );
}

export function speedAtStep3(step: number, curve: ThreePoint): number {
  const hi = Math.max(0, Math.min(255, curve.vhigh));
  const xs = [0, 1, MID_STEP, SPEED_STEPS];
  const ys = [0, curve.vstart, curve.vmid, hi];
  if (step <= xs[0]) return ys[0];
  if (step >= xs[xs.length - 1]) return ys[ys.length - 1];

  const n = xs.length - 1;
  const delta: number[] = [];
  for (let i = 0; i < n; i++) {
    delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const m: number[] = new Array(xs.length);
  m[0] = delta[0];
  m[n] = delta[n - 1];
  for (let i = 1; i < n; i++) {
    if (delta[i - 1] === 0 || delta[i] === 0 || Math.sign(delta[i - 1]) !== Math.sign(delta[i])) {
      m[i] = 0;
    } else {
      m[i] = (delta[i - 1] + delta[i]) / 2;
    }
  }
  for (let i = 0; i < n; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i] / delta[i];
    const beta = m[i + 1] / delta[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * delta[i];
      m[i + 1] = tau * beta * delta[i];
    }
  }

  let i = 0;
  while (i < n && step > xs[i + 1]) i += 1;
  const h = xs[i + 1] - xs[i];
  const t = (step - xs[i]) / h;
  return Math.min(255, Math.max(0, hermite(ys[i], ys[i + 1], m[i], m[i + 1], t, h)));
}

export function speedAtStep28(step: number, scaled: number[]): number {
  if (step <= 0) return 0;
  if (step >= SPEED_STEPS) return scaled[SPEED_STEPS - 1] ?? 0;
  const idx = step - 1;
  const lo = Math.floor(idx);
  const frac = idx - lo;
  const a = scaled[lo] ?? 0;
  const b = scaled[Math.min(SPEED_STEPS - 1, lo + 1)] ?? a;
  return a + (b - a) * frac;
}

export function speedAtStep(
  step: number,
  mode: CurveMode,
  three: ThreePoint,
  scaled: number[],
): number {
  return mode === "table" ? speedAtStep28(step, scaled) : speedAtStep3(step, three);
}

export function sampleSpeedCurve(
  mode: CurveMode,
  three: ThreePoint,
  scaled: number[],
  samples = 57,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * SPEED_STEPS;
    out.push({ x, y: speedAtStep(x, mode, three, scaled) });
  }
  return out;
}

export function sampleMomentum(
  mode: CurveMode,
  three: ThreePoint,
  scaled: number[],
  durationS: number,
  reverse: boolean,
  yCap = 0,
  samples = 48,
): Point[] {
  const vmax = speedAtStep(SPEED_STEPS, mode, three, scaled);
  const cap = yCap > 0 ? Math.min(vmax, yCap) : vmax;
  const yAt = (step: number) => {
    const y = speedAtStep(step, mode, three, scaled);
    return yCap > 0 ? Math.min(y, cap) : y;
  };
  if (durationS <= 0) {
    return reverse
      ? [
          { x: 0, y: cap },
          { x: 0, y: 0 },
        ]
      : [
          { x: 0, y: 0 },
          { x: 0, y: cap },
        ];
  }
  const out: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const step = (reverse ? 1 - u : u) * SPEED_STEPS;
    out.push({ x: u * durationS, y: yAt(step) });
  }
  return out;
}

export function timeAxisMax(durations: number[]): number {
  const peak = durations.reduce((m, d) => Math.max(m, d), 0);
  return Math.max(TIME_AXIS_MIN_S, peak * 1.05);
}

export function tableFromValues(values: Record<number, number>): number[] {
  const fallback = defaultTable28();
  return TABLE_CVS.map((cv, i) => values[cv] ?? fallback[i] ?? 0);
}

export function threeFromValues(values: Record<number, number>): ThreePoint {
  return {
    vstart: values[VSTART_CV] ?? 3,
    vmid: values[VMID_CV] ?? 151,
    vhigh: values[VHIGH_CV] ?? 255,
  };
}

export function allSpeedReadCvs(): number[] {
  return [29, ...THREE_POINT_CVS, ...TABLE_CVS, ...MOMENTUM_CVS];
}
