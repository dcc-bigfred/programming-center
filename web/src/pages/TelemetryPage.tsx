import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { ApiError, isCancelled } from "../api/client";
import type { TelemetryInfo1, TelemetryUpdate } from "../api/types";
import { programming } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { addressNumber, readQuery } from "../query";

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Typography color="text.secondary" sx={{ fontSize: 13, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h4" component="p" sx={{ fontWeight: 600 }}>
        {value}
        {unit ? (
          <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
            {unit}
          </Typography>
        ) : null}
      </Typography>
    </Paper>
  );
}

function fmt(v: number | null | undefined, empty: string): string {
  return v === undefined || v === null ? empty : String(v);
}

function fmtVoltage(mv: number | null | undefined, empty: string): string {
  if (mv === undefined || mv === null) return empty;
  const volts = mv / 1000;
  return Number.isInteger(volts) ? String(volts) : volts.toFixed(1);
}

function isTelemetryRetryable(err: unknown): boolean {
  return err instanceof ApiError && ["ws_closed", "ws_error", "ws_timeout", "busy"].includes(err.code);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ApiError(0, "cancelled"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new ApiError(0, "cancelled"));
      },
      { once: true },
    );
  });
}

function InfoFlags({ info1, empty, t }: { info1?: TelemetryInfo1; empty: string; t: (k: string) => string }) {
  const flag = (on: boolean | undefined, yes: string, no: string) =>
    on === undefined ? empty : on ? yes : no;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography color="text.secondary" sx={{ fontSize: 13, mb: 1 }}>
        {t("telemetry.info1")}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          size="small"
          label={`${t("telemetry.orientation")}: ${flag(info1?.orientationPositive, t("telemetry.positive"), t("telemetry.negative"))}`}
        />
        <Chip
          size="small"
          label={`${t("telemetry.travel")}: ${flag(info1?.travelNegative, t("telemetry.travelNeg"), t("telemetry.travelPos"))}`}
        />
        <Chip
          size="small"
          label={`${t("telemetry.moving")}: ${flag(info1?.moving, t("telemetry.yes"), t("telemetry.no"))}`}
        />
        <Chip
          size="small"
          label={`${t("telemetry.consist")}: ${flag(info1?.consist, t("telemetry.yes"), t("telemetry.no"))}`}
        />
        <Chip
          size="small"
          label={`${t("telemetry.requestCh2")}: ${flag(info1?.requestChannel2, t("telemetry.yes"), t("telemetry.no"))}`}
        />
      </Stack>
    </Paper>
  );
}

export default function TelemetryPage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const address = addressNumber(query.address);
  const z21 = config?.programmingMode === "z21";
  const [snap, setSnap] = useState<TelemetryUpdate | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setSnap(null);
    setError(null);
    if (!z21 || address < 1) return;
    const ac = new AbortController();
    void (async () => {
      while (!ac.signal.aborted) {
        try {
          await programming.telemetrySubscribe({ address }, (update) => setSnap(update), ac.signal);
          return;
        } catch (err: unknown) {
          if (isCancelled(err) || ac.signal.aborted) return;
          if (isTelemetryRetryable(err)) {
            setError(null);
            try {
              await sleep(200, ac.signal);
            } catch {
              return;
            }
            continue;
          }
          setError(err);
          return;
        }
      }
    })();
    return () => ac.abort();
  }, [z21, address]);

  const empty = t("telemetry.empty");
  const grid = {
    display: "grid",
    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
    gap: 2,
  } as const;

  return (
    <AppShell>
      <Stack spacing={2}>
        <Alert severity="info">{t("telemetry.railcomHint")}</Alert>
        {error ? <ErrorAlert error={error} /> : null}
        {address < 1 ? (
          <Alert severity="warning">{t("telemetry.needAddress")}</Alert>
        ) : !z21 ? (
          <Alert severity="warning">{t("telemetry.z21Only")}</Alert>
        ) : (
          <>
            <Box sx={grid}>
              <Metric label={t("telemetry.address")} value={String(snap?.address ?? address)} />
              <Metric label={t("telemetry.speed")} value={fmt(snap?.speedKmh, empty)} unit={t("telemetry.speedUnit")} />
              <Metric label={t("telemetry.qos")} value={fmt(snap?.qosPercent, empty)} unit="%" />
            </Box>
            <Alert severity="info">{t("telemetry.dynHint")}</Alert>
            <Box sx={grid}>
              <Metric label={t("telemetry.load")} value={fmt(snap?.load, empty)} />
              <Metric label={t("telemetry.speed128")} value={fmt(snap?.speed128, empty)} />
              <Metric label={t("telemetry.location")} value={fmt(snap?.locationAddress, empty)} />
              <Metric
                label={t("telemetry.temperature")}
                value={fmt(snap?.temperatureC, empty)}
                unit={t("telemetry.tempUnit")}
              />
              <Metric
                label={t("telemetry.voltage")}
                value={fmtVoltage(snap?.trackVoltageMv, empty)}
                unit={t("telemetry.voltageUnit")}
              />
              <Metric label={t("telemetry.warning")} value={fmt(snap?.warning, empty)} />
            </Box>
            <InfoFlags info1={snap?.info1} empty={empty} t={t} />
            {snap === null ? (
              <Typography color="text.secondary">{t("telemetry.waiting")}</Typography>
            ) : null}
          </>
        )}
      </Stack>
    </AppShell>
  );
}
