import type {
  CatalogueVehicle,
  ChangeList,
  CommandStation,
  CvEntry,
  LoginLayout,
  Me,
  PublicConfig,
  TokenResponse,
} from "./types";

export const TOKEN_KEY = "programming-center.token";
export const EXPIRES_KEY = "programming-center.expiresAt";
export const STATE_KEY = "programming-center.oauthState";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof ApiError && err.code === "cancelled";
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null, expiresAt?: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (expiresAt) {
      sessionStorage.setItem(EXPIRES_KEY, expiresAt);
    }
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  }
}

export function getExpiresAt(): string | null {
  return sessionStorage.getItem(EXPIRES_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.auth !== false) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 10_000);
  const onOuter = () => timeout.abort();
  opts.signal?.addEventListener("abort", onOuter, { once: true });
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: timeout.signal,
  }).catch((err: unknown) => {
    window.clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuter);
    if (opts.signal?.aborted) {
      throw new ApiError(0, "cancelled");
    }
    const detail = err instanceof Error ? err.message : undefined;
    throw new ApiError(0, "network_error", detail);
  });
  window.clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onOuter);

  const text = await res.text();
  const payload = text ? safeParse(text) : null;
  if (!res.ok) {
    const code =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : undefined) ?? `http_${res.status}`;
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : undefined;
    throw new ApiError(res.status, code, detail);
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  publicConfig: () => request<PublicConfig>("/api/v1/pc/config", { auth: false }),

  exchangeCode: (code: string, redirectUri: string, state?: string) =>
    request<TokenResponse>("/api/v1/pc/oauth/token", {
      method: "POST",
      auth: false,
      body: { code, redirectUri, state },
    }),

  me: () => request<Me>("/api/v1/auth/me"),

  layoutsForLogin: () => request<LoginLayout[]>("/api/v1/layouts/login", { auth: false }),

  commandStations: (layoutId: number) =>
    request<CommandStation[]>(`/api/v1/layouts/${layoutId}/command-stations`),

  vehicleCatalogue: () => request<CatalogueVehicle[]>("/api/v1/vehicles/catalogue"),

  changeLists: (decoder: string) =>
    request<ChangeList[]>(`/api/v1/pc/changelists?decoder=${encodeURIComponent(decoder)}`),

  createChangeList: (body: { decoder: string; name: string; cvs: CvEntry[] }) =>
    request<ChangeList>("/api/v1/pc/changelists", { method: "POST", body }),

  replaceChangeList: (id: number, cvs: CvEntry[]) =>
    request<ChangeList>(`/api/v1/pc/changelists/${id}`, { method: "PATCH", body: { cvs } }),

  deleteChangeList: (id: number) =>
    request<void>(`/api/v1/pc/changelists/${id}`, { method: "DELETE" }),
};
