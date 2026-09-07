import type { CvEntry } from "../api/types";

export const BACKUP_DEFAULT_FROM = 1;
export const BACKUP_DEFAULT_TO = 1000;
export const BACKUP_CV_MAX = 1024;

export function formatCvBackup(cvs: CvEntry[]): string {
  const lines = [...cvs]
    .sort((a, b) => a.cv - b.cv)
    .map((e) => `cv${e.cv}=${e.value}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function parseCvNumber(raw: string): number | null {
  const n = Number(raw.replace(/^(cv|CV)/i, "").trim());
  if (!Number.isInteger(n) || n < 1 || n > BACKUP_CV_MAX) return null;
  return n;
}

function parseCvValue(raw: string): number | null {
  if (/^error$/i.test(raw.trim())) return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n;
}

/** loco CLI `cvN=value` / `#` comments / optional `cvX-cvY=value` ranges. */
export function parseCvBackup(text: string): { cvs: CvEntry[]; errorLine?: string } {
  const unique = new Map<number, number>();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    if (hash !== -1) line = line.slice(0, hash).trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) return { cvs: [], errorLine: line };
    const numPart = line.slice(0, eq).trim();
    const valPart = line.slice(eq + 1).trim();
    const value = parseCvValue(valPart);
    if (value === null) {
      if (/^error$/i.test(valPart)) continue;
      return { cvs: [], errorLine: line };
    }
    const dash = numPart.indexOf("-");
    if (dash !== -1) {
      const start = parseCvNumber(numPart.slice(0, dash));
      const end = parseCvNumber(numPart.slice(dash + 1));
      if (start === null || end === null || start > end) {
        return { cvs: [], errorLine: line };
      }
      for (let cv = start; cv <= end; cv += 1) {
        unique.set(cv, value);
      }
      continue;
    }
    const cv = parseCvNumber(numPart);
    if (cv === null) return { cvs: [], errorLine: line };
    unique.set(cv, value);
  }
  const cvs = [...unique.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cv, value]) => ({ cv, value }));
  return { cvs };
}
