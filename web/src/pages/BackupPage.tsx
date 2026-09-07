import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import {
  BACKUP_CV_MAX,
  BACKUP_DEFAULT_FROM,
  BACKUP_DEFAULT_TO,
  formatCvBackup,
  parseCvBackup,
} from "../features/cvBackup";
import { addressNumber, readQuery, stationNumber } from "../query";

type RestoreSource = "file" | "paste";

function parseBound(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > BACKUP_CV_MAX) return null;
  return n;
}

export default function BackupPage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const [params] = useSearchParams();
  const query = readQuery(params);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  const [from, setFrom] = useState(String(BACKUP_DEFAULT_FROM));
  const [to, setTo] = useState(String(BACKUP_DEFAULT_TO));
  const [skipAddress, setSkipAddress] = useState(false);
  const [dumpText, setDumpText] = useState<string | null>(null);
  const [dumpSkipped, setDumpSkipped] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);

  const [restoreSource, setRestoreSource] = useState<RestoreSource>("file");
  const [paste, setPaste] = useState("");
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [restoreFailed, setRestoreFailed] = useState<number[]>([]);

  const [error, setError] = useState<unknown>(null);

  const fromN = parseBound(from);
  const toN = parseBound(to);
  const rangeOk = fromN !== null && toN !== null && fromN <= toN;

  const restoreBody = restoreSource === "file" ? fileText : paste;
  const parsed = parseCvBackup(restoreBody);

  const download = async () => {
    if (!rangeOk || fromN === null || toN === null) return;
    setError(null);
    setDumpText(null);
    setDumpSkipped([]);
    setCopied(false);
    try {
      const { cvs, errors } = await programming.cvRead({
        ...session,
        from: fromN,
        to: toN,
        skipAddress,
      });
      setDumpText(formatCvBackup(cvs));
      setDumpSkipped(errors);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    }
  };

  const saveFile = () => {
    if (!dumpText) return;
    const blob = new Blob([dumpText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cv-backup.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyDump = async () => {
    if (!dumpText) return;
    try {
      await navigator.clipboard.writeText(dumpText);
      setCopied(true);
    } catch (err) {
      setError(err);
    }
  };

  const restore = async () => {
    if (parsed.errorLine || parsed.cvs.length === 0) return;
    setError(null);
    setRestoreFailed([]);
    try {
      const { errors } = await programming.withReadOverlay(undefined, () =>
        programming.cvWrite({ ...session, cvs: parsed.cvs }),
      );
      setRestoreFailed(errors);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    }
  };

  return (
    <AppShell>
      <Stack spacing={4}>
        {error ? <ErrorAlert error={error} /> : null}

        <Stack spacing={2}>
          <Typography variant="h6">{t("backup.download")}</Typography>
          <Alert severity="warning">{t("backup.warning")}</Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label={t("backup.from")}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              inputProps={{ inputMode: "numeric" }}
            />
            <TextField
              label={t("backup.to")}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              inputProps={{ inputMode: "numeric" }}
            />
          </Stack>
          <FormControlLabel
            control={
              <Checkbox checked={skipAddress} onChange={(_, v) => setSkipAddress(v)} />
            }
            label={t("backup.skipAddress")}
          />
          <Button variant="contained" disabled={!rangeOk} onClick={() => void download()}>
            {t("backup.startDownload")}
          </Button>
          {dumpText !== null ? (
            <Stack spacing={1}>
              <Typography>
                {t("backup.doneCount", { count: dumpText.trim() ? dumpText.trim().split("\n").length : 0 })}
              </Typography>
              {dumpSkipped.length > 0 ? (
                <Typography color="text.secondary">
                  {t("backup.skipped", { cvs: dumpSkipped.join(", ") })}
                </Typography>
              ) : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="outlined" onClick={saveFile}>
                  {t("backup.saveFile")}
                </Button>
                <Button variant="outlined" onClick={() => void copyDump()}>
                  {copied ? t("backup.copied") : t("backup.copy")}
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>

        <Stack spacing={2}>
          <Typography variant="h6">{t("backup.restore")}</Typography>
          <Alert severity="warning">{t("backup.warning")}</Alert>
          <FormControl>
            <RadioGroup
              row
              value={restoreSource}
              onChange={(_, v) => setRestoreSource(v as RestoreSource)}
            >
              <FormControlLabel value="file" control={<Radio />} label={t("backup.sourceFile")} />
              <FormControlLabel value="paste" control={<Radio />} label={t("backup.sourcePaste")} />
            </RadioGroup>
          </FormControl>
          {restoreSource === "file" ? (
            <Stack spacing={1}>
              <Button variant="outlined" component="label">
                {t("backup.file")}
                <input
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setFileName(file.name);
                    void file.text().then(setFileText);
                  }}
                />
              </Button>
              {fileName ? <Typography color="text.secondary">{fileName}</Typography> : null}
            </Stack>
          ) : (
            <TextField
              multiline
              minRows={8}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="cv1=3"
            />
          )}
          {parsed.errorLine ? (
            <Alert severity="error">{t("backup.parseError", { line: parsed.errorLine })}</Alert>
          ) : null}
          <Button
            variant="contained"
            disabled={Boolean(parsed.errorLine) || parsed.cvs.length === 0}
            onClick={() => void restore()}
          >
            {t("backup.startRestore")}
          </Button>
          {restoreFailed.length > 0 ? (
            <Alert severity="warning">{t("backup.restoreErrors", { cvs: restoreFailed.join(", ") })}</Alert>
          ) : null}
        </Stack>
      </Stack>
    </AppShell>
  );
}
