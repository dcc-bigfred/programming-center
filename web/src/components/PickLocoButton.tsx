import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import type { CatalogueVehicle } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { filterLocos, locoPrimaryLabel, selectableLocos } from "../features/pickLoco";
import { withQuery } from "../query";
import ErrorAlert from "./ErrorAlert";

const buttonSx = {
  bgcolor: "common.white",
  color: "text.primary",
  boxShadow: "none",
  textTransform: "none",
  fontWeight: 600,
  "&:hover": { bgcolor: "grey.100", boxShadow: "none" },
  "&.Mui-disabled": { bgcolor: "rgba(255,255,255,0.45)", color: "rgba(0,0,0,0.38)" },
} as const;

export default function PickLocoButton() {
  const { t } = useTranslation();
  const { config, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const bigfred = config?.mode === "bigfred";
  const enabled = Boolean(bigfred && me);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CatalogueVehicle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => filterLocos(items, filter), [filter, items]);

  useEffect(() => {
    if (!open || !me) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void api
      .vehicleCatalogue()
      .then((list) => {
        if (!cancelled) setItems(selectableLocos(list, me.id));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, me]);

  const pick = (v: CatalogueVehicle) => {
    if (v.dccAddress == null) return;
    setParams(withQuery(params, { address: String(v.dccAddress) }));
    setOpen(false);
  };

  const button = (
    <Button
      variant="contained"
      disabled={!enabled}
      onClick={() => enabled && setOpen(true)}
      sx={buttonSx}
    >
      {t("app.pickLoco")}
    </Button>
  );

  return (
    <>
      {bigfred ? (
        button
      ) : (
        <Tooltip title={t("app.pickLocoBigFredOnly")}>
          <span aria-label={t("app.pickLocoBigFredOnly")}>{button}</span>
        </Tooltip>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("app.pickLoco")}</DialogTitle>
        <DialogContent>
          {items.length > 0 ? (
            <TextField
              autoFocus
              size="small"
              fullWidth
              label={t("app.pickLocoFilter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ mt: 1, mb: 1 }}
            />
          ) : null}
          {busy ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : null}
          {error ? <ErrorAlert error={error} /> : null}
          {!busy && !error && items.length === 0 ? (
            <Typography color="text.secondary">{t("app.pickLocoEmpty")}</Typography>
          ) : null}
          {!busy && items.length > 0 && visible.length === 0 ? (
            <Typography color="text.secondary">{t("app.pickLocoFilterEmpty")}</Typography>
          ) : null}
          {!busy && visible.length > 0 ? (
            <List disablePadding>
              {visible.map((v) => (
                <ListItemButton key={v.id} onClick={() => pick(v)}>
                  <ListItemText
                    primary={locoPrimaryLabel(v)}
                    secondary={
                      v.carrier?.trim()
                        ? t("app.pickLocoAddressCarrier", {
                            address: v.dccAddress,
                            carrier: v.carrier.trim(),
                          })
                        : t("app.pickLocoAddress", { address: v.dccAddress })
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t("changes.close")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
