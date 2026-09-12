import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import type { DecoderProfile } from "../decoders/types";
import {
  decodeCv115,
  decodeCv116,
  encodeCv115,
  encodeCv116,
  encodeUncoupler,
  isUncoupler,
  KROIS_CV115_PRESETS,
  setUncoupler,
  timeSeconds,
  uncouplerDirection,
  ZIMO_COUPLER_CVS,
  ZIMO_COUPLER_OUTPUTS,
  ZIMO_TIME_SECONDS,
  type CouplerDir,
} from "../features/zimoCoupler";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

export default function ZimoCouplerPage({
  session,
}: {
  decoder: DecoderProfile;
  session: Session;
}) {
  const { t } = useTranslation();
  const registry = useCvRegistry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const known = ZIMO_COUPLER_CVS.every((cv) => registry.get(cv) !== undefined);
  const cv115 = decodeCv115(registry.get(115) ?? 0);
  const cv116 = decodeCv116(registry.get(116) ?? 0);

  const readAll = async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      const { cvs } = await programming.cvRead({
        ...session,
        cvs: [...ZIMO_COUPLER_CVS],
        signal,
      });
      registry.rememberRead(cvs);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (known) return;
    const ac = new AbortController();
    void readAll(ac.signal);
    return () => ac.abort();
    // Station / address: track is transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.stationId, session.address]);

  const patch115 = (next: Partial<typeof cv115>) => {
    registry.set(115, encodeCv115({ ...cv115, ...next }));
  };
  const patch116 = (next: Partial<typeof cv116>) => {
    registry.set(116, encodeCv116({ ...cv116, ...next }));
  };

  const timeItems = useMemo(
    () =>
      ZIMO_TIME_SECONDS.map((sec, i) => (
        <MenuItem key={i} value={i}>
          {t("coupler.zimo.seconds", { value: sec })}
        </MenuItem>
      )),
    [t],
  );

  return (
    <Stack spacing={3}>
      {error ? <ErrorAlert error={error} /> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("coupler.zimo.outputsTitle")}
        </Typography>
        {known ? (
          <Stack spacing={1}>
            {ZIMO_COUPLER_OUTPUTS.map((out) => {
              const value = registry.get(out.cv) ?? 0;
              const enabled = isUncoupler(value);
              const dir = uncouplerDirection(value);
              return (
                <Stack
                  key={out.id}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ sm: "center" }}
                >
                  <FormControlLabel
                    sx={{ minHeight: 48, minWidth: 160 }}
                    control={
                      <Checkbox
                        checked={enabled}
                        onChange={(_, on) => registry.set(out.cv, setUncoupler(value, on, dir))}
                      />
                    }
                    label={t(`coupler.zimo.out.${out.id}`)}
                  />
                  <FormControl size="small" sx={{ minWidth: 180 }} disabled={!enabled}>
                    <InputLabel>{t("coupler.zimo.direction")}</InputLabel>
                    <Select
                      value={dir}
                      label={t("coupler.zimo.direction")}
                      onChange={(e) =>
                        registry.set(out.cv, encodeUncoupler(e.target.value as CouplerDir))
                      }
                    >
                      <MenuItem value="both">{t("coupler.zimo.dirBoth")}</MenuItem>
                      <MenuItem value="fwd">{t("mapping.dirFwd")}</MenuItem>
                      <MenuItem value="rev">{t("mapping.dirRev")}</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("coupler.zimo.coilTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("coupler.zimo.coilHint")}
        </Typography>
        {known ? (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              {KROIS_CV115_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant="outlined"
                  onClick={() => registry.set(115, preset)}
                >
                  {t("coupler.zimo.kroisPreset", { sec: timeSeconds(Math.floor(preset / 10) % 10) })}
                </Button>
              ))}
            </Stack>
            <FormControl fullWidth>
              <InputLabel>{t("coupler.zimo.pullIn")}</InputLabel>
              <Select
                value={cv115.pullInIndex}
                label={t("coupler.zimo.pullIn")}
                onChange={(e) => patch115({ pullInIndex: Number(e.target.value) })}
              >
                {timeItems}
              </Select>
            </FormControl>
            <Box>
              <Typography>
                {t("coupler.zimo.hold")} — {cv115.holdPercent}%
              </Typography>
              <Slider
                min={0}
                max={90}
                step={10}
                value={cv115.holdPercent}
                onChange={(_, v) => patch115({ holdPercent: Array.isArray(v) ? v[0] : v })}
                valueLabelDisplay="auto"
                valueLabelFormat={(n) => `${n}%`}
              />
            </Box>
          </Stack>
        ) : (
          <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("coupler.zimo.waltzTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("coupler.zimo.waltzHint")}
        </Typography>
        {known ? (
          <Stack spacing={2}>
            <FormControlLabel
              sx={{ minHeight: 48 }}
              control={
                <Checkbox
                  checked={cv116.unload}
                  onChange={(_, on) => patch116({ unload: on })}
                />
              }
              label={t("coupler.zimo.unload")}
            />
            <FormControl fullWidth>
              <InputLabel>{t("coupler.zimo.disengage")}</InputLabel>
              <Select
                value={cv116.disengageIndex}
                label={t("coupler.zimo.disengage")}
                onChange={(e) => patch116({ disengageIndex: Number(e.target.value) })}
              >
                {timeItems}
              </Select>
            </FormControl>
            <Box>
              <Typography>
                {t("coupler.zimo.speed")} — {cv116.speedStep}
              </Typography>
              <Slider
                min={0}
                max={36}
                step={4}
                value={cv116.speedStep}
                onChange={(_, v) => patch116({ speedStep: Array.isArray(v) ? v[0] : v })}
                valueLabelDisplay="auto"
              />
            </Box>
          </Stack>
        ) : (
          <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
        )}
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
          {t("coupler.read")}
        </Button>
      </Stack>
    </Stack>
  );
}
