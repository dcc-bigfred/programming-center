import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import { getDecoder } from "../decoders/registry";
import { LOKSOUND_V5_DECODER_ID } from "../features/esuLoksoundSpeed";
import { ZIMO_SPEED_DECODER_ID } from "../features/zimoSpeed";
import { addressNumber, readQuery, stationNumber } from "../query";
import { useAuth } from "../auth/AuthContext";
import LokSoundSpeedPage from "./LokSoundSpeedPage";
import ZimoSpeedPage from "./ZimoSpeedPage";

const SPEED_CVS = [
  { cv: 2, key: "speed.vstart" },
  { cv: 6, key: "speed.vmid" },
  { cv: 5, key: "speed.vhigh" },
  { cv: 3, key: "speed.accel" },
  { cv: 4, key: "speed.decel" },
] as const;

export default function SpeedPage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const registry = useCvRegistry();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  if (!decoder || !decoder.features.includes("speed")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  if (decoder.id === ZIMO_SPEED_DECODER_ID) {
    return (
      <AppShell>
        <ZimoSpeedPage decoder={decoder} session={session} />
      </AppShell>
    );
  }

  if (decoder.id === LOKSOUND_V5_DECODER_ID) {
    return (
      <AppShell>
        <LokSoundSpeedPage decoder={decoder} session={session} />
      </AppShell>
    );
  }

  const maxFor = (cv: number): number => {
    const item = decoder.cvs.find((c) => c.cv === cv);
    return item?.max ?? 255;
  };

  const readAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const { cvs } = await programming.cvRead({
        ...session,
        cvs: SPEED_CVS.map((s) => s.cv),
      });
      registry.rememberRead(cvs);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <Stack spacing={3}>
        {error ? <ErrorAlert error={error} /> : null}
        {SPEED_CVS.map(({ cv, key }) => {
          const max = maxFor(cv);
          const value = registry.get(cv) ?? 0;
          return (
            <Box key={cv}>
              <Typography gutterBottom>
                {t(key)} — {value}
              </Typography>
              <Slider
                min={0}
                max={max}
                value={value}
                onChange={(_, v) => {
                  const n = Array.isArray(v) ? v[0] : v;
                  registry.set(cv, n);
                }}
                valueLabelDisplay="auto"
              />
            </Box>
          );
        })}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
            {t("speed.readAll")}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}
