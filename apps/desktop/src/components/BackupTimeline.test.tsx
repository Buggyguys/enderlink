import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backup } from "../types";
import { BackupTimeline } from "./BackupTimeline";
import {
  chooseTickStep,
  clampRange,
  groupTimelinePoints,
  panRange,
  timePosition,
  timelineDomain,
  timelineTicks,
  zoomRange,
} from "./timelineMath";

afterEach(cleanup);

const created = new Date(2026, 10, 6, 10).getTime() / 1000;
const now = created + 10800;
const backups = [
  {
    id: "older",
    createdAt: created + 3600,
    bytes: 1048576,
    sha256: "a",
    world: { id: "world-one", name: "Our world" },
  },
  {
    id: "newer",
    createdAt: created + 7200,
    bytes: 2097152,
    sha256: "b",
    world: { id: "world-one", name: "Our world" },
  },
] as Backup[];

function rangeOf(element: HTMLElement) {
  return {
    start: Number(element.dataset.rangeStart),
    end: Number(element.dataset.rangeEnd),
  };
}

describe("backup time axis mathematics", () => {
  it("positions backups by elapsed time and keeps zoom anchored at the cursor", () => {
    const domain = { start: 0, end: 10000 };
    expect(timePosition(2500, domain)).toBe(0.25);
    const zoomed = zoomRange(domain, domain, 0.5, 0.25);
    expect(zoomed).toEqual({ start: 1250, end: 6250 });
    expect(timePosition(2500, zoomed)).toBe(0.25);
    expect(zoomRange(zoomed, domain, 100)).toEqual(domain);
    expect(
      zoomRange(domain, domain, 0.00001).end -
        zoomRange(domain, domain, 0.00001).start,
    ).toBe(60);
    expect(panRange(zoomed, domain, -99999)).toEqual({ start: 0, end: 5000 });
    expect(panRange(zoomed, domain, 99999)).toEqual({
      start: 5000,
      end: 10000,
    });
  });

  it("handles a just-created world without inventing a future time span or invalid positions", () => {
    const domain = timelineDomain(now, now);
    expect(domain).toEqual({ start: now, end: now });
    expect(timePosition(now, domain)).toBe(0.5);
    expect(zoomRange(domain, domain, 0.5)).toEqual(domain);
    expect(clampRange({ start: 0, end: 100 }, domain)).toEqual(domain);
    expect(timelineTicks(domain, 700).ticks).toEqual([]);
    expect(timelineDomain(now + 100, now)).toEqual(domain);
  });

  it("chooses minute, hour, week, quarter, half-year and multi-year tick scales", () => {
    expect(chooseTickStep({ start: 0, end: 300 }, 700)).toMatchObject({
      unit: "minute",
      count: 1,
    });
    expect(chooseTickStep({ start: 0, end: 7 * 3600 }, 700)).toMatchObject({
      unit: "hour",
      count: 1,
    });
    expect(chooseTickStep({ start: 0, end: 49 * 86400 }, 700)).toMatchObject({
      unit: "week",
      count: 1,
    });
    expect(chooseTickStep({ start: 0, end: 365 * 86400 }, 450)).toMatchObject({
      unit: "month",
      count: 3,
    });
    expect(chooseTickStep({ start: 0, end: 365 * 86400 }, 350)).toMatchObject({
      unit: "month",
      count: 6,
    });
    expect(
      chooseTickStep({ start: 0, end: 16 * 365.25 * 86400 }, 900),
    ).toMatchObject({ unit: "year", count: 2 });
  });

  it("aligns months and years to calendar edges instead of fixed-day approximations", () => {
    const quarter = timelineTicks(
      {
        start: new Date(2025, 0, 1).getTime() / 1000,
        end: new Date(2026, 0, 1).getTime() / 1000,
      },
      450,
    );
    expect(quarter.step).toMatchObject({ unit: "month", count: 3 });
    const dates = quarter.ticks.map((tick) => new Date(tick.time * 1000));
    expect(dates.map((date) => date.getMonth())).toEqual([0, 3, 6, 9, 0]);
    expect(
      dates.every((date) => date.getDate() === 1 && date.getHours() === 0),
    ).toBe(true);
    const years = timelineTicks(
      {
        start: new Date(2010, 0, 1).getTime() / 1000,
        end: new Date(2026, 0, 1).getTime() / 1000,
      },
      900,
    );
    expect(
      years.ticks.map((tick) => new Date(tick.time * 1000).getFullYear()),
    ).toEqual([2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026]);
    expect(years.ticks.length).toBeLessThan(15);
  });

  it("keeps local midnight ticks correct across daylight saving changes", () => {
    const range = {
      start: new Date(2026, 2, 28).getTime() / 1000,
      end: new Date(2026, 2, 31).getTime() / 1000,
    };
    const { step, ticks } = timelineTicks(range, 400);
    expect(step).toMatchObject({ unit: "day", count: 1 });
    expect(ticks.map((tick) => new Date(tick.time * 1000).getHours())).toEqual([
      0, 0, 0, 0,
    ]);
    for (let index = 1; index < ticks.length; index++) {
      const earlier = new Date(ticks[index - 1].time * 1000);
      const later = new Date(ticks[index].time * 1000);
      expect(ticks[index].time - ticks[index - 1].time).toBe(
        86400 + 60 * (later.getTimezoneOffset() - earlier.getTimezoneOffset()),
      );
    }
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Amsterdam")
      expect(ticks[2].time - ticks[1].time).toBe(23 * 3600);
  });

  it("keeps every tied or nearby backup selectable without merging a whole chain of dots", () => {
    const points = [0, 0, 1, 20, 21, 40, 41, 60, 61, 80, 100].map(
      (createdAt, index) => ({ id: String(index), createdAt }),
    );
    const groups = groupTimelinePoints(points, { start: 0, end: 100 }, 500);
    expect(
      groups
        .flatMap((group) => group.points)
        .map((point) => point.id)
        .sort(),
    ).toEqual(points.map((point) => point.id).sort());
    expect(groups[0].points).toHaveLength(3);
    expect(groups).toHaveLength(6);
    expect(
      groups.every(
        (group) =>
          ((group.points.at(-1)!.createdAt - group.points[0].createdAt) / 100) *
            500 <
          28,
      ),
    ).toBe(true);
    expect(
      groupTimelinePoints(points, { start: 20, end: 40 }, 500)
        .flatMap((group) => group.points)
        .map((point) => point.createdAt),
    ).toEqual([20, 21, 40]);
  });
});

describe("interactive backup timeline", () => {
  it("draws a literal timeline with correctly positioned dots and reviews only after an explicit action", async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    const manage = vi.fn();
    const { container } = render(
      <BackupTimeline
        backups={backups}
        worldCreatedAt={created}
        now={now}
        onManage={manage}
        onRestore={restore}
      />,
    );
    const axis = screen.getByRole("group", { name: "Backup time axis" });
    expect(container.querySelector(".backup-time-line")).toBeTruthy();
    const dots = [...container.querySelectorAll(".backup-time-dot")];
    expect(dots.map((dot) => Number(dot.getAttribute("cx")))).toEqual([
      240, 480,
    ]);
    const targets = within(axis).getAllByRole("button");
    await user.click(targets[0]);
    const picker = screen.getByRole("combobox", {
      name: "Selected backup",
    }) as HTMLButtonElement;
    expect(picker.getAttribute("data-value")).toBe("older");
    expect(picker.textContent).toMatch(/11:00:00/);
    expect(restore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Review restore" }));
    expect(restore).toHaveBeenCalledWith(backups[0]);
    await user.click(screen.getByRole("button", { name: "Manage backups" }));
    expect(manage).toHaveBeenCalledOnce();
  });

  it("zooms, pans with the keyboard, returns to all time and preserves the view on polling updates", async () => {
    const user = userEvent.setup();
    const props = {
      backups,
      worldCreatedAt: created,
      worldId: "world-one",
      now,
      onManage: vi.fn(),
    };
    const { rerender } = render(<BackupTimeline {...props} />);
    const axis = screen.getByRole("group", { name: "Backup time axis" });
    await user.click(screen.getByRole("button", { name: "Zoom in timeline" }));
    const zoomed = rangeOf(axis);
    expect(zoomed.end - zoomed.start).toBe(5400);
    rerender(
      <BackupTimeline {...props} backups={[...backups]} now={now + 30} />,
    );
    expect(rangeOf(axis)).toEqual(zoomed);
    axis.focus();
    await user.keyboard("{Home}");
    expect(rangeOf(axis)).toEqual({ start: created, end: created + 5400 });
    await user.keyboard("{End}");
    expect(rangeOf(axis)).toEqual({ start: now + 30 - 5400, end: now + 30 });
    await user.keyboard("0");
    expect(rangeOf(axis)).toEqual({ start: created, end: now + 30 });
    await user.click(screen.getByRole("button", { name: "Zoom in timeline" }));
    await user.click(
      screen.getByRole("button", { name: "Show entire timeline" }),
    );
    expect(rangeOf(axis)).toEqual({ start: created, end: now + 30 });
  });

  it("does not hijack page scrolling but zooms for a deliberate modifier-wheel gesture", () => {
    render(
      <BackupTimeline
        backups={backups}
        worldCreatedAt={created}
        now={now}
        onManage={vi.fn()}
      />,
    );
    const axis = screen.getByRole("group", { name: "Backup time axis" });
    const plain = new WheelEvent("wheel", {
      deltaY: -100,
      cancelable: true,
      bubbles: true,
    });
    fireEvent(axis, plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(rangeOf(axis)).toEqual({ start: created, end: now });
    const deliberate = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    fireEvent(axis, deliberate);
    expect(deliberate.defaultPrevented).toBe(true);
    const zoomed = rangeOf(axis);
    expect(zoomed.end - zoomed.start).toBeLessThan(now - created);
    expect(zoomed.start).toBeGreaterThanOrEqual(created);
    expect(zoomed.end).toBeLessThanOrEqual(now);
  });

  it("offers each overlapping snapshot individually and never restores by changing selection", async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    const tied = [
      backups[0],
      { ...backups[0], id: "another", bytes: 4000000 },
      backups[1],
    ];
    render(
      <BackupTimeline
        backups={tied}
        worldCreatedAt={created}
        now={now}
        onManage={vi.fn()}
        onRestore={restore}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^2 nearby backups/ }));
    const picker = screen.getByRole("combobox", { name: "Selected backup" });
    await user.click(picker);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await user.click(screen.getByRole("option", { name: /#1/ }));
    expect(picker.getAttribute("data-value")).toBe("another");
    expect(screen.getByText(/2 nearby backups at this zoom/)).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Review restore" }));
    expect(restore).toHaveBeenCalledWith(tied[1]);
  });

  it("keeps an empty world's creation-to-now line and disables restore without fabricating a checkpoint", () => {
    const { container } = render(
      <BackupTimeline
        backups={[]}
        worldCreatedAt={created}
        now={now}
        onManage={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(container.querySelector(".backup-time-line")).toBeTruthy();
    expect(container.querySelectorAll(".backup-time-dot")).toHaveLength(0);
    expect(screen.getByText("No backups yet")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Review restore",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("resets selection and viewport on a different world and respects a restore-in-progress guard", async () => {
    const user = userEvent.setup();
    const props = {
      backups,
      worldCreatedAt: created,
      now,
      onManage: vi.fn(),
      onRestore: vi.fn(),
    };
    const { rerender } = render(<BackupTimeline {...props} worldId="one" />);
    await user.click(screen.getByRole("button", { name: "Zoom in timeline" }));
    rerender(<BackupTimeline {...props} worldId="two" restoreDisabled />);
    expect(
      rangeOf(screen.getByRole("group", { name: "Backup time axis" })),
    ).toEqual({ start: created, end: now });
    expect(
      (
        screen.getByRole("button", {
          name: "Review restore",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("An operation is in progress.")).toBeTruthy();
  });
});
