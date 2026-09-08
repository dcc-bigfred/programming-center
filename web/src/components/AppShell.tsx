import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import type { CommandStation } from "../api/types";
import { useCvRegistry } from "../cv/CvRegistry";
import {
  SUPPORTED_LANGUAGES,
  type Language,
} from "../i18n";
import { readQuery, withQuery } from "../query";
import { drawerBg, drawerWidth } from "../theme";
import ErrorAlert from "./ErrorAlert";
import Header from "./Header";
import Navigator from "./Navigator";

interface Props {
  title?: string;
  children: ReactNode;
}

function activeLanguage(resolved: string | undefined): Language {
  const code = (resolved ?? "pl").split("-")[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
    ? (code as Language)
    : "pl";
}

function titleFor(pathname: string, fallback: string | undefined, t: (key: string) => string): string {
  if (fallback) return fallback;
  switch (pathname) {
    case "/cv":
      return t("cv.heading");
    case "/speed":
      return t("speed.heading");
    case "/address":
      return t("address.heading");
    case "/volume":
      return t("volume.heading");
    case "/mapping":
      return t("mapping.heading");
    case "/backup":
      return t("backup.heading");
    case "/login":
      return t("login.heading");
    case "/auth/callback":
      return t("login.callback");
    default:
      return t("nav.overview");
  }
}

export default function AppShell({ title, children }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { logout, config, me } = useAuth();
  const { addressError } = useCvRegistry();
  const query = readQuery(params);
  const current = activeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const isSmUp = useMediaQuery(theme.breakpoints.up("sm"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(
    () => typeof document !== "undefined" && Boolean(document.fullscreenElement),
  );
  const [stations, setStations] = useState<CommandStation[] | null>(null);
  const [stationsError, setStationsError] = useState<unknown>(null);

  const showSession =
    Boolean(config) &&
    location.pathname !== "/login" &&
    location.pathname !== "/auth/callback";

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!config?.stationPicker || !me?.layoutId) {
      setStations(null);
      return;
    }
    let cancelled = false;
    api
      .commandStations(me.layoutId)
      .then((list) => {
        if (cancelled) return;
        const usable = list.filter((s) => s.programming);
        setStations(usable);
        setStationsError(null);
        if (!query.station && usable.length === 1) {
          setParams(withQuery(params, { station: String(usable[0].id) }), { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setStationsError(err);
      });
    return () => {
      cancelled = true;
    };
    // query.station is read to auto-pick; omitting it avoids a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.stationPicker, me?.layoutId]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser may deny without a user gesture or policy; ignore.
    }
  };

  const selectedStation = stations?.find((s) => String(s.id) === query.station);
  const status =
    config?.mode === "standalone" && config.z21
      ? t("app.statusZ21", { host: config.z21.hostname, port: config.z21.port })
      : selectedStation
        ? t("app.statusStation", { name: selectedStation.name })
        : null;

  const handleDrawerToggle = () => setMobileOpen((open) => !open);
  const closeMobile = () => setMobileOpen(false);

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        {isSmUp ? null : (
          <Navigator
            PaperProps={{ style: { width: drawerWidth } }}
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            showSession={showSession}
            onNavigate={closeMobile}
          />
        )}
        <Navigator
          PaperProps={{ style: { width: drawerWidth } }}
          sx={{ display: { sm: "block", xs: "none" } }}
          showSession={showSession}
        />
      </Box>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header
          title={titleFor(location.pathname, title, t)}
          showSession={showSession}
          fullscreen={fullscreen}
          language={current}
          stations={config?.stationPicker ? (stations ?? []) : null}
          status={status}
          onDrawerToggle={handleDrawerToggle}
          onToggleFullscreen={() => void toggleFullscreen()}
          onLogout={() => logout()}
        />
        <Box component="main" sx={{ flex: 1, py: { xs: 3, sm: 6 }, px: { xs: 2, sm: 4 }, bgcolor: "background.default" }}>
          {stationsError ? <ErrorAlert error={stationsError} /> : null}
          {addressError ? <ErrorAlert error={addressError} /> : null}
          <Paper sx={{ maxWidth: 936, margin: "auto", overflow: "hidden" }}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>{children}</Box>
          </Paper>
        </Box>
        <Box
          component="footer"
          sx={{ p: 2, bgcolor: drawerBg }}
        >
          <Typography variant="body2" align="center" sx={{ color: "rgba(255,255,255,0.55)" }}>
            {t("app.footer")}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
