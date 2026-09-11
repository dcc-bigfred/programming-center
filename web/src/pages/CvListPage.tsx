import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import { ApiError, isCancelled } from "../api/client";
import { programming } from "../api/ws";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { getDecoder } from "../decoders/registry";
import type { CvItem } from "../decoders/types";
import { useCvRegistry } from "../cv/CvRegistry";
import { cvMatchesFilter } from "../features/cvListFilter";
import { parseCvBackup } from "../features/cvBackup";
import { optionalT } from "../i18n";
import { addressNumber, readQuery, stationNumber, withQuery } from "../query";
import { useAuth } from "../auth/AuthContext";

interface RowState {
  value?: number;
  draft?: string;
  bits?: Record<number, 0 | 1>;
  busy?: boolean;
  error?: unknown;
}

function knownMask(item: CvItem): number {
  return (item.bits ?? []).reduce((mask, b) => mask | (1 << b.bit), 0);
}

function bitsFromByte(item: CvItem, value: number): Record<number, 0 | 1> {
  const bits: Record<number, 0 | 1> = {};
  for (const b of item.bits ?? []) {
    bits[b.bit] = ((value >> b.bit) & 1) as 0 | 1;
  }
  return bits;
}

function editorDraft(item: CvItem, row: RowState, staged?: number): string {
  if (row.draft !== undefined) {
    const parsed = parseDraft(item, row.draft);
    if (parsed === undefined) return row.draft;
    if (staged === undefined || staged === parsed) return row.draft;
    return String(staged);
  }
  if (staged !== undefined) return String(staged);
  if (row.value !== undefined) return String(row.value);
  if (item.default !== undefined) return String(item.default);
  return "";
}

function editorBits(item: CvItem, row: RowState, staged?: number): Record<number, 0 | 1> | undefined {
  if (staged !== undefined) return bitsFromByte(item, staged);
  if (row.bits) return row.bits;
  if (item.default !== undefined) return bitsFromByte(item, item.default);
  return undefined;
}

type ListSection =
  | { kind: "cv"; item: CvItem }
  | { kind: "group"; groupKey: string; items: CvItem[] };

function sectionsFrom(cvs: CvItem[]): ListSection[] {
  const byGroup = new Map<string, CvItem[]>();
  for (const item of cvs) {
    if (!item.groupKey) continue;
    const list = byGroup.get(item.groupKey) ?? [];
    list.push(item);
    byGroup.set(item.groupKey, list);
  }
  const seen = new Set<string>();
  const sections: ListSection[] = [];
  for (const item of cvs) {
    if (!item.groupKey) {
      sections.push({ kind: "cv", item });
      continue;
    }
    if (seen.has(item.groupKey)) continue;
    seen.add(item.groupKey);
    sections.push({ kind: "group", groupKey: item.groupKey, items: byGroup.get(item.groupKey) ?? [] });
  }
  return sections;
}

function cvRangeText(cvs: number[]): string {
  if (cvs.length === 0) return "";
  const sorted = [...cvs].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

function parseDraft(item: CvItem, draft: string): number | undefined {
  if (draft.trim() === "") return undefined;
  const n = Number(draft);
  if (!Number.isInteger(n)) return undefined;
  const min = item.min ?? 0;
  const max = item.max ?? 255;
  if (n < min || n > max) return undefined;
  if (item.allowedValues && !item.allowedValues.includes(n)) return undefined;
  if (item.options && !item.options.some((opt) => opt.value === n)) return undefined;
  return n;
}

export default function CvListPage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const registry = useCvRegistry();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");

  const openCv = query.cv ? Number(query.cv) : NaN;
  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );
  const sections = useMemo(() => sectionsFrom(decoder?.cvs ?? []), [decoder]);
  const filtering = filter.trim() !== "";
  const visibleSections = useMemo(() => {
    if (!filtering) return sections;
    const out: ListSection[] = [];
    for (const section of sections) {
      if (section.kind === "cv") {
        const description = optionalT(section.item.descriptionKey, section.item.descriptionParams);
        const value = registry.get(section.item.cv) ?? rows[section.item.cv]?.value;
        if (cvMatchesFilter(section.item, filter, value, description)) {
          out.push(section);
        }
        continue;
      }
      const items = section.items.filter((item) => {
        const description = optionalT(item.descriptionKey, item.descriptionParams);
        const value = registry.get(item.cv) ?? rows[item.cv]?.value;
        return cvMatchesFilter(item, filter, value, description);
      });
      if (items.length > 0) {
        out.push({ kind: "group", groupKey: section.groupKey, items });
      }
    }
    return out;
  }, [filtering, filter, sections, registry, rows]);

  useEffect(() => {
    setOpenGroups(new Set());
    setFilter("");
    setPasteOpen(false);
    setPaste("");
  }, [decoder?.id]);

  if (!decoder) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  const pasted = parseCvBackup(paste);
  const closePaste = () => {
    setPasteOpen(false);
    setPaste("");
  };

  const toggle = (cv: number) => {
    const next = openCv === cv ? null : String(cv);
    setParams(withQuery(params, { cv: next }), { replace: true });
  };

  const patchRow = (cv: number, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [cv]: { ...prev[cv], ...patch } }));
  };

  const readOne = async (item: CvItem) => {
    patchRow(item.cv, { busy: true, error: undefined });
    try {
      const { cvs } = await programming.cvRead({ ...session, cvs: [item.cv] });
      const got = cvs.find((c) => c.cv === item.cv)?.value;
      if (got === undefined) {
        throw new ApiError(0, "cv_read_empty");
      }
      const bits: Record<number, 0 | 1> = {};
      for (const b of item.bits ?? []) {
        bits[b.bit] = ((got >> b.bit) & 1) as 0 | 1;
      }
      patchRow(item.cv, { busy: false, value: got, draft: String(got), bits });
      registry.rememberRead([{ cv: item.cv, value: got }]);
    } catch (err) {
      patchRow(item.cv, { busy: false, error: isCancelled(err) ? undefined : err });
    }
  };

  const toggleGroup = (groupKey: string, items: CvItem[]) => {
    const containsOpen = items.some((item) => item.cv === openCv);
    const expanded = openGroups.has(groupKey) || containsOpen;
    if (expanded) {
      if (containsOpen) {
        setParams(withQuery(params, { cv: null }), { replace: true });
      }
      setOpenGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupKey);
        return next;
      });
      return;
    }
    setOpenGroups((prev) => new Set(prev).add(groupKey));
  };

  const renderCv = (item: CvItem) => {
    const open = openCv === item.cv;
    const row = rows[item.cv] ?? {};
    const staged = registry.get(item.cv);
    const description = optionalT(item.descriptionKey, item.descriptionParams);
    const draft = editorDraft(item, row, staged);
    const invalid = item.kind !== "bits" && parseDraft(item, draft) === undefined;
    const shown = staged ?? row.value ?? item.default;
    return (
      <Paper
        key={item.cv}
        variant="outlined"
        sx={{ overflow: "hidden", contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}
      >
        <Box
          role="button"
          tabIndex={0}
          onClick={() => toggle(item.cv)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle(item.cv);
            }
          }}
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 2,
            px: 2,
            py: 1.5,
            cursor: "pointer",
            bgcolor: open ? "action.selected" : "transparent",
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: "1.35rem", minWidth: 88 }}>
            CV{item.cv}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: "0.95rem" }}>
            {description ?? ""}
          </Typography>
          {shown !== undefined ? (
            <Typography sx={{ ml: "auto", fontVariantNumeric: "tabular-nums" }}>
              {shown}
            </Typography>
          ) : null}
        </Box>
        <Collapse in={open} unmountOnExit>
          <Box sx={{ px: 2, pb: 2 }}>
            {optionalT(item.hintKey) && (
              <Typography color="text.secondary" sx={{ mb: 1 }}>
                {optionalT(item.hintKey)}
              </Typography>
            )}
            {item.default !== undefined && (
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {t("cv.defaultValue", { value: item.default })}
              </Typography>
            )}
            <CvEditor
              item={item}
              row={row}
              draft={draft}
              bits={editorBits(item, row, staged)}
              invalid={invalid}
              onDraft={(next) => {
                patchRow(item.cv, { draft: next });
                if (item.readOnly) return;
                const parsed = parseDraft(item, next);
                if (parsed !== undefined) {
                  registry.set(item.cv, parsed);
                }
              }}
              onBits={(bits) => {
                patchRow(item.cv, { bits });
                if (item.readOnly) return;
                const previous = staged ?? row.value ?? item.default ?? 0;
                const mask = knownMask(item);
                let assembled = previous & ~mask;
                for (const b of item.bits ?? []) {
                  if ((bits[b.bit] ?? 0) === 1) {
                    assembled |= 1 << b.bit;
                  }
                }
                registry.set(item.cv, assembled);
              }}
            />
            {row.error ? <ErrorAlert error={row.error} /> : null}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                disabled={row.busy}
                onClick={() => void readOne(item)}
              >
                {t("cv.read")}
              </Button>
            </Stack>
          </Box>
        </Collapse>
      </Paper>
    );
  };

  return (
    <AppShell>
      <Stack spacing={1}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "stretch" }}>
          <TextField
            fullWidth
            autoComplete="off"
            label={t("cv.filter")}
            placeholder={t("cv.filterHint")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            sx={{ "& .MuiInputBase-root": { minHeight: 48 } }}
          />
          <Button
            variant="outlined"
            startIcon={<PlaylistAddIcon />}
            onClick={() => {
              setPaste("");
              setPasteOpen(true);
            }}
            sx={{ minHeight: 48, flexShrink: 0, whiteSpace: "nowrap" }}
          >
            {t("cv.setFromText")}
          </Button>
        </Stack>
        <Dialog open={pasteOpen} onClose={closePaste} fullWidth maxWidth="sm">
          <DialogTitle>{t("cv.setFromTextTitle")}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={8}
              margin="dense"
              placeholder={"cv5=5\ncv3=1"}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            {pasted.errorLine ? (
              <Typography color="error" sx={{ mt: 1 }}>
                {t("cv.setFromTextParseError", { line: pasted.errorLine })}
              </Typography>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={closePaste}>{t("confirm.cancel")}</Button>
            <Button
              variant="contained"
              disabled={Boolean(pasted.errorLine) || pasted.cvs.length === 0}
              onClick={() => {
                registry.setMany(pasted.cvs);
                closePaste();
              }}
            >
              {t("cv.setFromTextApply")}
            </Button>
          </DialogActions>
        </Dialog>
        {filtering && visibleSections.length === 0 ? (
          <Typography color="text.secondary">{t("cv.filterEmpty")}</Typography>
        ) : null}
        {visibleSections.map((section) => {
          if (section.kind === "cv") {
            return renderCv(section.item);
          }
          const containsOpen = section.items.some((item) => item.cv === openCv);
          const open = filtering || openGroups.has(section.groupKey) || containsOpen;
          const title = optionalT(section.groupKey) ?? "";
          return (
            <Paper
              key={section.groupKey}
              variant="outlined"
              sx={{ overflow: "hidden", contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}
            >
              <Box
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => toggleGroup(section.groupKey, section.items)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleGroup(section.groupKey, section.items);
                  }
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  bgcolor: open ? "action.selected" : "grey.100",
                }}
              >
                <ExpandMoreIcon
                  sx={{
                    transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 0.2s",
                    color: "text.secondary",
                  }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: "1.15rem" }}>{title}</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: "0.85rem" }}>
                    {t("cv.groupMeta", {
                      count: section.items.length,
                      ranges: cvRangeText(section.items.map((item) => item.cv)),
                    })}
                  </Typography>
                </Box>
              </Box>
              <Collapse in={open} unmountOnExit>
                <Stack spacing={1} sx={{ p: 1 }}>
                  {section.items.map(renderCv)}
                </Stack>
              </Collapse>
            </Paper>
          );
        })}
      </Stack>
    </AppShell>
  );
}

function CvEditor({
  item,
  row,
  draft,
  bits,
  invalid,
  onDraft,
  onBits,
}: {
  item: CvItem;
  row: RowState;
  draft: string;
  bits: Record<number, 0 | 1> | undefined;
  invalid: boolean;
  onDraft: (draft: string) => void;
  onBits: (bits: Record<number, 0 | 1>) => void;
}) {
  const { t } = useTranslation();
  const kind = item.kind ?? "number";
  const min = item.min ?? 0;
  const max = item.max ?? 255;
  const rangeText =
    item.min !== undefined || item.max !== undefined
      ? t("cv.range", { min, max })
      : undefined;

  if (kind === "enum" && item.options) {
    return (
      <TextField
        select
        label={t("cv.value")}
        value={draft}
        error={invalid}
        helperText={item.readOnly ? t("cv.readOnly") : invalid ? t("cv.invalidValue") : rangeText}
        disabled={item.readOnly}
        onChange={(e) => onDraft(e.target.value)}
      >
        {item.options.map((opt) => (
          <MenuItem key={opt.value} value={String(opt.value)}>
            {optionalT(opt.labelKey) ?? String(opt.value)}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (kind === "bits" && item.bits) {
    return (
      <Stack spacing={2}>
        {item.bits.map((bit) => {
          const current = bits?.[bit.bit];
          return (
            <FormControl key={bit.bit} disabled={item.readOnly}>
              <FormLabel>bit {bit.bit}</FormLabel>
              <RadioGroup
                value={current === undefined ? "" : String(current)}
                onChange={(e) =>
                  onBits({ ...bits, [bit.bit]: Number(e.target.value) as 0 | 1 })
                }
              >
                <FormControlLabel
                  value="0"
                  control={<Radio />}
                  label={t("cv.bitOff", { label: optionalT(bit.offKey) ?? "0" })}
                />
                <FormControlLabel
                  value="1"
                  control={<Radio />}
                  label={t("cv.bitOn", { label: optionalT(bit.onKey) ?? "1" })}
                />
              </RadioGroup>
            </FormControl>
          );
        })}
      </Stack>
    );
  }
  return (
    <TextField
      type="number"
      label={t("cv.value")}
      inputProps={{ min, max }}
      value={draft}
      error={invalid && draft !== ""}
      helperText={
        item.readOnly
          ? t("cv.readOnly")
          : invalid
            ? t("cv.invalidValue") + (rangeText ? ` ${rangeText}` : "")
            : rangeText
      }
      disabled={item.readOnly}
      placeholder={row.value === undefined && item.default === undefined ? t("cv.unread") : undefined}
      onChange={(e) => onDraft(e.target.value)}
    />
  );
}
