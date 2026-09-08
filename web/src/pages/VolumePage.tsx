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
import { decodeVolume, encodeVolume, volumeMapFor } from "../features/volumeMap";
import { addressNumber, readQuery, stationNumber } from "../query";
import { useAuth } from "../auth/AuthContext";

export default function VolumePage() {
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

  if (!decoder || !decoder.features.includes("volume")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  const map = volumeMapFor(decoder.id);
  const staged = map ? registry.get(map.cv) : undefined;
  const percent =
    map && staged !== undefined ? decodeVolume(staged, map.max) : 50;

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!map) return;
      const { cvs } = await programming.cvRead({ ...session, cvs: [map.cv] });
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
        <Box>
          <Typography gutterBottom>{t("volume.percent", { value: percent })}</Typography>
          <Slider
            min={0}
            max={100}
            value={percent}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              if (!map) return;
              registry.set(map.cv, encodeVolume(n, map.max));
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button variant="outlined" disabled={busy} onClick={() => void read()}>
            {t("volume.read")}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}
