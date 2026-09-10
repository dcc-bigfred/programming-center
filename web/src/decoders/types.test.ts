import {
  cvWritePriorityOf,
  decoderLabelKey,
  grouped,
  sortCvDiffsForWrite,
  type CvWriteTier,
  type DecoderProfile,
} from "./types";

describe("decoder types", () => {
  it("stamps a group key onto catalogue items", () => {
    expect(grouped("catalog.nmra.speed", [{ cv: 2 }, { cv: 5 }])).toEqual([
      { cv: 2, groupKey: "catalog.nmra.speed" },
      { cv: 5, groupKey: "catalog.nmra.speed" },
    ]);
  });

  it("builds decoder i18n keys", () => {
    expect(decoderLabelKey("zimo-ms450")).toBe("decoder.zimo-ms450");
  });
});

describe("cv write priority", () => {
  const tiers: CvWriteTier[] = [[29], [2, 5, 6], [[67, 94]]];

  it("maps listed CVs, ranges, and unlisted CVs", () => {
    expect(cvWritePriorityOf(29, tiers)).toBe(0);
    expect(cvWritePriorityOf(2, tiers)).toBe(1);
    expect(cvWritePriorityOf(6, tiers)).toBe(1);
    expect(cvWritePriorityOf(67, tiers)).toBe(2);
    expect(cvWritePriorityOf(94, tiers)).toBe(2);
    expect(cvWritePriorityOf(80, tiers)).toBe(2);
    expect(cvWritePriorityOf(3, tiers)).toBe(Infinity);
    expect(cvWritePriorityOf(29, undefined)).toBe(Infinity);
  });

  it("sorts by priority then CV number", () => {
    const profile: DecoderProfile = {
      id: "test",
      features: ["cv"],
      cvs: [],
      writePriority: [[29], [2, 5, 6]],
    };
    const diffs = [
      { cv: 6, value: 58 },
      { cv: 3, value: 10 },
      { cv: 29, value: 46 },
      { cv: 2, value: 8 },
    ];
    expect(sortCvDiffsForWrite(diffs, profile).map((d) => d.cv)).toEqual([29, 2, 6, 3]);
  });

  it("keeps CV-number order when the profile has no writePriority", () => {
    const diffs = [
      { cv: 29, value: 46 },
      { cv: 6, value: 58 },
    ];
    expect(sortCvDiffsForWrite(diffs, undefined).map((d) => d.cv)).toEqual([6, 29]);
    expect(
      sortCvDiffsForWrite(diffs, { id: "nmra", features: ["cv"], cvs: [] }).map((d) => d.cv),
    ).toEqual([6, 29]);
  });
});
