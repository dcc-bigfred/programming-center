import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import { ESU_SIDE_ID, ESU_SIDE_TABLE, indexedKey } from "../features/esuMapping";
import { readQuery, withQuery } from "../query";
import { CvRegistryProvider, useCvRegistry } from "./CvRegistry";
import { getIndexedCv, indexedCvDiffs, rememberIndexedRead, setIndexedCv } from "./indexedTable";
import { getCv, ensureCvScope, rememberRead, setCv } from "./table";

const { mockAuth, cvRead, cvWrite } = vi.hoisted(() => {
  const config: PublicConfig = {
    enabled: true,
    mode: "standalone",
    programmingMode: "z21",
    ssoClientId: "programming-center",
    redirectUris: [],
    idleTimeoutSecs: 86400,
    stationPicker: false,
    loginRequired: false,
  };
  return {
    mockAuth: {
      config,
      token: null as string | null,
      ready: true,
    },
    cvRead: vi.fn(),
    cvWrite: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/ws", () => ({
  programming: {
    cvRead,
    cvWrite,
    withOverlay: (_opts: unknown, fn: (signal: AbortSignal) => Promise<unknown>) =>
      fn(new AbortController().signal),
  },
}));

function RegistryView({ withSide = false }: { withSide?: boolean }) {
  const r = useCvRegistry();
  const [params, setParams] = useSearchParams();
  useLayoutEffect(() => {
    if (!withSide) return;
    r.registerSideTable(ESU_SIDE_TABLE);
    return () => r.unregisterSideTable(ESU_SIDE_ID);
  }, [withSide, r.registerSideTable, r.unregisterSideTable]);
  return (
    <div>
      <span data-testid="cv8">{r.get(8) ?? "missing"}</span>
      <span data-testid="diffs">{r.formatDiffs(r.diffs)}</span>
      <span data-testid="sections">{r.formatSections(r.sections)}</span>
      <span data-testid="has-pending">{r.hasPending ? "yes" : "no"}</span>
      <span data-testid="side-pending">{r.sideHasPending(ESU_SIDE_ID) ? "yes" : "no"}</span>
      <span data-testid="addr-err">{r.addressError ? "yes" : "no"}</span>
      <span data-testid="q-addr">{readQuery(params).address}</span>
      <span data-testid="apply-busy">{r.applyBusy ? "yes" : "no"}</span>
      <span data-testid="apply-failed">{r.applyFailed.join(",")}</span>
      <button type="button" onClick={() => void r.ensureRead([8, 2])}>
        ensure
      </button>
      <button type="button" onClick={() => r.set(2, 40)}>
        stage
      </button>
      <button type="button" onClick={() => void r.apply()}>
        apply
      </button>
      <button type="button" onClick={() => r.registerSideTable(ESU_SIDE_TABLE)}>
        register-side
      </button>
      <button type="button" onClick={() => r.registerSideTable(ESU_SIDE_TABLE)}>
        register-side-again
      </button>
      <button type="button" onClick={() => r.unregisterSideTable(ESU_SIDE_ID)}>
        unregister-side
      </button>
      <button type="button" onClick={() => r.discard()}>
        discard
      </button>
      <button type="button" onClick={() => r.discardSide(ESU_SIDE_ID)}>
        discard-side
      </button>
      <button
        type="button"
        onClick={() => setParams(withQuery(params, { address: "9" }))}
      >
        addr9
      </button>
    </div>
  );
}

function renderRegistry(search: string, withSide = false) {
  return render(
    <MemoryRouter
      initialEntries={[`/${search}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CvRegistryProvider>
        <RegistryView withSide={withSide} />
      </CvRegistryProvider>
    </MemoryRouter>,
  );
}

const addressCvs = [
  { cv: 1, value: 12 },
  { cv: 17, value: 192 },
  { cv: 18, value: 0 },
  { cv: 29, value: 0 },
];

describe("CvRegistryProvider", () => {
  beforeEach(() => {
    mockAuth.config.enabled = true;
    mockAuth.config.loginRequired = false;
    mockAuth.config.stationPicker = false;
    mockAuth.token = null;
    mockAuth.ready = true;
    cvRead.mockReset();
    cvWrite.mockReset();
    cvRead.mockResolvedValue({ cvs: addressCvs, errors: [] });
    cvWrite.mockResolvedValue({ cvs: [], errors: [] });
  });

  it("reads the programming-track address when the session address is 0", async () => {
    renderRegistry("?decoder=nmra&address=0&track=pom");
    await waitFor(() => {
      expect(cvRead).toHaveBeenCalled();
    });
    const payload = cvRead.mock.calls[0]?.[0] as { cvs: number[]; track: string; address: number };
    expect(payload.cvs).toEqual([1, 17, 18, 29]);
    expect(payload.track).toBe("prog");
    expect(payload.address).toBe(0);
    await waitFor(() => {
      expect(getCv(1)).toBe(12);
      expect(screen.getByTestId("q-addr")).toHaveTextContent("12");
    });
  });

  it("uses a cached programming-track address without another read", async () => {
    ensureCvScope({ decoder: "nmra", address: 0, station: "" });
    rememberRead(addressCvs);
    renderRegistry("?decoder=nmra&address=0&track=prog");
    await waitFor(() => {
      expect(screen.getByTestId("q-addr")).toHaveTextContent("12");
    });
    expect(cvRead).not.toHaveBeenCalled();
  });

  it("does not auto-read the address when the session already has one", async () => {
    renderRegistry("?decoder=nmra&address=5&track=prog");
    await waitFor(() => {
      expect(screen.getByTestId("cv8")).toHaveTextContent("missing");
    });
    expect(cvRead).not.toHaveBeenCalled();
  });

  it("ensureRead only fetches CVs missing from the table", async () => {
    renderRegistry("?decoder=nmra&address=5&track=pom");
    act(() => {
      rememberRead([{ cv: 8, value: 145 }]);
    });
    cvRead.mockResolvedValueOnce({ cvs: [{ cv: 2, value: 7 }], errors: [] });
    fireEvent.click(screen.getByText("ensure"));
    await waitFor(() => {
      expect(cvRead).toHaveBeenCalledTimes(1);
    });
    expect(cvRead.mock.calls[0]?.[0]).toMatchObject({
      cvs: [2],
      track: "pom",
      address: 5,
    });
    await waitFor(() => {
      expect(screen.getByTestId("cv8")).toHaveTextContent("145");
    });
    expect(getCv(2)).toBe(7);
  });

  it("ensureRead is a no-op when every CV is already in the table", async () => {
    renderRegistry("?decoder=nmra&address=5&track=prog");
    act(() => {
      rememberRead([
        { cv: 8, value: 145 },
        { cv: 2, value: 7 },
      ]);
    });
    fireEvent.click(screen.getByText("ensure"));
    await waitFor(() => {
      expect(screen.getByTestId("cv8")).toHaveTextContent("145");
    });
    expect(cvRead).not.toHaveBeenCalled();
  });

  it("passes the command-station id when the picker is on", async () => {
    mockAuth.config.stationPicker = true;
    renderRegistry("?decoder=nmra&address=5&station=8&track=pom");
    cvRead.mockResolvedValueOnce({ cvs: [{ cv: 8, value: 1 }], errors: [] });
    fireEvent.click(screen.getByText("ensure"));
    await waitFor(() => {
      expect(cvRead).toHaveBeenCalledTimes(1);
    });
    expect(cvRead.mock.calls[0]?.[0]).toMatchObject({
      stationId: 8,
      address: 5,
      track: "pom",
    });
  });

  it("apply writes staged diffs on the current track", async () => {
    renderRegistry("?decoder=nmra&address=5&track=pom");
    cvWrite.mockResolvedValue({ cvs: [{ cv: 2, value: 40 }], errors: [] });
    fireEvent.click(screen.getByText("stage"));
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("CV2=40");
    });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite).toHaveBeenCalled();
    });
    expect(cvWrite.mock.calls[0]?.[0]).toMatchObject({
      track: "pom",
      address: 5,
      cvs: [{ cv: 2, value: 40 }],
    });
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("");
    });
  });

  it("apply writes CV 29 before CV 6 on loksound-v5", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog");
    act(() => {
      rememberRead([
        { cv: 6, value: 151 },
        { cv: 29, value: 62 },
      ]);
      setCv(6, 58);
      setCv(29, 46);
    });
    cvWrite.mockResolvedValue({
      cvs: [
        { cv: 29, value: 46 },
        { cv: 6, value: 58 },
      ],
      errors: [],
    });
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("CV6=58");
    });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite).toHaveBeenCalled();
    });
    expect(cvWrite.mock.calls[0]?.[0]).toMatchObject({
      track: "prog",
      address: 5,
      cvs: [
        { cv: 29, value: 46 },
        { cv: 6, value: 58 },
      ],
    });
  });

  it("retargets the session address after applying a new short address", async () => {
    renderRegistry("?decoder=nmra&address=5&track=prog");
    act(() => {
      rememberRead([
        { cv: 1, value: 5 },
        { cv: 17, value: 192 },
        { cv: 18, value: 0 },
        { cv: 29, value: 0 },
      ]);
      setCv(1, 12);
    });
    cvWrite.mockResolvedValue({ cvs: [{ cv: 1, value: 12 }], errors: [] });
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("CV1=12");
    });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(screen.getByTestId("q-addr")).toHaveTextContent("12");
    });
    expect(getCv(1)).toBe(12);
  });

  it("keeps failed CVs in the change list after a partial write", async () => {
    renderRegistry("?decoder=nmra&address=5&track=pom");
    fireEvent.click(screen.getByText("stage"));
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("CV2=40");
    });
    cvWrite.mockResolvedValue({ cvs: [], errors: [2] });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId("diffs")).toHaveTextContent("CV2=40");
    });
  });

  it("skips address discovery when the kiosk is disabled", async () => {
    mockAuth.config.enabled = false;
    renderRegistry("?decoder=nmra&address=0&track=prog");
    await waitFor(() => {
      expect(screen.getByTestId("addr-err")).toHaveTextContent("no");
    });
    expect(cvRead).not.toHaveBeenCalled();
  });

  it("skips address discovery until SSO login when required", async () => {
    mockAuth.config.loginRequired = true;
    mockAuth.token = null;
    renderRegistry("?decoder=nmra&address=0&track=prog");
    await waitFor(() => {
      expect(screen.getByTestId("addr-err")).toHaveTextContent("no");
    });
    expect(cvRead).not.toHaveBeenCalled();
  });

  it("applies main diffs then side page batches", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberRead([{ cv: 2, value: 7 }]);
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    cvWrite.mockResolvedValue({ cvs: [], errors: [] });
    await waitFor(() => {
      expect(screen.getByTestId("sections")).toHaveTextContent("CV257 (str. 3)=4");
    });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite).toHaveBeenCalledTimes(2);
    });
    expect(cvWrite.mock.calls[0]?.[0]).toMatchObject({
      cvs: [{ cv: 2, value: 40 }],
    });
    expect(cvWrite.mock.calls[1]?.[0]).toMatchObject({
      cvs: [
        { cv: 31, value: 16 },
        { cv: 32, value: 3 },
        { cv: 257, value: 4 },
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId("has-pending")).toHaveTextContent("no");
    });
  });

  it("does not write indexed CVs when the side table is unregistered", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog");
    act(() => {
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    cvWrite.mockResolvedValue({ cvs: [{ cv: 2, value: 40 }], errors: [] });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite).toHaveBeenCalledTimes(1);
    });
    expect(cvWrite.mock.calls[0]?.[0]).toMatchObject({
      cvs: [{ cv: 2, value: 40 }],
    });
    expect(indexedCvDiffs()).toHaveLength(1);
  });

  it("hides side diffs after unregister without touching main", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByTestId("side-pending")).toHaveTextContent("yes");
    });
    fireEvent.click(screen.getByText("unregister-side"));
    await waitFor(() => {
      expect(screen.getByTestId("side-pending")).toHaveTextContent("no");
    });
    expect(screen.getByTestId("diffs")).toHaveTextContent("CV2=40");
    expect(screen.getByTestId("sections")).not.toHaveTextContent("CV257");
    expect(indexedCvDiffs()).toHaveLength(1);
  });

  it("discard clears main and the active side; discardSide leaves main", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberRead([{ cv: 2, value: 7 }]);
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByTestId("has-pending")).toHaveTextContent("yes");
    });
    fireEvent.click(screen.getByText("discard-side"));
    await waitFor(() => {
      expect(screen.getByTestId("side-pending")).toHaveTextContent("no");
    });
    expect(screen.getByTestId("diffs")).toHaveTextContent("CV2=40");
    expect(getIndexedCv(indexedKey(3, 257))).toBe(0);
    fireEvent.click(screen.getByText("discard"));
    await waitFor(() => {
      expect(screen.getByTestId("has-pending")).toHaveTextContent("no");
    });
    expect(getCv(2)).toBe(7);
  });

  it("rememberRead on a side is not pending; set creates a diff", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 20 }]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("side-pending")).toHaveTextContent("no");
    });
    act(() => {
      setIndexedCv(indexedKey(3, 257), 22);
    });
    await waitFor(() => {
      expect(screen.getByTestId("sections")).toHaveTextContent("CV257 (str. 3)=22");
    });
  });

  it("changing address scope does not leak old diffs", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByTestId("has-pending")).toHaveTextContent("yes");
    });
    fireEvent.click(screen.getByText("addr9"));
    await waitFor(() => {
      expect(screen.getByTestId("q-addr")).toHaveTextContent("9");
    });
    expect(screen.getByTestId("has-pending")).toHaveTextContent("no");
    expect(getCv(2)).toBeUndefined();
    expect(getIndexedCv(indexedKey(3, 257))).toBeUndefined();
  });

  it("registerSideTable of the same id is idempotent", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    fireEvent.click(screen.getByText("register-side-again"));
    await waitFor(() => {
      expect(screen.getByTestId("sections")).toHaveTextContent("CV257 (str. 3)=4");
    });
    expect(screen.getByTestId("sections").textContent?.split("CV257").length).toBe(2);
  });

  it("keeps failed side-page keys after a partial apply", async () => {
    renderRegistry("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberIndexedRead([
        { key: indexedKey(3, 257), value: 0 },
        { key: indexedKey(8, 257), value: 0 },
      ]);
      setIndexedCv(indexedKey(3, 257), 1);
      setIndexedCv(indexedKey(8, 257), 2);
    });
    cvWrite.mockImplementation(async (req: { cvs: { cv: number; value: number }[] }) => {
      const page = req.cvs.find((e) => e.cv === 32)?.value;
      if (page === 8) return { cvs: [], errors: [257] };
      return { cvs: req.cvs, errors: [] };
    });
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => {
      expect(cvWrite.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("sections")).toHaveTextContent("CV257 (str. 8)=2");
    });
    expect(screen.getByTestId("sections")).not.toHaveTextContent("CV257 (str. 3)=1");
    expect(getIndexedCv(indexedKey(3, 257))).toBe(1);
    expect(indexedCvDiffs().map((d) => d.key)).toEqual([indexedKey(8, 257)]);
  });
});
