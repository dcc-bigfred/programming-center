import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import CouplerPage from "./CouplerPage";

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

vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./EsuCouplerPage", () => ({
  default: () => <div data-testid="esu-coupler" />,
}));

vi.mock("./ZimoCouplerPage", () => ({
  default: () => <div data-testid="zimo-coupler" />,
}));

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/coupler${search}`]}>
      <Routes>
        <Route path="/coupler" element={<CouplerPage />} />
        <Route path="/" element={<div data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CouplerPage", () => {
  it("redirects when the decoder has no coupler feature", () => {
    renderAt("?decoder=nmra&address=3&track=prog");
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("shows the ESU page for LokSound v4 and v5", () => {
    renderAt("?decoder=loksound-v5&address=5&track=prog");
    expect(screen.getByTestId("esu-coupler")).toBeInTheDocument();
  });

  it("shows the ESU page for LokSound v4", () => {
    renderAt("?decoder=loksound-v4&address=5&track=prog");
    expect(screen.getByTestId("esu-coupler")).toBeInTheDocument();
  });

  it("shows the ZIMO page for MS450", () => {
    renderAt("?decoder=zimo-ms450&address=5&track=prog");
    expect(screen.getByTestId("zimo-coupler")).toBeInTheDocument();
  });
});
