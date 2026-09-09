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
import TextField from "@mui/material/TextField";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import SubdirectoryArrowLeft from "@mui/icons-material/SubdirectoryArrowLeft";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { useConfirm } from "./ConfirmDialog";
import ErrorAlert from "./ErrorAlert";

const item = {
  py: "2px",
  px: 3,
  color: "rgba(255, 255, 255, 0.7)",
  "&:hover, &:focus": {
    bgcolor: "rgba(255, 255, 255, 0.08)",
  },
};

const filterField = {
  "& .MuiInputBase-root": { color: "#fff" },
  "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.7)" },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(255,255,255,0.23)",
  },
};

export default function ChangeListsNav({ decoderId }: { decoderId: string | undefined }) {
  const { t } = useTranslation();
  const { diffs, setMany, formatDiffs } = useCvRegistry();
  const { confirm, dialog } = useConfirm();
  const epoch = useSyncExternalStore(subscribeChangeLists, changeListEpoch, changeListEpoch);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChangeList[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [active, setActive] = useState<ChangeList | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setFilter("");
  }, [decoderId]);

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

  const visibleItems = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((list) => list.name.toLowerCase().includes(needle));
  }, [filter, items]);

  const restore = async (list: ChangeList): Promise<boolean> => {
    if (diffs.length > 0) {
      const ok = await confirm({
        title: t("changeLists.confirmOverwriteDiffsTitle"),
        body: t("changeLists.confirmOverwriteDiffsBody"),
        danger: true,
      });
      if (!ok) return false;
    }
    setMany(list.cvs);
    return true;
  };

  const replaceSaved = async () => {
    if (!active || diffs.length === 0) return;
    const ok = await confirm({
      title: t("changeLists.confirmReplaceTitle"),
      body: t("changeLists.confirmReplaceBody", { name: active.name }),
      danger: true,
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: t("changeLists.confirmDeleteTitle"),
      body: t("changeLists.confirmDeleteBody", { name: active.name }),
      danger: true,
    });
    if (!ok) return;
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
        {items.length > 0 ? (
          <Box sx={{ px: 2, pb: 1, pt: 0.5 }}>
            <TextField
              size="small"
              fullWidth
              label={t("changeLists.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={filterField}
            />
          </Box>
        ) : null}
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
          ) : visibleItems.length === 0 ? (
            <Typography sx={{ px: 3, py: 1, color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
              {t("changeLists.filterEmpty")}
            </Typography>
          ) : (
            visibleItems.map((list) => (
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
                      void restore(list);
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
                if (!active) return;
                void restore(active).then((did) => {
                  if (did) setActive(null);
                });
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
      {dialog}
    </>
  );
}
