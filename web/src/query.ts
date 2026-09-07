import type { Track } from "./api/types";

export interface SessionQuery {
  station: string;
  decoder: string;
  address: string;
  track: Track;
  cv: string;
}

export function readQuery(search: URLSearchParams): SessionQuery {
  const track = search.get("track") === "pom" ? "pom" : "prog";
  return {
    station: search.get("station") ?? "",
    decoder: search.get("decoder") ?? "",
    address: search.get("address") ?? "0",
    track,
    cv: search.get("cv") ?? "",
  };
}

export function withQuery(
  search: URLSearchParams,
  patch: Partial<Record<keyof SessionQuery, string | null>>,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of ["station", "decoder", "address", "track", "cv"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value == null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  if (!next.get("track")) {
    next.set("track", "prog");
  }
  if (!next.has("address")) {
    next.set("address", "0");
  }
  return next;
}

export function addressNumber(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10239 ? n : 0;
}

export function stationNumber(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
