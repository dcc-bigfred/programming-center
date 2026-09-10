import { act, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { MemoryRouter } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import ChangesPanel from "./ChangesPanel";
import { CvRegistryProvider, useCvRegistry } from "../cv/CvRegistry";
import { rememberIndexedRead, setIndexedCv } from "../cv/indexedTable";
import { setCv } from "../cv/table";
import { ESU_SIDE_ID, ESU_SIDE_TABLE, indexedKey } from "../features/esuMapping";
import i18n from "../i18n/core";

const { mockAuth } = vi.hoisted(() => {
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
  return { mockAuth: { config, token: null as string | null, ready: true } };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/ws", () => ({
  programming: {
    cvRead: vi.fn(),
    cvWrite: vi.fn(),
    withOverlay: (_opts: unknown, fn: (signal: AbortSignal) => Promise<unknown>) =>
      fn(new AbortController().signal),
  },
}));

function SideHost({ register }: { register: boolean }) {
  const r = useCvRegistry();
  useLayoutEffect(() => {
    if (!register) return;
    r.registerSideTable(ESU_SIDE_TABLE);
    return () => r.unregisterSideTable(ESU_SIDE_ID);
  }, [register, r.registerSideTable, r.unregisterSideTable]);
  return null;
}

function renderPanel(search: string, register: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <CvRegistryProvider>
        <SideHost register={register} />
        <ChangesPanel />
      </CvRegistryProvider>
    </MemoryRouter>,
  );
}

describe("ChangesPanel sections", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows a CV section and an ESU group while mapping is registered", async () => {
    renderPanel("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByText("CV")).toBeInTheDocument();
      expect(screen.getByText("ESU mapping")).toBeInTheDocument();
      expect(screen.getByText("CV257 (str. 3)=4")).toBeInTheDocument();
      expect(screen.getByText("CV2=40")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Create change list")).toBeEnabled();
  });

  it("hides the ESU group after unregister; changelist stays main-only", async () => {
    renderPanel("?decoder=loksound-v5&address=5&track=prog", false);
    act(() => {
      setCv(2, 40);
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByText("CV2=40")).toBeInTheDocument();
    });
    expect(screen.queryByText("ESU mapping")).not.toBeInTheDocument();
    expect(screen.queryByText("CV257 (str. 3)=4")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Create change list")).toBeEnabled();
  });

  it("does not offer a changelist when only the side table is dirty", async () => {
    renderPanel("?decoder=loksound-v5&address=5&track=prog", true);
    act(() => {
      rememberIndexedRead([{ key: indexedKey(3, 257), value: 0 }]);
      setIndexedCv(indexedKey(3, 257), 4);
    });
    await waitFor(() => {
      expect(screen.getByText("CV257 (str. 3)=4")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Create change list")).toBeDisabled();
    expect(screen.getByText("Apply")).toBeEnabled();
  });
});
