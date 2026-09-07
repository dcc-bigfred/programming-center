import {
  MID_STEP,
  SPEED_STEPS,
  TABLE_CVS,
  allSpeedReadCvs,
  bitopForSpeedTable,
  cabSeconds,
  clampByte,
  clampThreePoint,
  defaultTable28,
  effectiveVhigh,
  hluSeconds,
  is28PointTable,
  sampleMomentum,
  sampleSpeedCurve,
  secondsToCabCv,
  secondsToHluCv,
  speedAtStep,
  speedAtStep28,
  speedAtStep3,
  tableFromValues,
  threeFromValues,
  timeAxisMax,
} from "./zimoSpeed";

const three = { vstart: 10, vmid: 80, vhigh: 200 };

describe("zimoSpeed", () => {
  it("detects CV 29 bit 4 as 28-point table", () => {
    expect(is28PointTable(0)).toBe(false);
    expect(is28PointTable(1 << 4)).toBe(true);
    expect(bitopForSpeedTable(true).orMask).toBe(1 << 4);
    expect((0xff & bitopForSpeedTable(false).andMask) & (1 << 4)).toBe(0);
  });

  it("treats CV 5 of 0 or 1 as full speed", () => {
    expect(effectiveVhigh(0)).toBe(255);
    expect(effectiveVhigh(1)).toBe(255);
    expect(effectiveVhigh(2)).toBe(2);
    expect(effectiveVhigh(200)).toBe(200);
  });

  it("converts cab and HLU seconds", () => {
    expect(cabSeconds(10)).toBeCloseTo(9);
    expect(hluSeconds(10)).toBeCloseTo(4);
    expect(secondsToCabCv(9)).toBe(10);
    expect(secondsToHluCv(4)).toBe(10);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(Number.NaN)).toBe(0);
  });

  it("keeps Vstart ≤ Vmid ≤ Vhigh while dragging", () => {
    const upStart = clampThreePoint(three, 2, 200);
    expect(upStart.vstart).toBe(80);
    const downMid = clampThreePoint(three, 6, 1);
    expect(downMid.vmid).toBe(10);
    const downHigh = clampThreePoint(three, 5, 20);
    expect(downHigh.vhigh).toBe(80);
    const tinyHigh = clampThreePoint({ vstart: 1, vmid: 1, vhigh: 200 }, 5, 1);
    expect(tinyHigh.vhigh).toBe(255);
  });

  it("samples the 3-point curve at the knots", () => {
    expect(speedAtStep3(0, three)).toBe(0);
    expect(speedAtStep3(1, three)).toBeCloseTo(10, 5);
    expect(speedAtStep3(MID_STEP, three)).toBeCloseTo(80, 5);
    expect(speedAtStep3(SPEED_STEPS, three)).toBe(200);
    expect(speedAtStep3(-1, three)).toBe(0);
  });

  it("interpolates the 28-point table", () => {
    const table = Array.from({ length: 28 }, (_, i) => i * 9);
    expect(speedAtStep28(0, table)).toBe(0);
    expect(speedAtStep28(1, table)).toBe(0);
    expect(speedAtStep28(2, table)).toBe(9);
    expect(speedAtStep28(1.5, table)).toBeCloseTo(4.5);
    expect(speedAtStep28(SPEED_STEPS, table)).toBe(table[27]);
    expect(speedAtStep(14, "table", three, table)).toBe(speedAtStep28(14, table));
    expect(speedAtStep(14, "three", three, table)).toBe(speedAtStep3(14, three));
  });

  it("builds default table and value helpers", () => {
    const def = defaultTable28();
    expect(def).toHaveLength(28);
    expect(def[0]).toBeGreaterThan(0);
    expect(def[27]).toBe(255);
    expect(TABLE_CVS).toHaveLength(28);
    expect(TABLE_CVS[0]).toBe(67);
    expect(TABLE_CVS[27]).toBe(94);
    expect(threeFromValues({}).vstart).toBe(1);
    expect(tableFromValues({ 67: 9 })[0]).toBe(9);
  });

  it("samples curves and momentum", () => {
    const curve = sampleSpeedCurve("three", three, defaultTable28(), 10);
    expect(curve).toHaveLength(11);
    expect(curve[0]).toEqual({ x: 0, y: 0 });
    expect(curve[10]?.x).toBe(SPEED_STEPS);
    const accel = sampleMomentum("three", three, defaultTable28(), 9, false, 4);
    expect(accel[0]?.y).toBe(0);
    expect(accel[accel.length - 1]?.y).toBe(200);
    const brake = sampleMomentum("three", three, defaultTable28(), 0, true);
    expect(brake).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ]);
    expect(timeAxisMax([10, 40])).toBeCloseTo(42);
    expect(timeAxisMax([1])).toBe(30);
  });

  it("lists every CV the speed page should read", () => {
    const cvs = allSpeedReadCvs();
    expect(cvs).toContain(29);
    expect(cvs).toContain(2);
    expect(cvs).toContain(67);
    expect(cvs).toContain(94);
    expect(cvs).toContain(349);
    expect(new Set(cvs).size).toBe(cvs.length);
  });
});
