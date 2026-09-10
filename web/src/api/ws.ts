import { ApiError } from "./client";
import type { Ack, CvEntry, Track } from "./types";
import { flushCvTable, rememberRead } from "../cv/table";
import {
  applyProgressFrame,
  createProgressState,
  entryToApply,
  expandCvList,
  type ReadProgressState,
} from "../features/cvReadProgress";

const TYPE_ACK = "ack";
const TYPE_AUTH = "auth";
const TYPE_CV_READ = "cv.read";
const TYPE_CV_READ_CANCEL = "cv.read.cancel";
const TYPE_CV_WRITE_CANCEL = "cv.write.cancel";
const TYPE_CV_PROGRESS = "cv.progress";
const TYPE_CV_WRITE = "cv.write";
const TYPE_CV_BITOP = "cv.bitop";
const TYPE_ADDRESS_SET = "address.set";

const REQUEST_IDLE_MS = 30_000;

interface Envelope {
  type: string;
  id?: string;
  payload?: unknown;
}

type PendingKind = "read" | "write";

type OverlayMode = "read" | "write";

export type ReadOverlaySnap = {
  open: boolean;
  mode: OverlayMode;
  progress: ReadProgressState | null;
};

type Pending = {
  kind: PendingKind;
  resolve: (ack: Ack) => void;
  reject: (err: Error) => void;
  touch: () => void;
  idleTimer: number | null;
};

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/pc/ws`;
}

function cancelled(): ApiError {
  return new ApiError(0, "cancelled");
}

/** `crypto.randomUUID` is secure-context only (HTTPS / localhost), not LAN IPs. */
export function requestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class ProgrammingClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private openWaiters: Array<(err?: Error) => void> = [];
  private wantedToken: string | null | undefined;
  private readBusy = 0;
  private overlayMode: OverlayMode = "read";
  private readListeners = new Set<() => void>();
  private readAborts = new Set<AbortController>();
  private progress: ReadProgressState | null = null;
  private ignoreProgress = new Set<string>();
  private overlaySnap: ReadOverlaySnap = { open: false, mode: "read", progress: null };
  private reconnectAt = 0;
  private reconnectTimer: number | null = null;
  private readQueue: Promise<unknown> = Promise.resolve();
  private applyBuffer: Array<{ cv: number; value: number }> = [];
  private flushFrame: number | null = null;

  subscribeReadBusy(listener: () => void): () => void {
    this.readListeners.add(listener);
    return () => {
      this.readListeners.delete(listener);
    };
  }

  isReadBusy(): boolean {
    return this.readBusy > 0;
  }

  getReadProgress(): ReadProgressState | null {
    return this.progress;
  }

  /** Cached snapshot so `useSyncExternalStore` does not loop. */
  getReadOverlay(): ReadOverlaySnap {
    return this.overlaySnap;
  }

  cancelReads(): void {
    for (const ac of [...this.readAborts]) {
      ac.abort();
    }
  }

  connect(token: string | null): void {
    if (this.socket && this.wantedToken === token && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    this.wantedToken = token;
    this.clearReconnect();
    this.teardown(new ApiError(0, "ws_closed"));
    const socket = new WebSocket(wsUrl());
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAt = 0;
      try {
        socket.send(JSON.stringify({ type: TYPE_AUTH, payload: { token } }));
      } catch {
        this.failAll(new ApiError(0, "ws_send_failed"));
        return;
      }
      for (const wake of this.openWaiters.splice(0)) wake();
    });
    socket.addEventListener("message", (ev) => this.onMessage(String(ev.data)));
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.failAll(new ApiError(0, "ws_closed"));
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) {
        this.failAll(new ApiError(0, "ws_error"));
      }
    });
  }

  disconnect(): void {
    this.wantedToken = undefined;
    this.clearReconnect();
    this.teardown(new ApiError(0, "ws_closed"));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.wantedToken === undefined || this.reconnectTimer !== null) return;
    const delay = Math.min(8_000, 500 * 2 ** this.reconnectAt);
    this.reconnectAt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantedToken === undefined) return;
      this.connect(this.wantedToken);
    }, delay);
  }

  private enqueueRead<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.readQueue.then(fn, fn);
    this.readQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async cvRead(input: {
    stationId?: number;
    address: number;
    track: Track;
    cvs?: number[];
    from?: number;
    to?: number;
    skipAddress?: boolean;
    signal?: AbortSignal;
    liveApply?: boolean;
    /** Recalculate the CV list after waiting in the read queue. */
    stillMissing?: () => number[];
  }): Promise<{ cvs: CvEntry[]; errors: number[] }> {
    const liveApply = input.liveApply !== false;
    const ack = await this.enqueueRead(async () => {
      const cvs = input.stillMissing
        ? input.stillMissing()
        : expandCvList(input.cvs, input.from, input.to, input.skipAddress);
      if (cvs.length === 0) {
        return { ok: true, cvs: [], errors: [] };
      }
      return this.runRead(input.signal, (signal) =>
        this.request(
          TYPE_CV_READ,
          {
            stationId: input.stationId,
            address: input.address,
            track: input.track,
            cvs: input.stillMissing ? cvs : input.cvs,
            from: input.stillMissing ? undefined : input.from,
            to: input.stillMissing ? undefined : input.to,
            skipAddress: input.stillMissing ? undefined : input.skipAddress,
          },
          "read",
          signal,
          { liveApply, cvs },
        ),
      );
    });
    return { cvs: ack.cvs ?? [], errors: ack.errors ?? [] };
  }

  async cvWrite(input: {
    stationId?: number;
    address: number;
    track: Track;
    cvs: CvEntry[];
    signal?: AbortSignal;
  }): Promise<{ cvs: CvEntry[]; errors: number[] }> {
    const ack = await this.request(
      TYPE_CV_WRITE,
      {
        stationId: input.stationId,
        address: input.address,
        track: input.track,
        cvs: input.cvs,
      },
      "write",
      input.signal,
    );
    return { cvs: ack.cvs ?? input.cvs, errors: ack.errors ?? [] };
  }

  async cvBitop(input: {
    stationId?: number;
    address: number;
    track: Track;
    cv: number;
    andMask: number;
    orMask: number;
  }): Promise<CvEntry[]> {
    const ack = await this.request(TYPE_CV_BITOP, input, "write");
    return ack.cvs ?? [];
  }

  /** ESU service-mode address write. Always programming track; cancel via cv.write.cancel. */
  async addressSet(input: {
    stationId?: number;
    address: number;
    newAddress: number;
    longBit?: number;
    railcomPlus?: boolean;
    signal?: AbortSignal;
  }): Promise<{ cvs: CvEntry[]; errors: number[] }> {
    const ack = await this.request(
      TYPE_ADDRESS_SET,
      {
        stationId: input.stationId,
        address: input.address,
        newAddress: input.newAddress,
        longBit: input.longBit,
        railcomPlus: input.railcomPlus,
      },
      "write",
      input.signal,
    );
    return { cvs: ack.cvs ?? [], errors: ack.errors ?? [] };
  }

  private async runRead(
    outer: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<Ack>,
  ): Promise<Ack> {
    return this.withOverlay({ mode: "read" }, fn, outer);
  }

  /** Keep the overlay up across several reads (e.g. CV 29 then the rest). */
  async withReadOverlay<T>(
    outer: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.withOverlay({ mode: "read" }, fn, outer);
  }

  async withOverlay<T>(
    opts: { mode: OverlayMode },
    fn: (signal: AbortSignal) => Promise<T>,
    outer?: AbortSignal,
  ): Promise<T> {
    if (outer?.aborted) throw cancelled();
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    this.readAborts.add(ac);
    this.overlayMode = opts.mode;
    this.beginRead();
    try {
      return await fn(ac.signal);
    } finally {
      outer?.removeEventListener("abort", onOuter);
      this.readAborts.delete(ac);
      this.endRead();
    }
  }

  private beginRead(): void {
    this.readBusy += 1;
    this.emitRead();
  }

  private endRead(): void {
    this.readBusy = Math.max(0, this.readBusy - 1);
    if (this.readBusy === 0) {
      this.progress = null;
      this.ignoreProgress.clear();
      this.flushApplyBuffer();
      flushCvTable();
    }
    this.emitRead();
  }

  private emitRead(): void {
    this.overlaySnap = {
      open: this.readBusy > 0,
      mode: this.overlayMode,
      progress: this.progress,
    };
    for (const listener of this.readListeners) {
      listener();
    }
  }

  private sendCancel(id: string, kind: PendingKind): void {
    this.ignoreProgress.add(id);
    if (this.progress?.requestId === id) {
      this.progress = null;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      const type = kind === "write" ? TYPE_CV_WRITE_CANCEL : TYPE_CV_READ_CANCEL;
      try {
        this.socket.send(JSON.stringify({ type, id }));
      } catch {
        /* closed between check and send */
      }
    }
    this.emitRead();
  }

  private async request(
    type: string,
    payload: unknown,
    kind: PendingKind,
    signal?: AbortSignal,
    read?: { liveApply: boolean; cvs: number[] },
  ): Promise<Ack> {
    if (signal?.aborted) throw cancelled();
    this.connect(this.wantedToken ?? null);
    await this.waitOpen(signal);
    const id = requestId();
    const env: Envelope = { type, id, payload };
    if (kind === "read" && read) {
      this.progress = createProgressState(id, read.cvs, read.liveApply);
      this.emitRead();
    }
    const ack = await new Promise<Ack>((resolve, reject) => {
      const pending: Pending = {
        kind,
        idleTimer: null,
        touch: () => {
          if (pending.idleTimer !== null) window.clearTimeout(pending.idleTimer);
          pending.idleTimer = window.setTimeout(() => {
            this.pending.delete(id);
            this.sendCancel(id, kind);
            reject(new ApiError(0, "ws_timeout"));
          }, REQUEST_IDLE_MS);
        },
        resolve: (value) => {
          if (pending.idleTimer !== null) window.clearTimeout(pending.idleTimer);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (err) => {
          if (pending.idleTimer !== null) window.clearTimeout(pending.idleTimer);
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      };
      const onAbort = () => {
        this.pending.delete(id);
        if (pending.idleTimer !== null) window.clearTimeout(pending.idleTimer);
        this.sendCancel(id, kind);
        reject(cancelled());
      };
      if (signal?.aborted) {
        this.sendCancel(id, kind);
        reject(cancelled());
        return;
      }
      this.pending.set(id, pending);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new ApiError(0, "ws_closed"));
        return;
      }
      try {
        socket.send(JSON.stringify(env));
      } catch (err) {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new ApiError(0, "ws_send_failed", String(err)));
        return;
      }
      pending.touch();
    });
    if (this.progress?.requestId === id) {
      this.progress = null;
      this.emitRead();
    }
    this.flushApplyBuffer();
    flushCvTable();
    if (!ack.ok) {
      throw new ApiError(0, ack.error ?? "generic", ack.detail, ack.cvs);
    }
    return ack;
  }

  private waitOpen(signal?: AbortSignal): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(cancelled());
        return;
      }
      const waiter = (err?: Error) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve();
      };
      const timer = window.setTimeout(() => {
        this.openWaiters = this.openWaiters.filter((w) => w !== waiter);
        this.socket?.close();
        reject(new ApiError(0, "ws_timeout"));
      }, 10_000);
      const onAbort = () => {
        this.openWaiters = this.openWaiters.filter((w) => w !== waiter);
        window.clearTimeout(timer);
        reject(cancelled());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.openWaiters.push(waiter);
    });
  }

  private onMessage(text: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      return;
    }
    if (env.type === TYPE_CV_PROGRESS && env.id) {
      this.onProgress(env.id, env.payload);
      return;
    }
    if (env.type !== TYPE_ACK || !env.id) {
      return;
    }
    const waiter = this.pending.get(env.id);
    if (!waiter) {
      return;
    }
    this.pending.delete(env.id);
    waiter.resolve((env.payload as Ack) ?? { ok: false, error: "generic" });
  }

  private onProgress(id: string, payload: unknown): void {
    if (this.ignoreProgress.has(id) || this.progress?.requestId !== id) {
      return;
    }
    this.pending.get(id)?.touch();
    const frame = payload as {
      total?: number;
      done?: number;
      current?: number;
      cv?: number;
      value?: number;
      failed?: boolean;
    };
    if (typeof frame.total !== "number" || typeof frame.done !== "number") {
      return;
    }
    this.progress = applyProgressFrame(this.progress, {
      total: frame.total,
      done: frame.done,
      current: frame.current,
      cv: frame.cv,
      value: frame.value,
      failed: frame.failed,
    });
    const entry = entryToApply(this.progress.liveApply, {
      total: frame.total,
      done: frame.done,
      current: frame.current,
      cv: frame.cv,
      value: frame.value,
      failed: frame.failed,
    });
    if (entry) this.applyBuffer.push(entry);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushFrame !== null) return;
    this.flushFrame = window.requestAnimationFrame(() => {
      this.flushFrame = null;
      this.flushApplyBuffer();
      this.emitRead();
    });
  }

  private flushApplyBuffer(): void {
    if (this.applyBuffer.length === 0) return;
    const batch = this.applyBuffer;
    this.applyBuffer = [];
    rememberRead(batch);
  }

  private failAll(err: Error): void {
    for (const waiter of this.openWaiters.splice(0)) waiter(err);
    for (const [id, waiter] of this.pending) {
      this.ignoreProgress.add(id);
      waiter.reject(err);
    }
    this.pending.clear();
    this.flushApplyBuffer();
    flushCvTable();
  }

  private teardown(err: Error): void {
    this.failAll(err);
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  }
}

export const programming = new ProgrammingClient();
