import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select";

afterEach(cleanup);
const choices: SelectOption[] = [
  { value: "", label: "World activity only" },
  { value: "offline:one", label: "Birch · offline name" },
  { value: "verified:one", label: "Birch · verified" },
  { value: "blocked", label: "Unavailable", disabled: true },
];
function Picker() {
  const [value, setValue] = useState("");
  return (
    <Select
      aria-label="Compare a player"
      value={value}
      onValueChange={setValue}
      options={choices}
    />
  );
}

describe("shared desktop select", () => {
  it("closes an open menu when its control becomes unavailable", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Select
        aria-label="Player"
        value=""
        options={choices}
        onValueChange={onValueChange}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    rerender(
      <Select
        aria-label="Player"
        value=""
        options={choices}
        onValueChange={onValueChange}
        disabled
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
    rerender(
      <Select
        aria-label="Player"
        value=""
        options={choices}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("round trips an empty choice and distinguishes duplicate player names", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("combobox", { name: "Compare a player" });
    expect(trigger.textContent).toContain("World activity only");
    await user.click(trigger);
    await user.click(
      screen.getByRole("option", { name: "Birch · offline name" }),
    );
    expect(trigger.getAttribute("data-value")).toBe("offline:one");
    await user.click(trigger);
    await user.click(
      screen.getByRole("option", { name: "World activity only" }),
    );
    expect(trigger.getAttribute("data-value")).toBe("");
    expect(trigger.textContent).toContain("World activity only");
  });

  it("supports keyboard selection, skips disabled items and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{End}{Enter}");
    expect(trigger.getAttribute("data-value")).toBe("verified:one");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.keyboard("{ArrowDown}{Home}{Escape}");
    expect(trigger.getAttribute("data-value")).toBe("verified:one");
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps loading and disabled selections inert and does not choose a replacement automatically", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Select
        aria-label="Version"
        value="old"
        onValueChange={onValueChange}
        options={[]}
        placeholder="Loading versions…"
      />,
    );
    const trigger = screen.getByRole("combobox") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toContain("Loading versions…");
    rerender(
      <Select
        aria-label="Version"
        value="old"
        onValueChange={onValueChange}
        options={[{ value: "new", label: "New build" }]}
        placeholder="Choose a version"
      />,
    );
    expect(trigger.textContent).toContain("Choose a version");
    expect(onValueChange).not.toHaveBeenCalled();
    rerender(
      <Select
        aria-label="Version"
        value="new"
        onValueChange={onValueChange}
        options={[{ value: "new", label: "New build" }]}
        disabled
      />,
    );
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toContain("New build");
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
