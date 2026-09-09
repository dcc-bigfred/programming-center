import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Modal from "@mui/material/Modal";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { programming } from "../api/ws";
import { overlayVisibleSlots } from "../features/cvReadProgress";

export default function CvReadOverlay() {
  const { t } = useTranslation();
  const { open, mode, progress } = useSyncExternalStore(
    (listener) => programming.subscribeReadBusy(listener),
    () => programming.getReadOverlay(),
    () => ({ open: false, mode: "read" as const, progress: null }),
  );
  const write = mode === "write";
  const prefix = write ? "writeOverlay" : "readOverlay";
  const streaming = Boolean(progress?.streaming);
  const readingCv = progress?.current ?? null;
  const visible = progress ? overlayVisibleSlots(progress) : [];
  const bar =
    streaming && progress && progress.total > 0
      ? Math.min(100, (100 * progress.done) / progress.total)
      : 0;

  return (
    <Modal
      open={open}
      aria-modal
      aria-labelledby="cv-overlay-title"
      onClose={(_event, reason) => {
        if (reason === "backdropClick") return;
        programming.cancelReads();
      }}
      slotProps={{
        backdrop: { sx: { bgcolor: "rgba(16, 31, 51, 0.72)" } },
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Paper sx={{ px: { xs: 3, sm: 5 }, py: { xs: 3, sm: 4 }, minWidth: { sm: 360 }, maxWidth: 480 }}>
        <Stack spacing={2} alignItems="center">
          {streaming && !write ? (
            <>
              <Typography id="cv-overlay-title" sx={{ fontSize: "1.35rem", fontWeight: 500 }}>
                {t(`${prefix}.message`)}
              </Typography>
              {readingCv !== null ? (
                <Typography color="text.secondary">
                  {t("readOverlay.current", { cv: readingCv })}
                </Typography>
              ) : null}
              {progress ? (
                <Typography aria-live="polite">
                  {t("readOverlay.progress", { done: progress.done, total: progress.total })}
                </Typography>
              ) : null}
              <Box sx={{ width: "100%" }}>
                <LinearProgress variant="determinate" value={bar} />
              </Box>
              <List dense sx={{ width: "100%", maxHeight: 220, overflow: "auto" }}>
                {visible.map((slot) => (
                  <ListItem key={slot.cv} disableGutters sx={{ py: 0 }}>
                    <ListItemText
                      primary={`CV ${slot.cv}`}
                      secondary={
                        slot.status === "ok"
                          ? t("readOverlay.done")
                          : slot.status === "failed"
                            ? t("readOverlay.failed")
                            : slot.status === "reading"
                              ? t("readOverlay.reading")
                              : t("readOverlay.pending")
                      }
                      primaryTypographyProps={{
                        fontWeight: slot.status === "reading" ? 700 : 400,
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          ) : (
            <>
              <CircularProgress />
              <Typography id="cv-overlay-title" sx={{ fontSize: "1.35rem", fontWeight: 500 }}>
                {t(`${prefix}.message`)}
              </Typography>
            </>
          )}
          <Button
            variant="outlined"
            size="large"
            sx={{ minHeight: 48, minWidth: 160 }}
            onClick={() => programming.cancelReads()}
          >
            {t(`${prefix}.cancel`)}
          </Button>
        </Stack>
      </Paper>
    </Modal>
  );
}
