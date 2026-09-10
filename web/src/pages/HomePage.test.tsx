import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import HomePage, { POM_HINT_STORAGE_KEY } from "./HomePage";

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

vi.mock("../cv/CvRegistry", () => ({
  useCvRegistry: () => ({ rememberRead: vi.fn() }),
}));

vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../i18n", () => ({
  optionalT: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        "home.pickDecoder": "Najpierw wybierz dekoder.",
        "home.lead": "Wybierz dekoder",
        "home.pomHintLead": "Wskazówka:",
        "home.pomHintBody": "spróbuj POM.",
        "home.pomHintSpeed": "W trybie POM szybciej.",
        "home.detect": "Wykryj dekoder",
        "home.detectHint": "CV 8",
      };
      return copy[key] ?? key;
    },
  }),
}));

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage POM hint", () => {
  it("shows an info tip above decoder tiles and keeps it closed after dismiss", () => {
    renderHome();
    const hint = screen.getByRole("alert");
    expect(hint).toHaveTextContent("Wskazówka: spróbuj POM. W trybie POM szybciej.");
    expect(hint).toHaveClass("MuiAlert-standardInfo");
    expect(hint.querySelector("strong")?.textContent).toBe("Wskazówka:");
    expect(hint.querySelectorAll("strong")[1]).toHaveTextContent("W trybie POM szybciej.");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Wskazówka:")).toBeNull();
    expect(localStorage.getItem(POM_HINT_STORAGE_KEY)).toBe("1");

    renderHome();
    expect(screen.queryByText("Wskazówka:")).toBeNull();
  });
});
