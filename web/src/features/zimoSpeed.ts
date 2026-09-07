/** ZIMO MS/MN speed table and momentum (manual §3.7). */

export const ZIMO_SPEED_DECODER_ID = "zimo-ms450";

export const CV29_SPEED_TABLE_BIT = 4;
export const CAB_SEC_PER_UNIT = 0.9;
export const HLU_SEC_PER_UNIT = 0.4;
export const TIME_AXIS_MIN_S = 30;
export const SPEED_STEPS = 28;
export const TABLE_CV_START = 67;
export const VSTART_CV = 2;
export const VMID_CV = 6;
export const VHIGH_CV = 5;
export const MID_STEP = 14;

export const MOMENTUM_CVS = [3, 4, 49, 50, 309, 349] as const;
export const THREE_POINT_CVS = [VSTART_CV, VMID_CV, VHIGH_CV] as const;
export const TABLE_CVS = Array.from({ length: SPEED_STEPS }, (_, i) => TABLE_CV_START + i);

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

/** CV 5 = 0 or 1 means full speed (255). */
export function effectiveVhigh(cv5: number): number {
  return cv5 <= 1 ? 255 : clampByte(cv5);
}

export function cabSeconds(cv: number): number {
  return Math.max(0, cv) * CAB_SEC_PER_UNIT;
}

export function hluSeconds(cv: number): number {
  return Math.max(0, cv) * HLU_SEC_PER_UNIT;
}

export function secondsToCabCv(seconds: number): number {
  return clampByte(Math.round(seconds / CAB_SEC_PER_UNIT));
}

export function secondsToHluCv(seconds: number): number {
  return clampByte(Math.round(seconds / HLU_SEC_PER_UNIT));
}

export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function defaultTable28(): number[] {
  return Array.from({ length: SPEED_STEPS }, (_, i) => {
    const t = (i + 1) / SPEED_STEPS;
    return clampByte(Math.pow(t, 1.5) * 255);
  });
}

export interface ThreePoint {
  vstart: number;
  vmid: number;
  vhigh: number;
}

/** Keep CV 2 ≤ CV 6 ≤ effective CV 5 while dragging one of the three. */
export function clampThreePoint(current: ThreePoint, which: 2 | 6 | 5, next: number): ThreePoint {
  const vstart = Math.max(1, Math.min(255, Math.round(current.vstart)));
  const vmid = Math.max(1, Math.min(255, Math.round(current.vmid)));
  const hi = effectiveVhigh(current.vhigh);
  if (which === 2) {
    const v = Math.max(1, Math.min(vmid, Math.round(next)));
    return { vstart: v, vmid, vhigh: current.vhigh };
  }
  if (which === 6) {
    const v = Math.max(vstart, Math.min(hi, Math.round(next)));
    return { vstart, vmid: v, vhigh: current.vhigh };
  }
  const v = Math.max(vmid, Math.min(255, Math.round(next)));
  return { vstart, vmid, vhigh: v <= 1 ? 255 : v };
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

/** Monotone cubic through standstill, Vstart, Vmid, Vhigh (Fritsch–Carlson). */
export function speedAtStep3(step: number, curve: ThreePoint): number {
  const hi = effectiveVhigh(curve.vhigh);
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

export function speedAtStep28(step: number, table: number[]): number {
  if (step <= 0) return 0;
  if (step >= SPEED_STEPS) return table[SPEED_STEPS - 1] ?? 0;
  const idx = step - 1;
  const lo = Math.floor(idx);
  const frac = idx - lo;
  const a = table[lo] ?? 0;
  const b = table[Math.min(SPEED_STEPS - 1, lo + 1)] ?? a;
  return a + (b - a) * frac;
}

export function speedAtStep(
  step: number,
  mode: CurveMode,
  three: ThreePoint,
  table: number[],
): number {
  return mode === "table" ? speedAtStep28(step, table) : speedAtStep3(step, three);
}

export function sampleSpeedCurve(
  mode: CurveMode,
  three: ThreePoint,
  table: number[],
  samples = 57,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * SPEED_STEPS;
    out.push({ x, y: speedAtStep(x, mode, three, table) });
  }
  return out;
}

export function sampleMomentum(
  mode: CurveMode,
  three: ThreePoint,
  table: number[],
  durationS: number,
  reverse: boolean,
  samples = 48,
): Point[] {
  const vmax = speedAtStep(SPEED_STEPS, mode, three, table);
  if (durationS <= 0) {
    return reverse
      ? [
          { x: 0, y: vmax },
          { x: 0, y: 0 },
        ]
      : [
          { x: 0, y: 0 },
          { x: 0, y: vmax },
        ];
  }
  const out: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const step = (reverse ? 1 - u : u) * SPEED_STEPS;
    out.push({ x: u * durationS, y: speedAtStep(step, mode, three, table) });
  }
  return out;
}

export function timeAxisMax(durations: number[]): number {
  const peak = durations.reduce((m, d) => Math.max(m, d), 0);
  return Math.max(TIME_AXIS_MIN_S, peak * 1.05);
}

export function tableFromValues(values: Record<number, number>): number[] {
  return TABLE_CVS.map((cv, i) => values[cv] ?? defaultTable28()[i] ?? 0);
}

export function threeFromValues(values: Record<number, number>): ThreePoint {
  return {
    vstart: values[VSTART_CV] ?? 1,
    vmid: values[VMID_CV] ?? 1,
    vhigh: values[VHIGH_CV] ?? 0,
  };
}

export function allSpeedReadCvs(): number[] {
  return [29, ...THREE_POINT_CVS, ...TABLE_CVS, ...MOMENTUM_CVS];
}
