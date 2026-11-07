import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localDayBoundaries,
  PlaytimeHistory,
  type PlaytimeHistoryData,
} from "./WorldHistory";

afterEach(cleanup);

function historyFixture(): PlaytimeHistoryData {
  const boundaries = localDayBoundaries(30, new Date(2026, 10, 6, 20));
  const days = boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1],
    worldSeconds: index === 0 ? 7200 : index === 29 ? 3600 : 0,
    players:
      index === 29
        ? [
            { id: "verified:real-uuid", name: "Alex", seconds: 3000 },
            { id: "offline:name-uuid", name: "Alex", seconds: 2700 },
          ]
        : [],
  }));
  return {
    worldId: "world-one",
    recordedFrom: boundaries[0],
    observedAt: new Date(2026, 10, 6, 20).getTime() / 1000,
    days,
    players: [
      { id: "verified:real-uuid", name: "Alex", verified: true },
      { id: "offline:name-uuid", name: "Alex", verified: false },
    ],
  };
}

describe("connected playtime history", () => {
  it("uses world union time and separates identical names in different account modes", async () => {
    const user = userEvent.setup();
    render(<PlaytimeHistory history={historyFixture()} />);
    const totals = screen.getByLabelText("Playtime in selected period");
    expect(within(totals).getByText("1h")).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: "Compare a player" });
    await user.click(picker);
    expect(
      screen.getByRole("option", { name: "Alex · verified" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Alex · offline name" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("option", { name: "Alex · offline name" }),
    );
    expect(within(totals).getByText("45m")).toBeTruthy();
    expect(within(totals).getByText("1h")).toBeTruthy();
    await user.click(picker);
    await user.click(screen.getByRole("option", { name: "Alex · verified" }));
    expect(within(totals).getByText("50m")).toBeTruthy();
    expect(within(totals).queryByText("45m")).toBeNull();
  });

  it("switches the requested period and allows keyboard exploration of daily values", async () => {
    const user = userEvent.setup();
    render(<PlaytimeHistory history={historyFixture()} />);
    const totals = screen.getByLabelText("Playtime in selected period");
    await user.click(screen.getByRole("button", { name: "30 days" }));
    expect(within(totals).getByText("3h")).toBeTruthy();
    const plot = screen.getByRole("group", { name: /Daily playtime/ });
    const days = within(plot).getAllByRole("button");
    expect(days).toHaveLength(30);
    await user.click(days[29]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(days[28]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(days[0]);
    expect(days[0].getAttribute("aria-label")).toContain("world activity 2h");
    await user.click(screen.getByText("View daily values"));
    expect(screen.getByRole("table").textContent).toContain("2h");
  });

  it("does not invent playtime before recording began", () => {
    const history = historyFixture();
    history.recordedFrom = history.days[29].start;
    history.days[0].worldSeconds = 0;
    render(<PlaytimeHistory history={history} />);
    const plot = screen.getByRole("group", { name: /Daily playtime/ });
    const days = within(plot).getAllByRole("button");
    expect(days[0].getAttribute("aria-label")).toContain(
      "before recording began",
    );
    expect(days[6].getAttribute("aria-label")).toContain("world activity 1h");
  });

  it("shows an honest empty state without synthetic chart points", () => {
    const history = historyFixture();
    history.recordedFrom = null;
    history.days.forEach((day) => {
      day.worldSeconds = 0;
      day.players = [];
    });
    history.players = [];
    render(<PlaytimeHistory history={history} />);
    expect(
      screen.getByText("Adventures will leave a trail here."),
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Daily playtime/ })).toBeNull();
    expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Earlier playtime is unavailable/)).toBeTruthy();
  });

  it("distinguishes an empty recent period from a world with no recording", async () => {
    const user = userEvent.setup();
    const history = historyFixture();
    history.days[29].worldSeconds = 0;
    history.days[29].players = [];
    render(<PlaytimeHistory history={history} />);
    expect(
      screen.getByText("No recorded playtime in these 7 days."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Adventures will leave a trail here."),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByRole("group", { name: /Daily playtime/ })).toBeTruthy();
    expect(
      within(screen.getByLabelText("Playtime in selected period")).getByText(
        "2h",
      ),
    ).toBeTruthy();
  });

  it("retains measured history and explains when player tracking is unavailable", () => {
    render(<PlaytimeHistory history={historyFixture()} trackingUnavailable />);
    expect(screen.getByRole("status").textContent).toBe(
      "Waiting for Minecraft’s player list; unobserved time is not counted.",
    );
    expect(screen.getByRole("group", { name: /Daily playtime/ })).toBeTruthy();
    expect(
      within(screen.getByLabelText("Playtime in selected period")).getByText(
        "1h",
      ),
    ).toBeTruthy();
  });

  it("does not ask already connected players to connect when tracking is unavailable", () => {
    const history = historyFixture();
    history.days.forEach((day) => {
      day.worldSeconds = 0;
      day.players = [];
    });
    render(<PlaytimeHistory history={history} trackingUnavailable />);
    expect(
      screen.getByText("Waiting for Minecraft’s player list."),
    ).toBeTruthy();
    expect(screen.queryByText(/Connect a player to add time/)).toBeNull();
    expect(screen.queryByRole("group", { name: /Daily playtime/ })).toBeNull();
  });

  it("keeps recorded data visible on a failed refresh and offers retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <PlaytimeHistory
        history={historyFixture()}
        error="Could not read play history."
        onRefresh={retry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not read play history.",
    );
    expect(screen.getByRole("group", { name: /Daily playtime/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh playtime" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("local calendar boundaries", () => {
  it("covers the current local day across month boundaries", () => {
    const boundaries = localDayBoundaries(7, new Date(2026, 10, 2, 23, 50));
    expect(boundaries).toHaveLength(8);
    expect(new Date(boundaries[0] * 1000).getDate()).toBe(27);
    expect(new Date(boundaries[0] * 1000).getMonth()).toBe(9);
    expect(new Date(boundaries[7] * 1000).getDate()).toBe(3);
    expect(boundaries.map((edge) => new Date(edge * 1000).getHours())).toEqual(
      Array(8).fill(0),
    );
  });

  it("preserves actual local-day lengths across daylight saving transitions", () => {
    const boundaries = localDayBoundaries(3, new Date(2026, 2, 30, 12));
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = new Date(boundaries[index] * 1000);
      const end = new Date(boundaries[index + 1] * 1000);
      expect(end.getHours()).toBe(0);
      expect(end.getDate() - start.getDate()).toBe(1);
      expect(boundaries[index + 1] - boundaries[index]).toBe(
        86400 + (end.getTimezoneOffset() - start.getTimezoneOffset()) * 60,
      );
    }
    if (
      Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Amsterdam"
    ) {
      expect(boundaries[2] - boundaries[1]).toBe(23 * 3600);
    }
  });
});
