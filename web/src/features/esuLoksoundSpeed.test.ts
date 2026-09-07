import {
  EDITABLE_TABLE_CVS,
  SPEED_STEPS,
  TABLE_FIRST_RAW,
  TABLE_LAST_RAW,
  allSpeedReadCvs,
  applyTrim,
  bitopForSpeedTable,
  brakeReducedCv,
  clampThreePoint,
  defaultTable28,
  inverseTrim,
  is28PointTable,
  sampleMomentum,
  scaleTableValue,
  scaledTable,
  threeFromValues,
  unscaleTableValue,
} from "./esuLoksoundSpeed";

describe("esuLoksoundSpeed", () => {
  it("detects CV 29 bit 4 as 28-point table", () => {
    expect(is28PointTable(0)).toBe(false);
    expect(is28PointTable(1 << 4)).toBe(true);
    expect(bitopForSpeedTable(true).orMask).toBe(1 << 4);
    expect((0xff & bitopForSpeedTable(false).andMask) & (1 << 4)).toBe(0);
  });

  it("applies NMRA CV 23/24 trim", () => {
    expect(applyTrim(28, 0)).toBe(28);
    expect(applyTrim(28, 10)).toBe(38);
    expect(applyTrim(28, 128)).toBe(28);
    expect(applyTrim(28, 138)).toBe(18);
    expect(applyTrim(5, 200)).toBe(0);
    expect(inverseTrim(38, 10)).toBe(28);
    expect(inverseTrim(applyTrim(21, 24), 24)).toBe(21);
  });

  it("reduces CV 4 for function brakes", () => {
    expect(brakeReducedCv(100, 0)).toBe(100);
    expect(brakeReducedCv(100, 255)).toBe(0);
    expect(brakeReducedCv(255, 128)).toBe(127);
  });

  it("keeps CV 2 < CV 6 < CV 5", () => {
    const base = { vstart: 10, vmid: 80, vhigh: 200 };
    expect(clampThreePoint(base, 2, 90).vstart).toBe(79);
    expect(clampThreePoint(base, 6, 5).vmid).toBe(11);
    expect(clampThreePoint(base, 5, 50).vhigh).toBe(81);
    const collapsed = clampThreePoint({ vstart: 50, vmid: 50, vhigh: 50 }, 6, 50);
    expect(collapsed.vmid).toBeGreaterThan(collapsed.vstart);
    expect(collapsed.vhigh).toBeGreaterThan(collapsed.vmid);
  });

  it("fixes table ends at 1 and 255 and scales through Vmin/Vmax", () => {
    const raw = defaultTable28();
    expect(raw[0]).toBe(TABLE_FIRST_RAW);
    expect(raw[SPEED_STEPS - 1]).toBe(TABLE_LAST_RAW);
    expect(EDITABLE_TABLE_CVS).not.toContain(67);
    expect(EDITABLE_TABLE_CVS).not.toContain(94);
    const y = scaleTableValue(128, 10, 200);
    expect(unscaleTableValue(y, 10, 200)).toBe(128);
    const scaled = scaledTable(raw, 10, 200);
    expect(scaled[0]).toBe(scaleTableValue(1, 10, 200));
    expect(scaled[SPEED_STEPS - 1]).toBe(scaleTableValue(255, 10, 200));
  });

  it("caps momentum when a brake limit is set", () => {
    const three = threeFromValues({});
    const table = defaultTable28();
    const scaled = scaledTable(table, three.vstart, three.vhigh);
    const capped = sampleMomentum("three", three, scaled, 10, true, 40, 4);
    expect(capped.every((p) => p.y <= 40)).toBe(true);
  });

  it("lists speed CVs including trim and brake slots", () => {
    const cvs = allSpeedReadCvs();
    expect(cvs).toContain(23);
    expect(cvs).toContain(179);
    expect(cvs).toContain(184);
    expect(new Set(cvs).size).toBe(cvs.length);
  });
});
