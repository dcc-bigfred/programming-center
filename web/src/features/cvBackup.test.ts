import { formatCvBackup, parseCvBackup } from "./cvBackup";

describe("cvBackup", () => {
  it("formats sorted cvN=value lines with a trailing newline", () => {
    expect(formatCvBackup([])).toBe("");
    expect(
      formatCvBackup([
        { cv: 8, value: 145 },
        { cv: 1, value: 3 },
      ]),
    ).toBe("cv1=3\ncv8=145\n");
  });

  it("round-trips a dump", () => {
    const text = formatCvBackup([
      { cv: 1, value: 3 },
      { cv: 29, value: 6 },
    ]);
    expect(parseCvBackup(text)).toEqual({
      cvs: [
        { cv: 1, value: 3 },
        { cv: 29, value: 6 },
      ],
    });
  });

  it("skips comments, blanks, and ERROR values", () => {
    const parsed = parseCvBackup(`
# header
cv1=3
cv2=error
CV8=145 # trailing
cv17=ERROR
`);
    expect(parsed.errorLine).toBeUndefined();
    expect(parsed.cvs).toEqual([
      { cv: 1, value: 3 },
      { cv: 8, value: 145 },
    ]);
  });

  it("expands cvX-cvY ranges", () => {
    expect(parseCvBackup("cv10-cv12=7")).toEqual({
      cvs: [
        { cv: 10, value: 7 },
        { cv: 11, value: 7 },
        { cv: 12, value: 7 },
      ],
    });
    expect(parseCvBackup("5-6=1").cvs).toEqual([
      { cv: 5, value: 1 },
      { cv: 6, value: 1 },
    ]);
  });

  it("last assignment wins on duplicates", () => {
    expect(parseCvBackup("cv1=1\ncv1=9").cvs).toEqual([{ cv: 1, value: 9 }]);
  });

  it("rejects invalid lines", () => {
    expect(parseCvBackup("nope").errorLine).toBe("nope");
    expect(parseCvBackup("cv1=300").errorLine).toBe("cv1=300");
    expect(parseCvBackup("cv0=1").errorLine).toBe("cv0=1");
    expect(parseCvBackup("cv1025=1").errorLine).toBe("cv1025=1");
    expect(parseCvBackup("cv5-cv3=1").errorLine).toBe("cv5-cv3=1");
    expect(parseCvBackup("cv1=-1").errorLine).toBe("cv1=-1");
  });
});
