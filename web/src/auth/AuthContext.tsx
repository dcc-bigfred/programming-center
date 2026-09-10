import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, getExpiresAt, getToken, setToken, STATE_KEY } from "../api/client";
import { programming } from "../api/ws";
import { resetCvTable } from "../cv/table";
import { resetIndexedCvTable } from "../cv/indexedTable";
import type { Me, PublicConfig } from "../api/types";

interface AuthValue {
  config: PublicConfig | null;
  configError: unknown;
  ready: boolean;
  token: string | null;
  me: Me | null;
  redirectUri: string;
  startSso: (layoutId: number) => void;
  adoptToken: (token: string, expiresAt?: string | null) => Promise<void>;
  logout: (reason?: "idle" | "manual") => void;
  idleReason: "idle" | null;
  clearIdleReason: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function pickRedirectUri(config: PublicConfig | null): string {
  const fallback = `${window.location.origin}/auth/callback`;
  if (!config) {
    return fallback;
  }
  return config.redirectUris.find((uri) => uri.startsWith(window.location.origin)) ?? fallback;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [idleReason, setIdleReason] = useState<"idle" | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const meRetry = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const loadConfig = () => {
      if (inFlight) return;
      inFlight = true;
      api
        .publicConfig()
        .then((cfg) => {
          if (!cancelled) {
            setConfig(cfg);
            setConfigError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setConfigError(err);
          }
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled) {
            setReady(true);
          }
        });
    };

    loadConfig();
    const interval = window.setInterval(loadConfig, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        loadConfig();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (config && !config.loginRequired) {
      if (token) {
        setToken(null);
        setTokenState(null);
      }
      programming.connect(null);
      return;
    }
    if (token) {
      programming.connect(token);
    }
  }, [config, token]);

  const logout = useCallback(
    (reason: "idle" | "manual" = "manual") => {
      resetCvTable();
      resetIndexedCvTable();
      sessionStorage.clear();
      setToken(null);
      setTokenState(null);
      setMe(null);
      setIdleReason(reason === "idle" ? "idle" : null);
      programming.disconnect();
      if (config?.loginRequired) {
        navigate("/login", { replace: true });
      } else {
        navigate({ pathname: "/", search: "track=prog&address=0" }, { replace: true });
      }
    },
    [navigate, config?.loginRequired],
  );

  useEffect(() => {
    if (!config?.loginRequired) {
      setMe(null);
      return;
    }
    if (!token) {
      setMe(null);
      return;
    }
    let cancelled = false;
    api
      .me()
      .then((value) => {
        if (!cancelled) {
          setMe(value);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          logout("manual");
          return;
        }
        if (meRetry.current !== null) window.clearTimeout(meRetry.current);
        meRetry.current = window.setTimeout(() => setMeAttempt((n) => n + 1), 5_000);
      });
    return () => {
      cancelled = true;
      if (meRetry.current !== null) {
        window.clearTimeout(meRetry.current);
        meRetry.current = null;
      }
    };
  }, [token, config, logout, meAttempt]);

  useEffect(() => {
    const seconds = config?.idleTimeoutSecs ?? 0;
    if (!token || seconds <= 0) {
      return;
    }
    let timer = window.setTimeout(() => logout("idle"), seconds * 1000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => logout("idle"), seconds * 1000);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "wheel"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    const unsubscribe = programming.subscribeReadBusy(() => {
      if (programming.isReadBusy()) reset();
    });
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
      unsubscribe();
    };
  }, [config, token, logout]);

  useEffect(() => {
    if (!token) return;
    const raw = getExpiresAt();
    if (!raw) return;
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return;
    const delay = Math.max(0, at - Date.now() - 5_000);
    const timer = window.setTimeout(() => logout("idle"), delay);
    return () => window.clearTimeout(timer);
  }, [token, logout]);

  const redirectUri = useMemo(() => pickRedirectUri(config), [config]);

  const startSso = useCallback(
    (layoutId: number) => {
      if (!config || !layoutId || !config.bigfredPublicUrl) {
        return;
      }
      const state = randomState();
      sessionStorage.setItem(STATE_KEY, state);
      const params = new URLSearchParams({
        client_id: config.ssoClientId,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        layout_id: String(layoutId),
      });
      window.location.assign(
        `${config.bigfredPublicUrl}/api/v1/auth/oauth/authorize?${params.toString()}`,
      );
    },
    [config, redirectUri],
  );

  const adoptToken = useCallback(async (accessToken: string, expiresAt?: string | null) => {
    setToken(accessToken, expiresAt);
    setTokenState(accessToken);
    setMe(await api.me());
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      config,
      configError,
      ready,
      token,
      me,
      redirectUri,
      startSso,
      adoptToken,
      logout,
      idleReason,
      clearIdleReason: () => setIdleReason(null),
    }),
    [
      config,
      configError,
      ready,
      token,
      me,
      redirectUri,
      startSso,
      adoptToken,
      logout,
      idleReason,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
