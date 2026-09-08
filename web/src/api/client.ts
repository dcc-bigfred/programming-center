import type {
  ChangeList,
  CommandStation,
  CvEntry,
  LoginLayout,
  Me,
  PublicConfig,
  TokenResponse,
} from "./types";

export const TOKEN_KEY = "programming-center.token";
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

export function setToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
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

  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : undefined;
    throw new ApiError(0, "network_error", detail);
  });

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

  changeLists: (decoder: string) =>
    request<ChangeList[]>(`/api/v1/pc/changelists?decoder=${encodeURIComponent(decoder)}`),

  createChangeList: (body: { decoder: string; name: string; cvs: CvEntry[] }) =>
    request<ChangeList>("/api/v1/pc/changelists", { method: "POST", body }),

  replaceChangeList: (id: number, cvs: CvEntry[]) =>
    request<ChangeList>(`/api/v1/pc/changelists/${id}`, { method: "PATCH", body: { cvs } }),

  deleteChangeList: (id: number) =>
    request<void>(`/api/v1/pc/changelists/${id}`, { method: "DELETE" }),
};
