import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useCvRegistry } from "../cv/CvRegistry";
import { getDecoder } from "../decoders/registry";
import { createChangeList, notifyChangeListsChanged } from "../features/changelists";
import { readQuery } from "../query";
import { useConfirm } from "./ConfirmDialog";
import ErrorAlert from "./ErrorAlert";

const ghost = {
  color: "#fff",
  borderColor: "rgba(255,255,255,0.35)",
  "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.08)" },
} as const;

export default function ChangesPanel() {
  const { t } = useTranslation();
  const { diffs, apply, discard, applyBusy, applyError, applyFailed, formatDiffs } =
    useCvRegistry();
  const { confirm, dialog } = useConfirm();
  const [params] = useSearchParams();
  const decoder = getDecoder(readQuery(params).decoder);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [nameError, setNameError] = useState(false);
  const text = formatDiffs(diffs);
  const canCreate = Boolean(decoder) && diffs.length > 0;

  const submitCreate = async () => {
    if (!decoder) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createChangeList(decoder.id, trimmed, diffs);
      notifyChangeListsChanged();
      setCreateOpen(false);
      setName("");
    } catch (err) {
      setCreateError(err);
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <Box sx={{ px: 2, pb: 2, pt: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography sx={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
          {t("nav.changes")}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("changeLists.createAria")}
          disabled={!canCreate}
          onClick={() => {
            setCreateError(null);
            setNameError(false);
            setName("");
            setCreateOpen(true);
          }}
          sx={{ color: canCreate ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Stack spacing={0.75}>
        <Button
          size="small"
          variant="contained"
          disabled={applyBusy || diffs.length === 0}
          onClick={() => void apply()}
        >
          {t("changes.apply")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={diffs.length === 0}
          onClick={() => setOpen(true)}
          sx={ghost}
        >
          {t("changes.show")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={applyBusy || diffs.length === 0}
          onClick={() => {
            void (async () => {
              const ok = await confirm({
                title: t("changes.confirmDiscardTitle"),
                body: t("changes.confirmDiscardBody"),
                danger: true,
              });
              if (ok) discard();
            })();
          }}
          sx={ghost}
        >
          {t("changes.discard")}
        </Button>
      </Stack>
      {applyError ? (
        <Box sx={{ mt: 1 }}>
          <ErrorAlert error={applyError} />
        </Box>
      ) : null}
      {applyFailed.length > 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t("changes.applyPartial", { cvs: applyFailed.join(", ") })}
        </Alert>
      ) : null}
      <Box sx={{ mt: 1.5 }}>
        {diffs.length === 0 ? (
          <Typography sx={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
            {t("changes.empty")}
          </Typography>
        ) : (
          diffs.map((d) => (
            <Typography
              key={d.cv}
              sx={{
                color: "rgba(255,255,255,0.45)",
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                lineHeight: 1.4,
              }}
            >
              CV{d.cv}={d.value}
            </Typography>
          ))
        )}
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("changes.dialogTitle")}</DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              bgcolor: "grey.100",
              borderRadius: 1,
              fontSize: 14,
              overflow: "auto",
            }}
          >
            {text}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(text);
            }}
          >
            {t("changes.copy")}
          </Button>
          <Button onClick={() => setOpen(false)}>{t("changes.close")}</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={createOpen}
        onClose={() => !createBusy && setCreateOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t("changeLists.createTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t("changeLists.name")}
            value={name}
            error={nameError}
            helperText={nameError ? t("changeLists.emptyName") : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitCreate();
              }
            }}
          />
          {createError ? <ErrorAlert error={createError} /> : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={createBusy} onClick={() => setCreateOpen(false)}>
            {t("changeLists.cancel")}
          </Button>
          <Button disabled={createBusy} variant="contained" onClick={() => void submitCreate()}>
            {t("changeLists.create")}
          </Button>
        </DialogActions>
      </Dialog>
      {dialog}
    </Box>
  );
}
