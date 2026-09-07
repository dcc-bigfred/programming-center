import { api } from "../api/client";
import type { ChangeList, CvEntry } from "../api/types";
import { canonicalDecoderId } from "../decoders/registry";

const listeners = new Set<() => void>();
let epoch = 0;

export function decoderKey(id: string): string {
  return canonicalDecoderId(id);
}

export function subscribeChangeLists(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function changeListEpoch(): number {
  return epoch;
}

export function notifyChangeListsChanged(): void {
  epoch += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function listChangeLists(decoder: string): Promise<ChangeList[]> {
  return api.changeLists(decoderKey(decoder));
}

export function createChangeList(
  decoder: string,
  name: string,
  cvs: CvEntry[],
): Promise<ChangeList> {
  return api.createChangeList({ decoder: decoderKey(decoder), name, cvs });
}

export function replaceChangeList(id: number, cvs: CvEntry[]): Promise<ChangeList> {
  return api.replaceChangeList(id, cvs);
}

export function deleteChangeList(id: number): Promise<void> {
  return api.deleteChangeList(id);
}
