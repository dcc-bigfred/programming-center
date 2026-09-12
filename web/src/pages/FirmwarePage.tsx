import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepContent from "@mui/material/StepContent";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import type { FirmwareCandidate, FirmwareFile, FirmwareProgress, FirmwareStatus } from "../api/types";
import { programming } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { getDecoder } from "../decoders/registry";
import { RB23XX_WIFI_FUNCTION } from "../generated/proto-constants";
import { addressNumber, readQuery, stationNumber } from "../query";

export default function FirmwarePage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const address = addressNumber(query.address);
  const stationId = config?.stationPicker ? stationNumber(query.station) : undefined;

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<FirmwareStatus | null>(config?.wirelessProgrammer ?? null);
  const [candidates, setCandidates] = useState<FirmwareCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [files, setFiles] = useState<FirmwareFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [progress, setProgress] = useState<FirmwareProgress | null>(null);
  const [uploaded, setUploaded] = useState(false);

  const wpOk = Boolean(status?.enabled && status.connected);
  const hasAddress = address > 0;

  const session = useMemo(
    () => ({ stationId, address }),
    [stationId, address],
  );

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const next = await programming.firmwareStatus(ac.signal);
        if (!ac.signal.aborted) setStatus(next);
      } catch (err) {
        if (!isCancelled(err)) setError(err);
      }
      try {
        const listed = await programming.firmwareList(ac.signal);
        if (!ac.signal.aborted) setFiles(Array.isArray(listed) ? listed : []);
      } catch (err) {
        if (!isCancelled(err)) setError(err);
      }
    })();
    return () => ac.abort();
  }, []);

  if (!decoder || !decoder.features.includes("firmware")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  const setFn = async (on: boolean) => {
    if (!hasAddress) return;
    setBusy(true);
    setError(null);
    try {
      await programming.functionSet({
        ...session,
        function: RB23XX_WIFI_FUNCTION,
        on,
      });
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await programming.firmwareScan();
      setCandidates(found);
      if (found.length === 1) {
        setSelectedKey(found[0].key);
      }
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!selectedKey || !selectedFile) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    setUploaded(false);
    const ac = new AbortController();
    try {
      const jobId = await programming.firmwareUpdate({ key: selectedKey, file: selectedFile }, ac.signal);
      await programming.firmwareWatch(
        jobId,
        (frame) => setProgress(frame),
        ac.signal,
      );
      setProgress(null);
      setUploaded(true);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const percent = typeof progress?.progress === "number" ? progress.progress : null;

  return (
    <AppShell>
      <Stack spacing={2}>
        {error ? <ErrorAlert error={error} /> : null}
        {!wpOk ? (
          <Alert severity="warning" data-testid="firmware-unavailable">
            {t("firmware.unavailable")}
          </Alert>
        ) : null}
        {!hasAddress ? <Alert severity="warning">{t("firmware.needAddress")}</Alert> : null}

        <Stepper activeStep={step} orientation="vertical">
          <Step>
            <StepLabel>{t("firmware.stepWifiOn")}</StepLabel>
            <StepContent>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {t("firmware.stepWifiOnHint")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="contained"
                  disabled={busy || !hasAddress}
                  onClick={() => void setFn(true)}
                >
                  {t("firmware.enableWifi")}
                </Button>
                <Button disabled={busy} onClick={() => setStep(1)}>
                  {t("firmware.next")}
                </Button>
              </Stack>
            </StepContent>
          </Step>

          <Step>
            <StepLabel>{t("firmware.stepScan")}</StepLabel>
            <StepContent>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {t("firmware.stepScanHint")}
              </Typography>
              <Button variant="contained" disabled={busy || !wpOk} onClick={() => void scan()} sx={{ mb: 2 }}>
                {t("firmware.scan")}
              </Button>
              {candidates.length === 0 ? (
                <Typography color="text.secondary">{t("firmware.noCandidates")}</Typography>
              ) : (
                <List>
                  {candidates.map((c) => (
                    <ListItemButton
                      key={c.key}
                      selected={selectedKey === c.key}
                      onClick={() => setSelectedKey(c.key)}
                    >
                      <ListItemText
                        primary={`${c.label} (${c.key})`}
                        secondary={c.rssi !== undefined ? `${t("firmware.rssi")}: ${c.rssi} dBm` : undefined}
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
                <Button onClick={() => setStep(0)}>{t("firmware.back")}</Button>
                <Button variant="contained" disabled={!selectedKey} onClick={() => setStep(2)}>
                  {t("firmware.next")}
                </Button>
              </Stack>
            </StepContent>
          </Step>

          <Step>
            <StepLabel>{t("firmware.stepFile")}</StepLabel>
            <StepContent>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {t("firmware.stepFileHint")}
              </Typography>
              {files.length === 0 ? (
                <Alert severity="info">{t("firmware.noFiles")}</Alert>
              ) : (
                <List>
                  {files.map((f) => (
                    <ListItemButton
                      key={f.name}
                      selected={selectedFile === f.name}
                      onClick={() => setSelectedFile(f.name)}
                    >
                      <ListItemText
                        primary={f.name}
                        secondary={t("firmware.size", { size: f.size })}
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}
              {progress && !uploaded ? (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ mb: 1 }}>
                    {progress.state}
                    {progress.step ? ` — ${progress.step}` : ""}
                    {percent !== null ? ` (${percent}%)` : ""}
                  </Typography>
                  <LinearProgress
                    variant={percent !== null ? "determinate" : "indeterminate"}
                    value={percent ?? 0}
                  />
                </Box>
              ) : null}
              {uploaded ? <Alert severity="success" sx={{ mt: 2 }}>{t("firmware.uploadDone")}</Alert> : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
                <Button disabled={busy} onClick={() => setStep(1)}>
                  {t("firmware.back")}
                </Button>
                <Button
                  variant="contained"
                  disabled={busy || !wpOk || !selectedKey || !selectedFile}
                  onClick={() => void upload()}
                >
                  {t("firmware.upload")}
                </Button>
                <Button disabled={busy} onClick={() => setStep(3)}>
                  {t("firmware.next")}
                </Button>
              </Stack>
            </StepContent>
          </Step>

          <Step>
            <StepLabel>{t("firmware.stepWifiOff")}</StepLabel>
            <StepContent>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {t("firmware.stepWifiOffHint")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button onClick={() => setStep(2)}>{t("firmware.back")}</Button>
                <Button
                  variant="contained"
                  disabled={busy || !hasAddress}
                  onClick={() => void setFn(false)}
                >
                  {t("firmware.disableWifi")}
                </Button>
              </Stack>
            </StepContent>
          </Step>
        </Stepper>
      </Stack>
    </AppShell>
  );
}
