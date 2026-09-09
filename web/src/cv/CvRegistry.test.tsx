import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import { readQuery } from "../query";
import { CvRegistryProvider, useCvRegistry } from "./CvRegistry";
import { getCv, ensureCvScope, rememberRead, setCv } from "./table";

const { mockAuth, cvRead, cvWrite } = vi.hoisted(() => {
  const config: PublicConfig = {
    enabled: true,
    mode: "standalone",
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

function RegistryView() {
  const r = useCvRegistry();
  const [params] = useSearchParams();
  return (
    <div>
      <span data-testid="cv8">{r.get(8) ?? "missing"}</span>
      <span data-testid="diffs">{r.formatDiffs(r.diffs)}</span>
      <span data-testid="addr-err">{r.addressError ? "yes" : "no"}</span>
      <span data-testid="q-addr">{readQuery(params).address}</span>
      <span data-testid="apply-busy">{r.applyBusy ? "yes" : "no"}</span>
      <button type="button" onClick={() => void r.ensureRead([8, 2])}>
        ensure
      </button>
      <button type="button" onClick={() => r.set(2, 40)}>
        stage
      </button>
      <button type="button" onClick={() => void r.apply()}>
        apply
      </button>
    </div>
  );
}

function renderRegistry(search: string) {
  return render(
    <MemoryRouter
      initialEntries={[`/${search}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CvRegistryProvider>
        <RegistryView />
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
});
