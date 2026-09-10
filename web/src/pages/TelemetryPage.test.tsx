import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { PublicConfig, TelemetryUpdate } from "../api/types";
import TelemetryPage from "./TelemetryPage";

const { mockAuth, telemetrySubscribe } = vi.hoisted(() => {
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
    telemetrySubscribe: vi.fn().mockReturnValue(new Promise(() => {})),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/ws", () => ({
  programming: { telemetrySubscribe },
}));

vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        "telemetry.railcomHint":
          "Telemetria wyświetli się jedynie, gdy centralka oraz pojazd mają włączone RailCom",
        "telemetry.needAddress": "Wybierz adres pojazdu w nagłówku.",
        "telemetry.z21Only": "Potrzeba Z21.",
        "telemetry.address": "Adres",
        "telemetry.speed": "Prędkość",
        "telemetry.speedUnit": "km/h",
        "telemetry.qos": "Jakość odbioru",
        "telemetry.load": "Obciążenie",
        "telemetry.speed128": "Prędkość (128)",
        "telemetry.location": "Adres lokalizacji",
        "telemetry.temperature": "Temperatura",
        "telemetry.tempUnit": "°C",
        "telemetry.voltage": "Napięcie toru",
        "telemetry.voltageUnit": "V",
        "telemetry.warning": "Ostrzeżenie",
        "telemetry.info1": "Info 1",
        "telemetry.orientation": "Polaryzacja toru",
        "telemetry.positive": "dodatnia",
        "telemetry.negative": "ujemna",
        "telemetry.travel": "Kierunek jazdy",
        "telemetry.travelNeg": "ujemny",
        "telemetry.travelPos": "dodatni",
        "telemetry.moving": "W ruchu",
        "telemetry.consist": "W składzie",
        "telemetry.requestCh2": "Żądanie kanału 2",
        "telemetry.yes": "tak",
        "telemetry.no": "nie",
        "telemetry.dynHint":
          "Z21 LAN przekazuje tylko prędkość i jakość odbioru. Pozostałe pola pojawią się, gdy źródło poda pełny kanał RailCom (DYN).",
        "telemetry.empty": "—",
        "telemetry.waiting": "Oczekiwanie na dane RailCom…",
      };
      return copy[key] ?? key;
    },
  }),
}));

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/telemetry${search}`]}>
      <TelemetryPage />
    </MemoryRouter>,
  );
}

describe("TelemetryPage", () => {
  beforeEach(() => {
    telemetrySubscribe.mockReset();
    telemetrySubscribe.mockReturnValue(new Promise(() => {}));
    mockAuth.config.programmingMode = "z21";
  });

  it("always shows the RailCom hint", () => {
    renderPage("?address=0&track=prog");
    expect(
      screen.getByText(
        "Telemetria wyświetli się jedynie, gdy centralka oraz pojazd mają włączone RailCom",
      ),
    ).toBeInTheDocument();
    expect(telemetrySubscribe).not.toHaveBeenCalled();
  });

  it("asks for an address when none is set", () => {
    renderPage("?address=0&track=prog");
    expect(screen.getByText("Wybierz adres pojazdu w nagłówku.")).toBeInTheDocument();
  });

  it("explains Z21 is required outside programmingMode z21", () => {
    mockAuth.config.programmingMode = "bigfred";
    renderPage("?address=13&track=prog");
    expect(screen.getByText("Potrzeba Z21.")).toBeInTheDocument();
    expect(telemetrySubscribe).not.toHaveBeenCalled();
  });

  it("shows empty metrics while waiting for RailCom", () => {
    renderPage("?address=13&track=prog");
    expect(telemetrySubscribe).toHaveBeenCalledWith(
      { address: 13 },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(screen.getByText("Oczekiwanie na dane RailCom…")).toBeInTheDocument();
    expect(screen.getByText("Obciążenie")).toBeInTheDocument();
    expect(screen.queryByText("Zbiorniki")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("renders Table 13 fields from an update", () => {
    let onUpdate: (update: TelemetryUpdate) => void = () => {};
    telemetrySubscribe.mockImplementation((_input, cb: (update: TelemetryUpdate) => void) => {
      onUpdate = cb;
      return new Promise(() => {});
    });
    renderPage("?address=13&track=prog");
    act(() => {
      onUpdate({
        address: 13,
        speedKmh: 80,
        qosPercent: 12,
        load: 5,
        speed128: 64,
        locationAddress: 0x123,
        temperatureC: 21,
        trackVoltageMv: 14_500,
        warning: 3,
        info1: {
          orientationPositive: true,
          travelNegative: false,
          moving: true,
          consist: false,
          requestChannel2: false,
        },
      });
    });
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
    expect(screen.getByText("291")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("14.5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Polaryzacja toru: dodatnia")).toBeInTheDocument();
    expect(screen.getByText("W ruchu: tak")).toBeInTheDocument();
    expect(screen.queryByText("Oczekiwanie na dane RailCom…")).not.toBeInTheDocument();
  });
});
