import { cvMatchesFilter, parseCvListFilter } from "./cvListFilter";
import type { CvItem } from "../decoders/types";

const item = (cv: number): CvItem => ({ cv });

describe("parseCvListFilter", () => {
  it("treats blank as empty", () => {
    expect(parseCvListFilter("  ")).toEqual({ kind: "empty" });
  });

  it("parses a bare integer", () => {
    expect(parseCvListFilter("29")).toEqual({ kind: "number", n: 29 });
    expect(parseCvListFilter(" 2 ")).toEqual({ kind: "number", n: 2 });
  });

  it("treats non-integers as text", () => {
    expect(parseCvListFilter("RailCom")).toEqual({ kind: "text", q: "railcom" });
    expect(parseCvListFilter("29a")).toEqual({ kind: "text", q: "29a" });
  });
});

describe("cvMatchesFilter", () => {
  it("matches everything when the filter is empty", () => {
    expect(cvMatchesFilter(item(8), "", undefined, "Manufacturer")).toBe(true);
  });

  it("matches a CV by number", () => {
    expect(cvMatchesFilter(item(2), "2", 40, "Vstart")).toBe(true);
    expect(cvMatchesFilter(item(5), "2", 40, "Vhigh")).toBe(false);
  });

  it("matches a CV whose current value equals the number", () => {
    expect(cvMatchesFilter(item(5), "2", 2, "Vhigh")).toBe(true);
    expect(cvMatchesFilter(item(5), "2", undefined, "Vhigh")).toBe(false);
  });

  it("does not treat a catalogue default as a value", () => {
    expect(cvMatchesFilter({ cv: 5, default: 2 }, "2", undefined, "Vhigh")).toBe(false);
  });

  it("matches description text case-insensitively", () => {
    expect(cvMatchesFilter(item(28), "rail", undefined, "RailCom configuration")).toBe(true);
    expect(cvMatchesFilter(item(1), "rail", undefined, "Primary address")).toBe(false);
  });
});
