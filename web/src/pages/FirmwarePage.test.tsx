import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import FirmwarePage from "./FirmwarePage";

const {
  mockAuth,
  firmwareStatus,
  firmwareList,
  firmwareScan,
  firmwareUpdate,
  firmwareWatch,
  functionSet,
} = vi.hoisted(() => {
  const config: PublicConfig = {
    enabled: true,
    mode: "standalone",
    programmingMode: "z21",
    ssoClientId: "programming-center",
    redirectUris: [],
    idleTimeoutSecs: 86400,
    stationPicker: false,
    loginRequired: false,
    wirelessProgrammer: { enabled: true, connected: false },
  };
  return {
    mockAuth: { config, token: null as string | null, ready: true },
    firmwareStatus: vi.fn(),
    firmwareList: vi.fn(),
    firmwareScan: vi.fn(),
    firmwareUpdate: vi.fn(),
    firmwareWatch: vi.fn(),
    functionSet: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/ws", () => ({
  programming: {
    firmwareStatus,
    firmwareList,
    functionSet,
    firmwareScan,
    firmwareUpdate,
    firmwareWatch,
  },
}));

vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/firmware${search}`]}>
      <Routes>
        <Route path="/firmware" element={<FirmwarePage />} />
        <Route path="/" element={<div data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FirmwarePage", () => {
  beforeEach(() => {
    firmwareStatus.mockResolvedValue({ enabled: true, connected: false });
    firmwareList.mockResolvedValue([]);
    firmwareScan.mockReset();
    firmwareUpdate.mockReset();
    firmwareWatch.mockReset();
  });
  it("redirects when the decoder has no firmware feature", () => {
    renderAt("?decoder=nmra&address=3&track=prog");
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("shows the wizard and WP-down alert for rb23xx", async () => {
    renderAt("?decoder=rb23xx&address=13&track=prog");
    expect(await screen.findByTestId("firmware-unavailable")).toBeInTheDocument();
    expect(screen.getByText("firmware.stepWifiOn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "firmware.enableWifi" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "firmware.next" }));
    expect(await screen.findByRole("button", { name: "firmware.scan" })).toBeDisabled();
  });

  it("hides the progress bar when the upload watch completes", async () => {
    firmwareStatus.mockResolvedValue({ enabled: true, connected: true });
    firmwareList.mockResolvedValue([{ name: "locoSound_secure_v1.11.1.bin", size: 844880 }]);
    firmwareScan.mockResolvedValue([
      { key: "64:e8:33:63:9c:5d", label: "RB2300_0680E", driver: "rb23xx" },
    ]);
    firmwareUpdate.mockResolvedValue("job-1");
    firmwareWatch.mockImplementation(async (_jobId, onProgress: (u: { state: string; step: string }) => void) => {
      onProgress({ state: "writing", step: "write" });
    });

    renderAt("?decoder=rb23xx&address=13&track=prog");
    fireEvent.click(await screen.findByRole("button", { name: "firmware.next" }));
    fireEvent.click(await screen.findByRole("button", { name: "firmware.scan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "firmware.next" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "firmware.next" }));
    fireEvent.click(await screen.findByText("locoSound_secure_v1.11.1.bin"));
    fireEvent.click(screen.getByRole("button", { name: "firmware.upload" }));

    expect(await screen.findByText("firmware.uploadDone")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/writing/i)).not.toBeInTheDocument();
  });
});
