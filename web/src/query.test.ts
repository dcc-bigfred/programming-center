import { addressNumber, readQuery, stationNumber, withQuery } from "./query";

describe("session query", () => {
  it("defaults track to prog and address to 0", () => {
    expect(readQuery(new URLSearchParams())).toEqual({
      station: "",
      decoder: "",
      address: "0",
      track: "prog",
      cv: "",
    });
    expect(readQuery(new URLSearchParams("track=pom&decoder=nmra")).track).toBe("pom");
    expect(readQuery(new URLSearchParams("track=nope")).track).toBe("prog");
  });

  it("patches without dropping unspecified keys and restores required defaults", () => {
    const start = new URLSearchParams("decoder=zimo-ms450&address=12&track=pom&cv=29");
    const next = withQuery(start, { cv: null, decoder: "nmra" });
    expect(next.get("decoder")).toBe("nmra");
    expect(next.get("address")).toBe("12");
    expect(next.get("track")).toBe("pom");
    expect(next.get("cv")).toBeNull();
    const clearedTrack = withQuery(start, { track: null });
    expect(clearedTrack.get("track")).toBe("prog");
    const clearedAddr = withQuery(start, { address: null });
    expect(clearedAddr.get("address")).toBe("0");
  });

  it("parses address and station numbers", () => {
    expect(addressNumber("3")).toBe(3);
    expect(addressNumber("0")).toBe(0);
    expect(addressNumber("10239")).toBe(10239);
    expect(addressNumber("10240")).toBe(0);
    expect(addressNumber("x")).toBe(0);
    expect(stationNumber("8")).toBe(8);
    expect(stationNumber("0")).toBeUndefined();
    expect(stationNumber("")).toBeUndefined();
  });
});
