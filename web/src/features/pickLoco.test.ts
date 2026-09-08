import { filterLocos, locoPrimaryLabel, selectableLocos } from "./pickLoco";
import type { CatalogueVehicle } from "../api/types";

function vehicle(partial: Partial<CatalogueVehicle> & Pick<CatalogueVehicle, "id">): CatalogueVehicle {
  return {
    name: "Lok",
    number: "",
    dccAddress: 3,
    isDummy: false,
    ownerId: 1,
    carrier: "",
    ...partial,
  };
}

describe("selectableLocos", () => {
  it("keeps the caller's vehicles that have a DCC address", () => {
    const list = [
      vehicle({ id: "a", name: "Beta", ownerId: 1, dccAddress: 44 }),
      vehicle({ id: "b", name: "Alfa", ownerId: 1, dccAddress: 12 }),
      vehicle({ id: "c", name: "Other", ownerId: 2, dccAddress: 7 }),
      vehicle({ id: "d", name: "Dummy", ownerId: 1, dccAddress: null, isDummy: true }),
      vehicle({ id: "e", name: "Zero", ownerId: 1, dccAddress: 0 }),
    ];
    expect(selectableLocos(list, 1).map((v) => v.id)).toEqual(["b", "a"]);
  });
});

describe("locoPrimaryLabel", () => {
  it("appends a distinct running number", () => {
    expect(locoPrimaryLabel(vehicle({ id: "a", name: "EP09", number: "001" }))).toBe("EP09 · 001");
    expect(locoPrimaryLabel(vehicle({ id: "b", name: "EP09", number: "EP09" }))).toBe("EP09");
  });
});

describe("filterLocos", () => {
  const list = [
    vehicle({ id: "a", name: "EP09", dccAddress: 12, carrier: "PKP Cargo" }),
    vehicle({ id: "b", name: "EU07", dccAddress: 44, carrier: "PKP Intercity" }),
  ];

  it("matches name, DCC address, or carrier", () => {
    expect(filterLocos(list, "ep09").map((v) => v.id)).toEqual(["a"]);
    expect(filterLocos(list, "44").map((v) => v.id)).toEqual(["b"]);
    expect(filterLocos(list, "cargo").map((v) => v.id)).toEqual(["a"]);
    expect(filterLocos(list, "  ").map((v) => v.id)).toEqual(["a", "b"]);
  });
});
