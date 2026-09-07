import Backdrop from "@mui/material/Backdrop";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { programming } from "../api/ws";

export default function CvReadOverlay() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(
    (listener) => programming.subscribeReadBusy(listener),
    () => programming.isReadBusy(),
    () => false,
  );

  return (
    <Backdrop
      open={open}
      sx={{ zIndex: (theme) => theme.zIndex.modal + 2, bgcolor: "rgba(16, 31, 51, 0.72)" }}
    >
      <Paper sx={{ px: { xs: 3, sm: 5 }, py: { xs: 3, sm: 4 }, minWidth: { sm: 360 } }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography sx={{ fontSize: "1.35rem", fontWeight: 500 }}>
            {t("readOverlay.message")}
          </Typography>
          <Button variant="outlined" onClick={() => programming.cancelReads()}>
            {t("readOverlay.cancel")}
          </Button>
        </Stack>
      </Paper>
    </Backdrop>
  );
}
