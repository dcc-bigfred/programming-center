import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface ConfirmRequest {
  title: string;
  body: string;
  danger?: boolean;
  confirmLabel?: string;
  typeToConfirm?: { expected: string; label: string };
}

export function useConfirm() {
  const { t } = useTranslation();
  const [req, setReq] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(
    null,
  );
  const [typed, setTyped] = useState("");

  const confirm = useCallback((r: ConfirmRequest) => {
    setTyped("");
    return new Promise<boolean>((resolve) => setReq({ ...r, resolve }));
  }, []);

  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
    setTyped("");
  };

  const typedOk =
    !req?.typeToConfirm || typed.trim() === req.typeToConfirm.expected;

  const dialog: ReactNode = req ? (
    <Dialog open onClose={() => close(false)} fullWidth maxWidth="xs">
      <DialogTitle>{req.title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: req.typeToConfirm ? 2 : 0 }}>{req.body}</Typography>
        {req.typeToConfirm ? (
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={req.typeToConfirm.label}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => close(false)}>{t("confirm.cancel")}</Button>
        <Button
          variant="contained"
          color={req.danger ? "error" : "primary"}
          disabled={!typedOk}
          onClick={() => close(true)}
        >
          {req.confirmLabel ?? t("confirm.ok")}
        </Button>
      </DialogActions>
    </Dialog>
  ) : null;

  return { confirm, dialog };
}
