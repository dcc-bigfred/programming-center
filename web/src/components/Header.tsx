import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { CommandStation, Track } from "../api/types";
import { useCvRegistry } from "../cv/CvRegistry";
import { indexedCvDiffs } from "../cv/indexedTable";
import { useConfirm } from "./ConfirmDialog";
import {
  LANGUAGE_FLAG_ICONS,
  LANGUAGE_LABELS,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from "../i18n";
import { readQuery, withQuery } from "../query";
import PickLocoButton from "./PickLocoButton";

const lightColor = "rgba(255, 255, 255, 0.7)";

const headerFieldSx = {
  bgcolor: "common.white",
  borderRadius: 1,
  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
  "& .MuiInputAdornment-root": {
    whiteSpace: "nowrap",
    mr: 1,
  },
} as const;

interface Props {
  title: string;
  showSession: boolean;
  fullscreen: boolean;
  language: Language;
  stations: CommandStation[] | null;
  status: string | null;
  onDrawerToggle: () => void;
  onToggleFullscreen: () => void;
  onLogout: () => void;
}

export default function Header({
  title,
  showSession,
  fullscreen,
  language,
  stations,
  status,
  onDrawerToggle,
  onToggleFullscreen,
  onLogout,
}: Props) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const { diffs } = useCvRegistry();
  const { confirm, dialog } = useConfirm();
  const [addrDraft, setAddrDraft] = useState(query.address);

  useEffect(() => {
    setAddrDraft(query.address);
  }, [query.address]);

  const guardUnsaved = async (): Promise<boolean> => {
    if (diffs.length === 0 && indexedCvDiffs().length === 0) return true;
    return confirm({
      title: t("changes.confirmDiscardTitle"),
      body: t("changes.confirmDiscardBody"),
      danger: true,
    });
  };

  const changeStation = async (value: string) => {
    if (value === query.station) return;
    if (!(await guardUnsaved())) return;
    setParams(withQuery(params, { station: value || null }));
  };

  const commitAddress = async () => {
    const next = addrDraft || "0";
    if (next === query.address) return;
    if (!(await guardUnsaved())) {
      setAddrDraft(query.address);
      return;
    }
    setParams(withQuery(params, { address: next }));
  };

  const requestLogout = async () => {
    const ok = await confirm({
      title: t("app.confirmLogoutTitle"),
      body: t("app.confirmLogoutBody"),
      danger: true,
    });
    if (ok) onLogout();
  };

  return (
    <>
      <AppBar color="primary" position="sticky" elevation={0}>
        <Toolbar sx={{ minHeight: 48 }}>
          <Box sx={{ display: { sm: "none", xs: "block" } }}>
            <IconButton
              color="inherit"
              aria-label={t("app.menu")}
              onClick={onDrawerToggle}
              edge="start"
            >
              <MenuIcon />
            </IconButton>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {status && (
            <Typography sx={{ color: lightColor, mr: 2 }} variant="body2" noWrap>
              {status}
            </Typography>
          )}
          {SUPPORTED_LANGUAGES.map((lang) => {
            const Flag = LANGUAGE_FLAG_ICONS[lang];
            return (
              <Tooltip key={lang} title={LANGUAGE_LABELS[lang]}>
                <IconButton
                  color="inherit"
                  aria-label={LANGUAGE_LABELS[lang]}
                  onClick={() => setLanguage(lang)}
                  sx={{
                    opacity: language === lang ? 1 : 0.55,
                    borderRadius: 1,
                    border: language === lang ? "1px solid rgba(255,255,255,0.45)" : "1px solid transparent",
                  }}
                >
                  <Flag aria-hidden sx={{ fontSize: 22, borderRadius: 0.5, overflow: "hidden" }} />
                </IconButton>
              </Tooltip>
            );
          })}
          <Tooltip title={fullscreen ? t("app.exitFullscreen") : t("app.fullscreen")}>
            <IconButton color="inherit" onClick={onToggleFullscreen}>
              {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
          <Button color="inherit" startIcon={<LogoutIcon />} onClick={() => void requestLogout()} aria-label={t("app.logoutReset")}>
            {t("app.logoutReset")}
          </Button>
        </Toolbar>
        <Toolbar sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
          <Typography color="inherit" variant="h5" component="h1">
            {title}
          </Typography>
          {showSession && (
            <Box
              sx={{
                ml: "auto",
                display: "flex",
                flexWrap: "wrap",
                gap: 1,
                alignItems: "center",
                justifyContent: "flex-end",
                py: 1,
              }}
            >
              {stations !== null && (
                <TextField
                  select
                  hiddenLabel
                  value={query.station}
                  onChange={(e) => void changeStation(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">{t("app.station")}</InputAdornment>
                    ),
                  }}
                  inputProps={{ "aria-label": t("app.station") }}
                  sx={{ ...headerFieldSx, minWidth: 260 }}
                >
                  <MenuItem value="">{t("app.noStation")}</MenuItem>
                  {stations.map((s) => (
                    <MenuItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <PickLocoButton />
              <TextField
                type="number"
                hiddenLabel
                value={addrDraft}
                onChange={(e) => setAddrDraft(e.target.value)}
                onBlur={() => void commitAddress()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">{t("app.address")}</InputAdornment>
                  ),
                }}
                inputProps={{ "aria-label": t("app.address") }}
                sx={{ ...headerFieldSx, width: 220 }}
              />
            </Box>
          )}
        </Toolbar>
      </AppBar>
      {showSession && (
        <AppBar component="div" position="static" elevation={0} sx={{ zIndex: 0 }}>
          <Tabs
            value={query.track}
            textColor="inherit"
            aria-label={t("app.track")}
            onChange={(_, value: Track) => setParams(withQuery(params, { track: value }))}
          >
            <Tab label={t("app.trackProg")} value="prog" />
            <Tab label={t("app.trackPom")} value="pom" />
          </Tabs>
        </AppBar>
      )}
      {dialog}
    </>
  );
}
