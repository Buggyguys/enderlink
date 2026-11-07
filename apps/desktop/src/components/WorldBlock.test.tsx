import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldBlock, WorldBlockPicker } from "./WorldBlock";
import type { WorldBlockKind } from "./WorldBlock";

beforeEach(() => {
  // jsdom lacks CSS.escape, which user-event uses for native radio navigation.
  vi.stubGlobal("CSS", {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("world artwork", () => {
  it("can choose and clear artwork using the keyboard", async () => {
    function Form() {
      const [kind, setKind] = useState<WorldBlockKind | null>(null);
      return (
        <>
          <WorldBlockPicker value={kind} onChange={setKind} />
          <WorldBlock kind={kind} decorative={false} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Form />);
    const none = screen.getByRole("radio", { name: "None" });
    await user.tab();
    expect(document.activeElement).toBe(none);
    await user.keyboard("{ArrowRight}");
    expect(
      (screen.getByRole("radio", { name: "Amethyst" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByRole("img", { name: "Amethyst block" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect((none as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img", { name: "Lantern block" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img", { name: "Mushroom block" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img", { name: "Cake block" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img", { name: "Pumpkin block" })).toBeTruthy();
  });

  it("keeps separate pickers independent and prevents changes while disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="first">
          <WorldBlockPicker value="amethyst" onChange={onChange} />
        </div>
        <div data-testid="second">
          <WorldBlockPicker value="rose-glass" onChange={onChange} disabled />
        </div>
      </>,
    );
    const first = within(screen.getByTestId("first")).getByRole("radio", {
      name: "Amethyst",
    }) as HTMLInputElement;
    const second = within(screen.getByTestId("second")).getByRole("radio", {
      name: "Rose glass",
    }) as HTMLInputElement;
    expect(first.name).not.toBe(second.name);
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);
    await user.click(
      within(screen.getByTestId("second")).getByRole("radio", {
        name: "Obsidian",
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves older worlds and unavailable artwork empty without throwing", () => {
    const { container, rerender } = render(<WorldBlock kind={undefined} />);
    expect(container.innerHTML).toBe("");
    rerender(<WorldBlock kind="not-installed" />);
    expect(container.innerHTML).toBe("");
    render(<WorldBlockPicker value="not-installed" onChange={() => {}} />);
    expect(
      (screen.getByRole("radio", { name: "None" }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
