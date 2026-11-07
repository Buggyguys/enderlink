import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Operation } from "../types";
import { NotificationStack, type ToastMessage } from "./Notifications";

const queued: Operation = {
  id: "download",
  label: "Install Paper",
  status: "running",
  message: "Downloading…",
  progress: 0.4,
  startedAt: 1,
  finishedAt: null,
};
function Harness({
  operations = [],
  messages = [],
  ready = true,
}: {
  operations?: Operation[];
  messages?: ToastMessage[];
  ready?: boolean;
}) {
  const [items, setItems] = useState(messages);
  return (
    <NotificationStack
      operations={operations}
      ready={ready}
      messages={items}
      onDismissMessage={(id) =>
        setItems((current) => current.filter((item) => item.id !== id))
      }
      onCancel={() => {}}
    />
  );
}
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("timed notification stack", () => {
  it("stacks messages and expires each independently after three visible seconds", () => {
    render(
      <StrictMode>
        <Harness
          messages={[
            { id: "one", text: "Address copied", createdAt: 1 },
            { id: "two", text: "Settings saved", createdAt: 2 },
          ]}
        />
      </StrictMode>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(2);
    tick(2999);
    expect(screen.queryByText("Address copied")).not.toBeNull();
    tick(1);
    tick(180);
    expect(screen.queryByText("Address copied")).toBeNull();
    expect(screen.queryByText("Settings saved")).toBeNull();
  });
  it("keeps running work, then expires completion without resurrection on snapshot polling", () => {
    const view = render(<Harness operations={[queued]} />);
    tick(60000);
    expect(screen.queryByText("Downloading…")).not.toBeNull();
    const done = {
      ...queued,
      status: "completed" as const,
      message: "Completed",
      finishedAt: 10,
      progress: 1,
    };
    view.rerender(<Harness operations={[done]} />);
    tick(2000);
    view.rerender(<Harness operations={[{ ...done }]} />);
    tick(1000);
    tick(180);
    expect(screen.queryByText("Completed")).toBeNull();
    view.rerender(<Harness operations={[{ ...done }]} />);
    expect(screen.queryByText("Completed")).toBeNull();
  });
  it("does not replay finished historical operations at startup", () => {
    render(
      <Harness
        operations={[
          {
            ...queued,
            status: "failed",
            message: "Old failure",
            finishedAt: 2,
          },
        ]}
      />,
    );
    expect(screen.queryByText("Old failure")).toBeNull();
  });
  it("waits for a successful initial snapshot before considering finished work new", () => {
    const view = render(<Harness ready={false} />);
    view.rerender(
      <Harness
        ready
        operations={[
          {
            ...queued,
            status: "completed",
            message: "Previous session",
            finishedAt: 2,
          },
        ]}
      />,
    );
    expect(screen.queryByText("Previous session")).toBeNull();
  });
  it("resumes expiry when a focused queued action disappears", () => {
    const view = render(
      <Harness operations={[{ ...queued, status: "queued" }]} />,
    );
    act(() =>
      screen.getByRole("button", { name: "Cancel queued operation" }).focus(),
    );
    view.rerender(<Harness operations={[queued]} />);
    view.rerender(
      <Harness
        operations={[
          {
            ...queued,
            status: "completed",
            message: "Finished after focus",
            finishedAt: 2,
          },
        ]}
      />,
    );
    tick(3000);
    tick(180);
    expect(screen.queryByText("Finished after focus")).toBeNull();
  });
  it("does not expire messages outside the visible stack", () => {
    let observeVisibility: (
      entries: { isIntersecting: boolean; intersectionRatio: number }[],
    ) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof observeVisibility) {
          observeVisibility = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(
      <Harness
        messages={[{ id: "one", text: "Waiting to be seen", createdAt: 1 }]}
      />,
    );
    tick(10000);
    expect(screen.queryByText("Waiting to be seen")).not.toBeNull();
    act(() =>
      observeVisibility([{ isIntersecting: true, intersectionRatio: 1 }]),
    );
    tick(3000);
    tick(180);
    expect(screen.queryByText("Waiting to be seen")).toBeNull();
  });
  it("pauses on hover so a longer message remains readable", () => {
    render(
      <Harness
        messages={[{ id: "one", text: "A message to read", createdAt: 1 }]}
      />,
    );
    const notice = screen.getByRole("status");
    tick(1000);
    fireEvent.mouseEnter(notice);
    tick(10000);
    expect(screen.queryByText("A message to read")).not.toBeNull();
    fireEvent.mouseLeave(notice);
    tick(1999);
    expect(screen.queryByText("A message to read")).not.toBeNull();
    tick(1);
    tick(180);
    expect(screen.queryByText("A message to read")).toBeNull();
  });
  it("pauses on keyboard focus and supports manual dismissal", () => {
    render(
      <Harness messages={[{ id: "one", text: "Copied", createdAt: 1 }]} />,
    );
    const dismiss = screen.getByRole("button", {
      name: "Dismiss notification",
    });
    fireEvent.focus(dismiss);
    tick(6000);
    expect(screen.queryByText("Copied")).not.toBeNull();
    fireEvent.click(dismiss);
    tick(180);
    expect(screen.queryByText("Copied")).toBeNull();
  });
  it("stacks simultaneous operation outcomes and local feedback without replacing either", () => {
    const other = { ...queued, id: "backup", label: "Back up world" };
    const view = render(
      <Harness
        operations={[queued, other]}
        messages={[{ id: "one", text: "Copied", createdAt: 1 }]}
      />,
    );
    view.rerender(
      <Harness
        operations={[
          {
            ...queued,
            status: "completed",
            message: "Installed",
            finishedAt: 5,
          },
          {
            ...other,
            status: "failed",
            message: "Disk is full",
            finishedAt: 5,
          },
        ]}
      />,
    );
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Disk is full");
    expect(screen.getByText("Copied")).toBeTruthy();
    tick(3000);
    tick(180);
    expect(screen.queryByText("Installed")).toBeNull();
    expect(screen.queryByText("Disk is full")).toBeNull();
  });
});
