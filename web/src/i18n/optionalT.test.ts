import { optionalT } from "./core";

describe("optionalT", () => {
  it("returns copy for known keys and nothing for missing ones", () => {
    expect(optionalT("features.backup")).toBeTruthy();
    expect(optionalT("errors.decoder_absent")).toBeTruthy();
    expect(optionalT("does.not.exist")).toBeUndefined();
    expect(optionalT(undefined)).toBeUndefined();
  });

  it("interpolates params when the key exists", () => {
    const text = optionalT("home.detectUnknown", { id: 99 });
    expect(text).toContain("99");
  });
});
