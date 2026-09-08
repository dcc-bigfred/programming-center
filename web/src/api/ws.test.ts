import { requestId, ProgrammingClient } from "./ws";
import { ensureCvScope, getCv, resetCvTable } from "../cv/table";
import { isCancelled } from "./client";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  constructor(_url: string) {
    FakeSocket.last = this;
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close");
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open");
  }

  emit(type: string, ev: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  push(type: string, id: string, payload: unknown): void {
    this.emit("message", { data: JSON.stringify({ type, id, payload }) });
  }
}

describe("requestId", () => {
  it("returns a UUID even when randomUUID is missing (LAN HTTP)", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error — simulate insecure origin
    delete crypto.randomUUID;
    try {
      const id = requestId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      crypto.randomUUID = original;
    }
  });
});

describe("ProgrammingClient progress", () => {
  let OriginalWebSocket: typeof WebSocket;
  let client: ProgrammingClient;

  beforeEach(() => {
    OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    FakeSocket.last = null;
    resetCvTable();
    ensureCvScope({ decoder: "zimo-ms450", address: 3, station: "" });
    client = new ProgrammingClient();
  });

  afterEach(() => {
    client.disconnect();
    globalThis.WebSocket = OriginalWebSocket;
  });

  async function startRead(liveApply = true): Promise<{
    socket: FakeSocket;
    id: string;
    done: Promise<{ cvs: { cv: number; value: number }[]; errors: number[] }>;
  }> {
    const done = client.cvRead({
      address: 3,
      track: "prog",
      cvs: [33, 34],
      liveApply,
    });
    const socket = FakeSocket.last;
    expect(socket).toBeTruthy();
    socket!.open();
    await Promise.resolve();
    const last = socket!.sent[socket!.sent.length - 1];
    const env = JSON.parse(last as string) as { id: string; type: string };
    expect(env.type).toBe("cv.read");
    return { socket: socket!, id: env.id, done };
  }

  it("applies progress values into the CV table while the read is in flight", async () => {
    const { socket, id, done } = await startRead(true);
    expect(client.getReadOverlay().open).toBe(true);
    socket.push("cv.progress", id, { total: 2, done: 0, current: 33 });
    socket.push("cv.progress", id, { total: 2, done: 1, cv: 33, value: 4 });
    expect(getCv(33)).toBe(4);
    expect(client.getReadProgress()?.slots[0]?.status).toBe("ok");
    socket.push("ack", id, { ok: true, cvs: [{ cv: 33, value: 4 }, { cv: 34, value: 8 }] });
    await expect(done).resolves.toMatchObject({
      cvs: [
        { cv: 33, value: 4 },
        { cv: 34, value: 8 },
      ],
    });
    expect(client.getReadOverlay().open).toBe(false);
  });

  it("does not apply progress when liveApply is false", async () => {
    const { socket, id, done } = await startRead(false);
    socket.push("cv.progress", id, { total: 2, done: 1, cv: 33, value: 4 });
    expect(getCv(33)).toBeUndefined();
    socket.push("ack", id, { ok: true, cvs: [{ cv: 33, value: 4 }] });
    await done;
  });

  it("ignores progress after cancel and sends cv.read.cancel", async () => {
    const { socket, id, done } = await startRead(true);
    client.cancelReads();
    await expect(done).rejects.toSatisfy(isCancelled);
    expect(socket.sent.some((raw) => (JSON.parse(raw) as { type: string }).type === "cv.read.cancel")).toBe(
      true,
    );
    socket.push("cv.progress", id, { total: 2, done: 1, cv: 33, value: 4 });
    expect(getCv(33)).toBeUndefined();
  });

  it("clears ignoreProgress so the next read can apply again", async () => {
    const first = await startRead(true);
    client.cancelReads();
    await first.done.catch(() => undefined);
    expect(client.getReadOverlay().open).toBe(false);

    const second = await startRead(true);
    second.socket.push("cv.progress", second.id, { total: 2, done: 1, cv: 33, value: 9 });
    expect(getCv(33)).toBe(9);
    second.socket.push("ack", second.id, { ok: true, cvs: [{ cv: 33, value: 9 }] });
    await second.done;
  });
});
