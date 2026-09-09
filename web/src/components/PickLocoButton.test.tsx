import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import type { CatalogueVehicle, Me, PublicConfig } from "../api/types";
import { readQuery } from "../query";
import PickLocoButton from "./PickLocoButton";

const { mockAuth, vehicleCatalogue } = vi.hoisted(() => {
  const config: PublicConfig = {
    enabled: true,
    mode: "bigfred",
    ssoClientId: "programming-center",
    redirectUris: [],
    idleTimeoutSecs: 86400,
    stationPicker: true,
    loginRequired: true,
  };
  const me: Me = {
    id: 1,
    login: "damian",
    role: "admin",
    effectiveRole: "admin",
    layoutId: 2,
    layoutName: "layout",
  };
  return {
    mockAuth: { config, me } as { config: PublicConfig; me: Me | null },
    vehicleCatalogue: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/client", () => ({
  api: { vehicleCatalogue },
}));

vi.mock("../cv/CvRegistry", () => ({
  useCvRegistry: () => ({ diffs: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { address?: number; carrier?: string }) => {
      const copy: Record<string, string> = {
        "app.pickLoco": "Wybierz lokomotywę",
        "app.pickLocoBigFredOnly": "Tylko w trybie BigFred",
        "app.pickLocoEmpty": "Brak lokomotyw z adresem DCC.",
        "app.pickLocoFilter": "Filtruj po nazwie, adresie DCC lub przewoźniku",
        "app.pickLocoFilterEmpty": "Brak pasujących lokomotyw",
        "app.pickLocoAddress": opts?.address != null ? `DCC ${opts.address}` : "DCC",
        "app.pickLocoAddressCarrier":
          opts?.address != null
            ? `DCC ${opts.address} · ${opts.carrier ?? ""}`
            : "DCC",
        "changes.close": "Zamknij",
      };
      return copy[key] ?? key;
    },
  }),
}));

function AddressProbe() {
  const [params] = useSearchParams();
  return <div data-testid="address">{readQuery(params).address}</div>;
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={["/?track=prog&address=0"]}>
      <PickLocoButton />
      <AddressProbe />
    </MemoryRouter>,
  );
}

const locos: CatalogueVehicle[] = [
  {
    id: "v1",
    name: "EP09",
    number: "001",
    dccAddress: 12,
    isDummy: false,
    ownerId: 1,
    carrier: "PKP Cargo",
  },
];

describe("PickLocoButton", () => {
  beforeEach(() => {
    mockAuth.config.mode = "bigfred";
    mockAuth.me = {
      id: 1,
      login: "damian",
      role: "admin",
      effectiveRole: "admin",
      layoutId: 2,
      layoutName: "layout",
    };
    vehicleCatalogue.mockReset();
  });

  it("is disabled in standalone with a BigFred-only tooltip", () => {
    mockAuth.config.mode = "standalone";
    renderButton();
    const button = screen.getByRole("button", { name: "Wybierz lokomotywę" });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("Tylko w trybie BigFred")).toBeInTheDocument();
  });

  it("sets the DCC address from the chosen locomotive", async () => {
    vehicleCatalogue.mockResolvedValue(locos);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz lokomotywę" }));
    await waitFor(() => expect(screen.getByText("EP09 · 001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("EP09 · 001"));
    expect(screen.getByTestId("address")).toHaveTextContent("12");
  });
});
