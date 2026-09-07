import {
  cvDiffs,
  discardCvTable,
  ensureCvScope,
  formatCvDiffs,
  getCv,
  rememberRead,
  resetCvTable,
  retargetCvScopeAddress,
  setCv,
  setCvBits,
  setCvs,
} from "./table";

function scope(patch: Partial<{ decoder: string; address: number; station: string }> = {}) {
  ensureCvScope({
    decoder: "nmra",
    address: 3,
    station: "",
    ...patch,
  });
}

describe("CvRegistry table", () => {
  it("stages writes as diffs until a loco read fills the baseline", () => {
    scope();
    setCv(2, 10);
    expect(getCv(2)).toBe(10);
    expect(cvDiffs()).toEqual([{ cv: 2, value: 10 }]);
    rememberRead([{ cv: 2, value: 10 }]);
    expect(cvDiffs()).toEqual([]);
    setCv(2, 11);
    expect(formatCvDiffs(cvDiffs())).toBe("CV2=11");
    discardCvTable();
    expect(getCv(2)).toBe(10);
    expect(cvDiffs()).toEqual([]);
  });

  it("setMany and setBits update the working table", () => {
    scope();
    rememberRead([{ cv: 29, value: 0 }]);
    setCvs([
      { cv: 1, value: 3 },
      { cv: 29, value: 0 },
    ]);
    expect(cvDiffs()).toEqual([{ cv: 1, value: 3 }]);
    setCvBits(29, 0xff, 1 << 5);
    expect(getCv(29)).toBe(32);
  });

  it("does not mix locos: decoder/address/station are the cache key, track is not", () => {
    scope({ decoder: "zimo-ms450", address: 3 });
    rememberRead([{ cv: 8, value: 145 }]);
    ensureCvScope({ decoder: "nmra", address: 3, station: "" });
    expect(getCv(8)).toBeUndefined();
    ensureCvScope({ decoder: "zimo-ms450", address: 4, station: "" });
    expect(getCv(8)).toBeUndefined();
    ensureCvScope({ decoder: "zimo-ms450", address: 3, station: "2" });
    expect(getCv(8)).toBeUndefined();
  });

  it("retargets the scope address without dropping the table", () => {
    scope({ address: 0 });
    rememberRead([
      { cv: 1, value: 12 },
      { cv: 17, value: 0 },
      { cv: 18, value: 0 },
      { cv: 29, value: 0 },
    ]);
    retargetCvScopeAddress(12);
    expect(getCv(1)).toBe(12);
    ensureCvScope({ decoder: "nmra", address: 12, station: "" });
    expect(getCv(1)).toBe(12);
  });

  it("ignores retarget when the snapshot is not a 3-part key", () => {
    resetCvTable();
    retargetCvScopeAddress(9);
    expect(getCv(1)).toBeUndefined();
  });

  it("loads a matching snapshot from sessionStorage", () => {
    scope();
    rememberRead([{ cv: 7, value: 42 }]);
    resetCvTable();
    expect(getCv(7)).toBeUndefined();
    ensureCvScope({ decoder: "nmra", address: 3, station: "" });
    expect(getCv(7)).toBe(42);
  });

  it("treats corrupt sessionStorage as empty", () => {
    sessionStorage.setItem("programming-center.cvRegistry", "{not json");
    ensureCvScope({ decoder: "nmra", address: 1, station: "" });
    expect(getCv(1)).toBeUndefined();
  });
});
