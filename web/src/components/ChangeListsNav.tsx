import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import SubdirectoryArrowLeft from "@mui/icons-material/SubdirectoryArrowLeft";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { ChangeList } from "../api/types";
import { useCvRegistry } from "../cv/CvRegistry";
import {
  changeListEpoch,
  deleteChangeList,
  listChangeLists,
  notifyChangeListsChanged,
  replaceChangeList,
  subscribeChangeLists,
} from "../features/changelists";
import ErrorAlert from "./ErrorAlert";

const item = {
  py: "2px",
  px: 3,
  color: "rgba(255, 255, 255, 0.7)",
  "&:hover, &:focus": {
    bgcolor: "rgba(255, 255, 255, 0.08)",
  },
};

export default function ChangeListsNav({ decoderId }: { decoderId: string | undefined }) {
  const { t } = useTranslation();
  const { diffs, setMany, formatDiffs } = useCvRegistry();
  const epoch = useSyncExternalStore(subscribeChangeLists, changeListEpoch, changeListEpoch);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChangeList[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [active, setActive] = useState<ChangeList | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  useEffect(() => {
    if (!decoderId) {
      setItems([]);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void listChangeLists(decoderId)
      .then((got) => {
        if (!cancelled) setItems(got);
      })
      .catch((err) => {
        if (!cancelled) {
          setItems([]);
          setLoadError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [decoderId, epoch]);

  const restore = (list: ChangeList) => {
    setMany(list.cvs);
  };

  const replaceSaved = async () => {
    if (!active || diffs.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await replaceChangeList(active.id, diffs);
      setActive(updated);
      notifyChangeListsChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!active) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteChangeList(active.id);
      setActive(null);
      notifyChangeListsChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(decoderId);

  return (
    <>
      <ListItem disablePadding>
        <ListItemButton
          disabled={!enabled}
          onClick={() => enabled && setOpen((v) => !v)}
          sx={item}
        >
          <ListItemText>{t("nav.changeLists")}</ListItemText>
          {open ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
      </ListItem>
      <Collapse in={open && enabled} timeout="auto" unmountOnExit>
        <List disablePadding>
          {loadError ? (
            <Box sx={{ px: 3, py: 1 }}>
              <ErrorAlert error={loadError} />
            </Box>
          ) : null}
          {items.length === 0 && !loadError ? (
            <Typography sx={{ px: 3, py: 1, color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
              {t("changeLists.empty")}
            </Typography>
          ) : (
            items.map((list) => (
              <ListItem
                key={list.id}
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label={t("changeLists.restoreAria")}
                    onClick={(e) => {
                      e.stopPropagation();
                      restore(list);
                    }}
                    sx={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    <SubdirectoryArrowLeft fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemButton
                  sx={{ ...item, pr: 6 }}
                  onClick={() => {
                    setActionError(null);
                    setActive(list);
                  }}
                >
                  <ListItemText
                    primary={list.name}
                    primaryTypographyProps={{ fontSize: 14, noWrap: true }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </Collapse>
      <Dialog
        open={Boolean(active)}
        onClose={() => !busy && setActive(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{active?.name}</DialogTitle>
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
            {active ? formatDiffs(active.cvs) : ""}
          </Box>
          {actionError ? <ErrorAlert error={actionError} /> : null}
        </DialogContent>
        <DialogActions>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ width: "100%", justifyContent: "flex-end" }}
          >
            <Button
              disabled={busy || !active}
              onClick={() => {
                if (active) restore(active);
                setActive(null);
              }}
            >
              {t("changeLists.loadIntoCurrent")}
            </Button>
            <Button disabled={busy || diffs.length === 0} onClick={() => void replaceSaved()}>
              {t("changeLists.replaceWithCurrent")}
            </Button>
            <Button color="error" disabled={busy} onClick={() => void remove()}>
              {t("changeLists.delete")}
            </Button>
            <Button disabled={busy} onClick={() => setActive(null)}>
              {t("changes.close")}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </>
  );
}
