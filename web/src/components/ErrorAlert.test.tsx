import { render, screen } from "@testing-library/react";

import { ApiError } from "../api/client";
import ErrorAlert, { errorCode } from "./ErrorAlert";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        "errors.decoder_absent": "Lokomotywa nie jest na torach.",
        "errors.generic": "Błąd",
      };
      return copy[key] ?? key;
    },
  }),
}));

describe("ErrorAlert", () => {
  it("maps ApiError codes and unknown values", () => {
    expect(errorCode(new ApiError(503, "z21_unreachable"))).toBe("z21_unreachable");
    expect(errorCode(new Error("empty"))).toBe("generic");
    expect(errorCode("x")).toBe("generic");
  });

  it("renders translated programming errors and hides cancelled", () => {
    const { rerender } = render(<ErrorAlert error={new ApiError(503, "decoder_absent")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Lokomotywa nie jest na torach.");
    expect(screen.getByRole("alert").textContent).not.toContain("decoder_absent");
    rerender(<ErrorAlert error={new ApiError(0, "cancelled")} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
