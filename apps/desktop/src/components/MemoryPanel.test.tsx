import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../types";
import { MemorySettings, MemoryStatus } from "./MemoryPanel";

afterEach(cleanup);
const GB = 1073741824;
function snapshot(): Snapshot {
  return {
    totalMemory: 16 * GB,
    settings: { memoryMb: 4096 },
    session: { pid: 42 },
    memory: {
      total: 16 * GB,
      used: 10 * GB,
      available: 6 * GB,
      app: GB,
      server: 3 * GB,
      minecraftClients: 2 * GB,
      clientCount: 1,
      other: 4 * GB,
      observedAt: 1780100000,
      partialProcessVisibility: false,
    },
  } as Snapshot;
}

describe("dashboard memory status", () => {
  it("shows measured categories separately from the server allocation setting", () => {
    const s = snapshot();
    render(<MemoryStatus s={s} />);
    expect(
      screen.getByRole("heading", { name: "Computer memory" }),
    ).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Memory use: 10.0 GB of 16.0 GB. 6.0 GB available.",
    );
    const categories = [
      ["System & other apps", "4.0 GB"],
      ["Enderlink", "1.0 GB"],
      ["Minecraft game", "2.0 GB"],
      ["Hosted server", "3.0 GB"],
      ["Available", "6.0 GB"],
    ];
    for (const [name, value] of categories) {
      const row = screen.getByText(name).parentElement!;
      expect(within(row).getByText(value)).toBeTruthy();
    }
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps overlapping process estimates inside the total while preserving their values", () => {
    const s = snapshot();
    s.memory!.used = 4 * GB;
    s.memory!.available = 12 * GB;
    s.memory!.other = 0;
    const { container } = render(<MemoryStatus s={s} />);
    const widths = [
      ...container.querySelectorAll<HTMLElement>(".memory-status-part"),
    ].map((part) => parseFloat(part.style.width));
    expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(100);
    expect(widths.every((width) => width >= 0 && width <= 100)).toBe(true);
    expect(
      within(screen.getByText("Hosted server").parentElement!).getByText(
        "3.0 GB",
      ),
    ).toBeTruthy();
  });

  it("distinguishes missing measurements, an undetected game and a stopped server", () => {
    const s = snapshot();
    s.memory = undefined;
    const { rerender } = render(<MemoryStatus s={s} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Waiting for system memory measurements",
    );
    expect(screen.getAllByRole("term")).toHaveLength(5);
    s.memory = snapshot().memory;
    s.memory!.clientCount = 0;
    s.memory!.minecraftClients = 0;
    s.memory!.server = 0;
    s.session = null;
    rerender(<MemoryStatus s={s} />);
    expect(screen.getByText("Not detected")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getAllByRole("term")).toHaveLength(5);
  });
});

describe("default memory setting", () => {
  it("changes allocation only when the user selects a value, regardless of live headroom", async () => {
    const user = userEvent.setup();
    const allocate = vi.fn();
    const s = snapshot();
    const { rerender } = render(
      <MemorySettings s={s} disabled={false} allocate={allocate} />,
    );
    s.memory!.available = 0;
    s.memory!.used = 16 * GB;
    rerender(<MemorySettings s={s} disabled={false} allocate={allocate} />);
    expect(allocate).not.toHaveBeenCalled();
    expect(screen.queryByText("Computer memory")).toBeNull();
    expect(screen.queryByRole("button", { name: /Use .* GB/ })).toBeNull();
    await user.click(
      screen.getByRole("combobox", { name: "Default memory for new worlds" }),
    );
    await user.click(screen.getByRole("option", { name: "6 GB" }));
    expect(allocate).toHaveBeenCalledExactlyOnceWith(6144);
  });

  it("preserves custom allocations and keeps the three-row guide collapsed initially", async () => {
    const user = userEvent.setup();
    const s = snapshot();
    s.settings.memoryMb = 5632;
    render(<MemorySettings s={s} disabled allocate={vi.fn()} />);
    const select = screen.getByRole("combobox") as HTMLButtonElement;
    expect(select.disabled).toBe(true);
    expect(select.getAttribute("data-value")).toBe("5632");
    expect(select.textContent).toContain("5.5 GB");
    const guide = screen.getByText("Allocation guide").closest("details")!;
    expect(guide.open).toBe(false);
    await user.click(screen.getByText("Allocation guide"));
    expect(guide.open).toBe(true);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      4,
    );
  });
});
