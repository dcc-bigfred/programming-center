import {
  discardIndexedCvTable,
  ensureIndexedCvScope,
  flushIndexedCvTable,
  getIndexedCv,
  indexedCvDiffs,
  rememberIndexedRead,
  resetIndexedCvTable,
  setIndexedCv,
  setIndexedCvs,
} from "./indexedTable";

function scope(patch: Partial<{ decoder: string; address: number; station: string }> = {}) {
  ensureIndexedCvScope({
    decoder: "loksound-v5",
    address: 3,
    station: "",
    ...patch,
  });
}

describe("indexed CV table", () => {
  afterEach(() => {
    resetIndexedCvTable();
    sessionStorage.clear();
  });

  it("keeps the same CV number on different CV32 pages apart", () => {
    scope();
    rememberIndexedRead([
      { key: "16.3.257", value: 20 },
      { key: "16.8.257", value: 1 },
    ]);
    expect(getIndexedCv("16.3.257")).toBe(20);
    expect(getIndexedCv("16.8.257")).toBe(1);
    setIndexedCv("16.3.257", 22);
    expect(indexedCvDiffs()).toEqual([
      { key: "16.3.257", cv31: 16, cv32: 3, cv: 257, value: 22 },
    ]);
    expect(getIndexedCv("16.8.257")).toBe(1);
  });

  it("does not mix locos", () => {
    scope({ decoder: "loksound-v5", address: 3 });
    rememberIndexedRead([{ key: "16.3.257", value: 5 }]);
    ensureIndexedCvScope({ decoder: "loksound-v4", address: 3, station: "" });
    expect(getIndexedCv("16.3.257")).toBeUndefined();
  });

  it("discards staged values back to the last read", () => {
    scope();
    rememberIndexedRead([{ key: "16.0.259", value: 1 }]);
    setIndexedCvs([{ key: "16.0.259", value: 6 }]);
    discardIndexedCvTable();
    expect(getIndexedCv("16.0.259")).toBe(1);
    expect(indexedCvDiffs()).toEqual([]);
  });

  it("reloads a matching snapshot from sessionStorage", () => {
    scope();
    rememberIndexedRead([{ key: "16.2.257", value: 9 }]);
    flushIndexedCvTable();
    resetIndexedCvTable();
    expect(getIndexedCv("16.2.257")).toBeUndefined();
    ensureIndexedCvScope({ decoder: "loksound-v5", address: 3, station: "" });
    expect(getIndexedCv("16.2.257")).toBe(9);
  });
});
