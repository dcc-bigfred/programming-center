import { ApiError, getToken } from "./client";
import type { Ack, CvEntry, Track } from "./types";
import { rememberRead } from "../cv/table";
import {
  applyProgressFrame,
  createProgressState,
  entryToApply,
  expandCvList,
  type ReadProgressState,
} from "../features/cvReadProgress";

const TYPE_ACK = "ack";
const TYPE_CV_READ = "cv.read";
const TYPE_CV_READ_CANCEL = "cv.read.cancel";
const TYPE_CV_PROGRESS = "cv.progress";
const TYPE_CV_WRITE = "cv.write";
const TYPE_CV_BITOP = "cv.bitop";

interface Envelope {
  type: string;
  id?: string;
  payload?: unknown;
}

type PendingKind = "read" | "write";

type Pending = {
  kind: PendingKind;
  resolve: (ack: Ack) => void;
  reject: (err: Error) => void;
};

function wsUrl(token: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${proto}//${window.location.host}/api/v1/pc/ws`;
  if (token) {
    return `${base}?token=${encodeURIComponent(token)}`;
  }
  return base;
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
  private openWaiters: Array<() => void> = [];
  private wantedToken: string | null | undefined;
  private readBusy = 0;
  private readListeners = new Set<() => void>();
  private readAborts = new Set<AbortController>();
  private progress: ReadProgressState | null = null;
  private ignoreProgress = new Set<string>();

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

  cancelReads(): void {
    for (const ac of [...this.readAborts]) {
      ac.abort();
    }
  }

  connect(token: string | null): void {
    if (this.socket && this.wantedToken === token && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.wantedToken = token;
    this.teardown(new ApiError(0, "ws_closed"));
    const socket = new WebSocket(wsUrl(token));
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      for (const wake of this.openWaiters.splice(0)) wake();
    });
    socket.addEventListener("message", (ev) => this.onMessage(String(ev.data)));
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.failAll(new ApiError(0, "ws_closed"));
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
    this.teardown(new ApiError(0, "ws_closed"));
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
  }): Promise<{ cvs: CvEntry[]; errors: number[] }> {
    const liveApply = input.liveApply !== false;
    const cvs = expandCvList(input.cvs, input.from, input.to, input.skipAddress);
    const ack = await this.runRead(input.signal, (signal) =>
      this.request(
        TYPE_CV_READ,
        {
          stationId: input.stationId,
          address: input.address,
          track: input.track,
          cvs: input.cvs,
          from: input.from,
          to: input.to,
          skipAddress: input.skipAddress,
        },
        "read",
        signal,
        { liveApply, cvs },
      ),
    );
    return { cvs: ack.cvs ?? [], errors: ack.errors ?? [] };
  }

  async cvWrite(input: {
    stationId?: number;
    address: number;
    track: Track;
    cvs: CvEntry[];
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

  private async runRead(
    outer: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<Ack>,
  ): Promise<Ack> {
    return this.withReadOverlay(outer, fn);
  }

  /** Keep the overlay up across several reads (e.g. CV 29 then the rest). */
  async withReadOverlay<T>(
    outer: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (outer?.aborted) throw cancelled();
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    this.readAborts.add(ac);
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
    }
    this.emitRead();
  }

  private emitRead(): void {
    for (const listener of this.readListeners) {
      listener();
    }
  }

  private sendCancel(id: string): void {
    this.ignoreProgress.add(id);
    if (this.progress?.requestId === id) {
      this.progress = null;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: TYPE_CV_READ_CANCEL, id }));
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
    const token = getToken();
    this.connect(token);
    await this.waitOpen(signal);
    const id = requestId();
    const env: Envelope = { type, id, payload };
    if (kind === "read" && read) {
      this.progress = createProgressState(id, read.cvs, read.liveApply);
      this.emitRead();
    }
    const ack = await new Promise<Ack>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        if (kind === "read") this.sendCancel(id);
        reject(cancelled());
      };
      if (signal?.aborted) {
        if (kind === "read") this.sendCancel(id);
        reject(cancelled());
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        kind,
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      });
      this.socket?.send(JSON.stringify(env));
    });
    if (this.progress?.requestId === id) {
      this.progress = null;
      this.emitRead();
    }
    if (!ack.ok) {
      throw new ApiError(0, ack.error ?? "generic", ack.detail);
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
      const timer = window.setTimeout(() => {
        reject(new ApiError(0, "ws_timeout"));
      }, 10_000);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(cancelled());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.openWaiters.push(() => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
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
    const entry = entryToApply(this.progress.liveApply, false, {
      total: frame.total,
      done: frame.done,
      current: frame.current,
      cv: frame.cv,
      value: frame.value,
      failed: frame.failed,
    });
    if (entry) rememberRead([entry]);
    this.emitRead();
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(err);
    }
    this.pending.clear();
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
