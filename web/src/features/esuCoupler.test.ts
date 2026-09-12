import {
  couplerFState,
  couplerOutputCvs,
  emptyRowCandidate,
  esuCouplerModes,
  esuTimeSeconds,
  keysOn,
  pagesToAssignCouplerF,
  pagesToShowCouplerF,
  planCouplerFAssign,
  removingShorterThanPush,
  withFKeyOn,
} from "./esuCoupler";
import {
  emptyRow,
  keepsEsuSideTable,
  loksoundV4Mapping,
  loksoundV5Mapping,
  outputConfigPage,
  physicalScanPages,
  rowEntries,
  unreadPages,
  type EsuMappingProfile,
  type EsuRow,
  type IndexedGet,
} from "./esuMapping";

function store() {
  const map = new Map<string, number>();
  const get: IndexedGet = (cv32, cv) => map.get(`${cv32}.${cv}`);
  const set = (cv32: number, cv: number, value: number) => map.set(`${cv32}.${cv}`, value);
  return { get, set, map };
}

function writeRow(
  profile: EsuMappingProfile,
  row: number,
  decoded: EsuRow,
  set: (cv32: number, cv: number, value: number) => void,
) {
  for (const e of rowEntries(profile, row, decoded)) set(e.cv32, e.cv, e.value);
}

function fillPhysicalZeros(
  profile: EsuMappingProfile,
  set: (cv32: number, cv: number, value: number) => void,
) {
  for (const page of physicalScanPages(profile)) {
    for (const cv of page.cvs) set(page.cv32, cv, 0);
  }
}

function aux1F(profile: EsuMappingProfile, fKey: number, extraPhysical: string[] = []): EsuRow {
  return withFKeyOn({ ...emptyRow(profile), physical: ["aux1", ...extraPhysical] }, fKey);
}

describe("esuCoupler", () => {
  it("exposes Krois and ROCO on both families, ESU coupler only on v5, servo only on v4", () => {
    const v4 = esuCouplerModes(loksoundV4Mapping).map((m) => m.id);
    const v5 = esuCouplerModes(loksoundV5Mapping).map((m) => m.id);
    expect(v4).toEqual(["krois", "roco", "servoCoupler"]);
    expect(v5).toEqual(["esuCoupler", "krois", "roco"]);
    expect(esuCouplerModes(loksoundV4Mapping).map((m) => m.value)).toEqual([28, 29, 31]);
    expect(esuCouplerModes(loksoundV5Mapping).map((m) => m.value)).toEqual([21, 28, 29]);
  });

  it("converts waltz time CVs with the 0.016 s unit from the manual", () => {
    expect(esuTimeSeconds(0)).toBe(0);
    expect(esuTimeSeconds(1)).toBeCloseTo(0.016);
    expect(esuTimeSeconds(63)).toBeCloseTo(1.008);
  });

  it("warns when removing time is shorter than push time", () => {
    expect(removingShorterThanPush(10, 20)).toBe(true);
    expect(removingShorterThanPush(20, 10)).toBe(false);
    expect(removingShorterThanPush(20, 20)).toBe(false);
  });

  it("reads only mode and brightness CVs, not the full output-config page", () => {
    const v5 = couplerOutputCvs(loksoundV5Mapping);
    const full = outputConfigPage(loksoundV5Mapping).cvs;
    expect(v5).toHaveLength(loksoundV5Mapping.outputConfigs.length * 2);
    expect(v5.length).toBeLessThan(full.length);
    expect(v5).toContain(loksoundV5Mapping.outputConfigs[0].modeCv);
    expect(v5).toContain(loksoundV5Mapping.outputConfigs[0].brightnessCv);
    expect(v5).not.toContain(loksoundV5Mapping.outputConfigs[0].delayCv);
  });

  it("keeps the ESU side table mounted on mapping and coupler", () => {
    expect(keepsEsuSideTable("/mapping")).toBe(true);
    expect(keepsEsuSideTable("/coupler")).toBe(true);
    expect(keepsEsuSideTable("/cv")).toBe(false);
    expect(keepsEsuSideTable("/")).toBe(false);
  });

  it("scans only physical output CVs, on mapping output pages", () => {
    const v5 = physicalScanPages(loksoundV5Mapping);
    expect(v5.map((p) => p.cv32)).toEqual([8, 9, 10, 11, 12]);
    expect(v5[0].cvs).toHaveLength(16 * 3);
    expect(v5[0].cvs.slice(0, 3)).toEqual([257, 258, 259]);
    const v4 = physicalScanPages(loksoundV4Mapping);
    expect(v4.map((p) => p.cv32)).toEqual([2, 3, 4]);
    expect(v4[0].cvs.slice(0, 2)).toEqual([266, 267]);
  });

  it("skips already-cached mapping CVs", () => {
    const { get, set } = store();
    const pages = physicalScanPages(loksoundV5Mapping);
    set(8, 257, 0);
    const unread = unreadPages(pages, get);
    expect(unread[0]?.cv32).toBe(8);
    expect(unread[0]?.cvs).not.toContain(257);
    expect(unread[0]?.cvs).toContain(258);
  });

  it("reports unread F mapping until physical CVs are loaded", () => {
    const { get } = store();
    expect(couplerFState(loksoundV5Mapping, "aux1", get)).toEqual({ kind: "unread" });
  });

  it("treats all-zero physical CVs as no F mapping", () => {
    const { get, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    expect(couplerFState(loksoundV5Mapping, "aux1", get)).toEqual({ kind: "none" });
  });

  it("reads a dedicated row as a simple F assignment", () => {
    const { get, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    writeRow(loksoundV5Mapping, 5, aux1F(loksoundV5Mapping, 3), set);
    expect(couplerFState(loksoundV5Mapping, "aux1", get)).toEqual({
      kind: "simple",
      row: 5,
      keys: [3],
    });
    const plan = planCouplerFAssign(loksoundV5Mapping, "aux1", 7, get);
    expect(plan).toMatchObject({ kind: "apply", row: 5, overwriteKeys: [3] });
    if (plan.kind === "apply") expect(keysOn(plan.next)).toEqual([7]);
  });

  it("does not overwrite mixed or multiple mapping rows", () => {
    const { get, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    writeRow(loksoundV5Mapping, 5, aux1F(loksoundV5Mapping, 3, ["headlight"]), set);
    expect(couplerFState(loksoundV5Mapping, "aux1", get)).toEqual({
      kind: "complex",
      keys: [3],
    });
    expect(planCouplerFAssign(loksoundV5Mapping, "aux1", 4, get)).toEqual({ kind: "complex" });

    const two = store();
    fillPhysicalZeros(loksoundV5Mapping, two.set);
    writeRow(loksoundV5Mapping, 5, aux1F(loksoundV5Mapping, 3), two.set);
    writeRow(loksoundV5Mapping, 6, aux1F(loksoundV5Mapping, 8), two.set);
    expect(couplerFState(loksoundV5Mapping, "aux1", two.get)).toEqual({
      kind: "complex",
      keys: [3, 8],
    });
  });

  it("assigns a new F key to the last empty mapping row", () => {
    const { get, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    writeRow(loksoundV5Mapping, 72, emptyRow(loksoundV5Mapping), set);
    expect(emptyRowCandidate(loksoundV5Mapping, get)).toEqual({ kind: "found", row: 72 });
    const plan = planCouplerFAssign(loksoundV5Mapping, "aux1", 2, get);
    expect(plan).toMatchObject({ kind: "apply", row: 72, overwriteKeys: [] });
    if (plan.kind === "apply") {
      expect(plan.next.physical).toEqual(["aux1"]);
      expect(keysOn(plan.next)).toEqual([2]);
      expect(plan.next.logic).toEqual([]);
    }
  });

  it("asks for the last unread row when creating a mapping", () => {
    const { get, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    expect(emptyRowCandidate(loksoundV5Mapping, get)).toEqual({ kind: "need", row: 72 });
    const pages = pagesToAssignCouplerF(loksoundV5Mapping, "aux1", get);
    expect(pages.some((p) => p.cv32 === 12)).toBe(true);
  });

  it("loads physical pages first, then only matching full rows", () => {
    const { get } = store();
    const show = pagesToShowCouplerF(loksoundV5Mapping, ["aux1"], get);
    expect(show.map((p) => p.cv32)).toEqual([8, 9, 10, 11, 12]);
    const { get: afterPhys, set } = store();
    fillPhysicalZeros(loksoundV5Mapping, set);
    writeRow(loksoundV5Mapping, 5, aux1F(loksoundV5Mapping, 3), set);
    const next = pagesToShowCouplerF(loksoundV5Mapping, ["aux1"], afterPhys);
    expect(next.every((p) => p.cv32 === 3 || p.cv32 === 8)).toBe(true);
  });
});
