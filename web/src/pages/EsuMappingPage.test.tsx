import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import Header from "../components/Header";
import { CvRegistryProvider } from "../cv/CvRegistry";
import {
  ensureIndexedCvScope,
  getIndexedCv,
  indexedCvDiffs,
  rememberIndexedRead,
  setIndexedCv,
} from "../cv/indexedTable";
import { ensureCvScope, getCv, rememberRead, setCv } from "../cv/table";
import { getDecoder } from "../decoders/registry";
import {
  indexedKey,
  loksoundV5Mapping,
  outputConfigPage,
  rowGroups,
} from "../features/esuMapping";
import i18n from "../i18n/core";
import EsuMappingPage from "./EsuMappingPage";

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
    mockAuth: { config, token: null as string | null, ready: true },
    cvRead: vi.fn(),
    cvWrite: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("material-ui-flags", () => ({
  IconFlagDE: () => null,
  IconFlagUK: () => null,
}));

vi.mock("../api/ws", () => ({
  programming: {
    cvRead,
    cvWrite,
    withOverlay: (_opts: unknown, fn: (signal: AbortSignal) => Promise<unknown>) =>
      fn(new AbortController().signal),
  },
}));

const decoder = getDecoder("loksound-v5")!;

function fillFirstGroup() {
  ensureCvScope({ decoder: "loksound-v5", address: 5, station: "" });
  ensureIndexedCvScope({ decoder: "loksound-v5", address: 5, station: "" });
  for (const page of rowGroups(loksoundV5Mapping)[0].pages) {
    rememberIndexedRead(page.cvs.map((cv) => ({ key: indexedKey(page.cv32, cv), value: 0 })));
  }
  const outputs = outputConfigPage(loksoundV5Mapping);
  rememberIndexedRead(outputs.cvs.map((cv) => ({ key: indexedKey(outputs.cv32, cv), value: 0 })));
}

function renderMapping(withHeader = false) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <CvRegistryProvider>
            {withHeader ? (
              <Header
                title="Mapping"
                showSession
                fullscreen={false}
                language="en"
                stations={null}
                status={null}
                onDrawerToggle={() => undefined}
                onToggleFullscreen={() => undefined}
                onLogout={() => undefined}
              />
            ) : null}
            <Outlet />
          </CvRegistryProvider>
        ),
        children: [
          {
            path: "/mapping",
            element: (
              <>
                <Link to="/cv?decoder=loksound-v5&address=5&track=prog">to-cv</Link>
                <Link to="/coupler?decoder=loksound-v5&address=5&track=prog">to-coupler</Link>
                <EsuMappingPage
                  decoder={decoder}
                  profile={loksoundV5Mapping}
                  session={{ address: 5, track: "prog" }}
                />
              </>
            ),
          },
          { path: "/cv", element: <div data-testid="cv-page">cv-page</div> },
          { path: "/coupler", element: <div data-testid="coupler-page">coupler-page</div> },
        ],
      },
    ],
    {
      initialEntries: ["/mapping?decoder=loksound-v5&address=5&track=prog"],
      future: { v7_relativeSplatPath: true },
    },
  );
  return { router, ...render(<RouterProvider router={router} future={{ v7_startTransition: true }} />) };
}

describe("EsuMappingPage leave", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    cvRead.mockReset();
    cvWrite.mockReset();
    cvRead.mockResolvedValue({ cvs: [], errors: [] });
    cvWrite.mockResolvedValue({ cvs: [], errors: [] });
    fillFirstGroup();
  });

  it("asks before leaving with dirty mapping; cancel stays and keeps both tables", async () => {
    renderMapping();
    act(() => {
      rememberRead([{ cv: 2, value: 7 }]);
      setCv(2, 40);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    fireEvent.click(screen.getByText("to-cv"));
    expect(await screen.findByText("Discard mapping changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByTestId("cv-page")).not.toBeInTheDocument();
    });
    expect(getIndexedCv(indexedKey(3, 257))).toBe(4);
    expect(getCv(2)).toBe(40);
    expect(indexedCvDiffs()).toHaveLength(1);
  });

  it("discards only the side table on confirm and keeps main diffs", async () => {
    renderMapping();
    act(() => {
      rememberRead([{ cv: 2, value: 7 }]);
      setCv(2, 40);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    fireEvent.click(screen.getByText("to-cv"));
    expect(await screen.findByText("Discard mapping changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByTestId("cv-page")).toBeInTheDocument();
    expect(indexedCvDiffs()).toEqual([]);
    expect(getIndexedCv(indexedKey(3, 257))).toBe(0);
    expect(getCv(2)).toBe(40);
  });

  it("leaves a clean mapping without a dialog and keeps the read cache", async () => {
    const first = renderMapping();
    expect(screen.queryByText("Discard mapping changes?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("to-cv"));
    expect(await screen.findByTestId("cv-page")).toBeInTheDocument();
    expect(screen.queryByText("Discard mapping changes?")).not.toBeInTheDocument();
    first.unmount();
    renderMapping();
    expect(getIndexedCv(indexedKey(3, 257))).toBe(0);
  });

  it("does not prompt when switching mapping tabs", async () => {
    renderMapping();
    act(() => {
      setIndexedCv(indexedKey(3, 257), 4);
    });
    fireEvent.click(screen.getByRole("tab", { name: "Output setup" }));
    expect(screen.queryByText("Discard mapping changes?")).not.toBeInTheDocument();
    expect(indexedCvDiffs()).toHaveLength(1);
  });

  it("keeps dirty indexed diffs when going to the coupler page", async () => {
    renderMapping();
    act(() => {
      setIndexedCv(indexedKey(3, 257), 4);
    });
    fireEvent.click(screen.getByText("to-coupler"));
    expect(await screen.findByTestId("coupler-page")).toBeInTheDocument();
    expect(screen.queryByText("Discard mapping changes?")).not.toBeInTheDocument();
    expect(indexedCvDiffs()).toHaveLength(1);
    expect(getIndexedCv(indexedKey(3, 257))).toBe(4);
  });

  it("header address change uses the existing discard confirm for main and side", async () => {
    renderMapping(true);
    act(() => {
      rememberRead([{ cv: 2, value: 7 }]);
      setCv(2, 40);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    const addr = screen.getByLabelText("DCC address");
    fireEvent.change(addr, { target: { value: "9" } });
    fireEvent.blur(addr);
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => {
      expect(indexedCvDiffs()).toEqual([]);
    });
    expect(getCv(2)).not.toBe(40);
  });
});
