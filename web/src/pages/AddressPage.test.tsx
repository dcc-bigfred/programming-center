import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import type { PublicConfig } from "../api/types";
import { ApiError } from "../api/client";
import { readQuery } from "../query";
import AddressPage from "./AddressPage";

const { mockAuth, cvRead, addressSet, withOverlay } = vi.hoisted(() => {
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
    addressSet: vi.fn(),
    withOverlay: vi.fn(
      (_opts: unknown, fn: (signal: AbortSignal) => Promise<unknown>) =>
        fn(new AbortController().signal),
    ),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/ws", () => ({
  programming: { cvRead, addressSet, withOverlay },
}));

vi.mock("../components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        "address.value": "Adres",
        "address.read": "Odczytaj",
        "address.save": "Zapisz",
        "address.unread": "Nie odczytano",
        "address.modeShort": "Adres krótki (CV 1)",
        "address.modeLong": "Adres długi (CV 17/18)",
        "address.railcomPlus": "RailComPlus",
        "address.railcomPlusOn": "Włączony",
        "address.railcomPlusOff": "Wyłączony",
        "address.railcomPlusUnknown": "Nie odczytano (CV 28)",
        "address.railcomPlusHint": "hint-plus",
        "errors.address_reverted": "Adres wrócił",
        "errors.generic": "Coś poszło nie tak.",
      };
      return copy[key] ?? key;
    },
  }),
}));

function AddressProbe() {
  const [params] = useSearchParams();
  return <div data-testid="query-address">{readQuery(params).address}</div>;
}

function renderPage(search = "?decoder=loksound-v5&track=pom&address=13") {
  return render(
    <MemoryRouter initialEntries={[`/address${search}`]}>
      <AddressPage />
      <AddressProbe />
    </MemoryRouter>,
  );
}

describe("AddressPage", () => {
  beforeEach(() => {
    cvRead.mockReset();
    addressSet.mockReset();
    withOverlay.mockClear();
  });

  it("writes the new address via address.set on the programming track, not cv.write", async () => {
    addressSet.mockResolvedValue({
      cvs: [
        { cv: 17, value: 230 },
        { cv: 18, value: 0 },
        { cv: 29, value: 62 },
      ],
      errors: [],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "9728" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => {
      expect(addressSet).toHaveBeenCalledWith({
        address: 13,
        newAddress: 9728,
        longBit: 5,
        railcomPlus: undefined,
        signal: expect.any(AbortSignal),
        stationId: undefined,
      });
    });
    expect(withOverlay).toHaveBeenCalledWith({ mode: "write" }, expect.any(Function));
    await waitFor(() => {
      expect(screen.getByTestId("query-address")).toHaveTextContent("9728");
    });
  });

  it("reads address CVs on the programming track even when query track is pom", async () => {
    cvRead.mockResolvedValue({
      cvs: [
        { cv: 1, value: 13 },
        { cv: 17, value: 230 },
        { cv: 18, value: 0 },
        { cv: 29, value: 30 },
      ],
      errors: [],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Odczytaj" }));
    await waitFor(() => {
      expect(cvRead).toHaveBeenCalledWith(
        expect.objectContaining({ track: "prog", cvs: [1, 17, 18, 28, 29], address: 13 }),
      );
    });
  });

  it("shows RailComPlus from CV 28 and passes the toggle on save", async () => {
    cvRead.mockResolvedValue({
      cvs: [
        { cv: 1, value: 13 },
        { cv: 17, value: 200 },
        { cv: 18, value: 90 },
        { cv: 28, value: 131 },
        { cv: 29, value: 30 },
      ],
      errors: [],
    });
    addressSet.mockResolvedValue({
      cvs: [
        { cv: 17, value: 200 },
        { cv: 18, value: 90 },
        { cv: 29, value: 62 },
      ],
      errors: [],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Odczytaj" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Włączony")).toBeChecked();
    });
    fireEvent.click(screen.getByLabelText("Wyłączony"));
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "2138" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => {
      expect(addressSet).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 13,
          newAddress: 2138,
          longBit: 5,
          railcomPlus: false,
        }),
      );
    });
  });

  it("shows address_reverted and adopts the address the decoder still has", async () => {
    addressSet.mockRejectedValue(
      new ApiError(0, "address_reverted", "CV29=30", [
        { cv: 1, value: 13 },
        { cv: 17, value: 200 },
        { cv: 18, value: 90 },
        { cv: 29, value: 30 },
      ]),
    );
    renderPage("?decoder=loksound-v5&track=prog&address=13");
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "2138" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Adres wrócił");
    });
    expect(screen.getByTestId("query-address")).toHaveTextContent("13");
    expect(screen.getByLabelText("Adres")).toHaveValue(13);
  });
});
