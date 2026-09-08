import type { CatalogueVehicle } from "../api/types";

export function selectableLocos(
  list: CatalogueVehicle[],
  userId: number,
): CatalogueVehicle[] {
  return list
    .filter(
      (v) =>
        v.ownerId === userId &&
        !v.isDummy &&
        v.dccAddress != null &&
        v.dccAddress >= 1,
    )
    .slice()
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      return (a.dccAddress ?? 0) - (b.dccAddress ?? 0);
    });
}

export function locoPrimaryLabel(v: CatalogueVehicle): string {
  const number = v.number.trim();
  if (number && number !== v.name) {
    return `${v.name} · ${number}`;
  }
  return v.name;
}

export function filterLocos(list: CatalogueVehicle[], query: string): CatalogueVehicle[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((v) => {
    const haystacks = [
      v.name,
      v.number,
      v.carrier ?? "",
      v.dccAddress != null ? String(v.dccAddress) : "",
    ];
    return haystacks.some((s) => s.toLowerCase().includes(needle));
  });
}
