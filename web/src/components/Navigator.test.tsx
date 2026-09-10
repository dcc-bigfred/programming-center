import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Navigator from "./Navigator";

vi.mock("../cv/CvRegistry", () => ({
  useCvRegistry: () => ({ hasPending: false, discard: vi.fn() }),
}));

vi.mock("./ChangeListsNav", () => ({
  default: () => <div data-testid="change-lists" />,
}));

vi.mock("./ChangesPanel", () => ({
  default: () => <div data-testid="changes" />,
}));

vi.mock("./ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock("../i18n", () => ({
  optionalT: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        "app.title": "Programming Center",
        "nav.overview": "Strona główna",
        "nav.programming": "Programowanie",
        "nav.telemetry": "Telemetria",
        "telemetry.heading": "Telemetria",
        "home.decoder": "Dekoder",
        "home.pickDecoder": "Najpierw wybierz dekoder.",
      };
      return copy[key] ?? key;
    },
  }),
}));

describe("Navigator telemetry section", () => {
  it("shows Telemetry between programming and changes without a decoder", () => {
    render(
      <MemoryRouter initialEntries={["/?address=0&track=prog"]}>
        <Navigator />
      </MemoryRouter>,
    );
    expect(screen.getByText("Programowanie")).toBeInTheDocument();
    expect(screen.getByTestId("changes")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Telemetria" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/telemetry"));
    const hr = document.querySelectorAll("hr");
    expect(hr.length).toBeGreaterThanOrEqual(2);
  });
});
