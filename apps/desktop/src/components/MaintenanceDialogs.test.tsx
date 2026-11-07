import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Dialog from "@radix-ui/react-dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Snapshot } from "../types";
import {
  ClearAllDataDialog,
  RestoreLibraryDialog,
  UninstallAppDialog,
  type MaintenancePlan,
} from "./MaintenanceDialogs";

const { api, native, chooseDirectory, joinPath } = vi.hoisted(() => ({
  api: vi.fn(),
  native: vi.fn(),
  chooseDirectory: vi.fn(),
  joinPath: vi.fn(),
}));
vi.mock("../api", async (original) => ({
  ...(await original<object>()),
  call: api,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: chooseDirectory }));
vi.mock("@tauri-apps/api/path", () => ({ join: joinPath }));

let plan: MaintenancePlan;
let info: {
  supported: boolean;
  applicationPath: string | null;
  description: string;
  manualCommand?: string;
};
function snapshot(): Snapshot {
  return {
    worlds: [{ id: "world-a", revision: 1 }],
    backups: [{ id: "backup-a" }],
    components: [{ id: "component-a" }],
    session: null,
    operations: [],
    warnings: [],
  } as unknown as Snapshot;
}
function wrapper(children: ReactNode) {
  return (
    <Dialog.Root open>
      <Dialog.Content>{children}</Dialog.Content>
    </Dialog.Root>
  );
}
function renderDialog(children: ReactNode) {
  return render(wrapper(children));
}
const waitForReview = () =>
  waitFor(() => {
    expect(
      (
        screen.getByRole("textbox", {
          name: "Confirmation phrase",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });
const submitButton = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
beforeEach(() => {
  vi.clearAllMocks();
  plan = {
    token: "review-one",
    worlds: 1,
    backups: 1,
    components: 1,
    bytes: 1048576,
    hasLibrary: true,
  };
  info = {
    supported: true,
    applicationPath: "/Applications/Enderlink.app",
    description: "Enderlink will close before its app is removed.",
  };
  api.mockImplementation(async (action: string) => {
    if (action === "maintenancePlan") return { ...plan };
    return null;
  });
  native.mockImplementation(async (command: string) =>
    command === "uninstall_info" ? { ...info } : null,
  );
  chooseDirectory.mockResolvedValue(null);
  joinPath.mockImplementation(async (...parts: string[]) => parts.join("/"));
});
afterEach(cleanup);

describe("clear all data review", () => {
  it("requires the exact phrase and sends the reviewed token; cancellation stays disabled while clearing", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn(),
      onComplete = vi.fn(),
      onBusyChange = vi.fn();
    renderDialog(
      <ClearAllDataDialog
        s={snapshot()}
        run={run}
        close={close}
        onComplete={onComplete}
        onBusyChange={onBusyChange}
      />,
    );
    await waitForReview();
    expect(run).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "Confirmation phrase" });
    await user.type(input, "clear enderlink data");
    expect(submitButton("Clear all data").disabled).toBe(true);
    await user.clear(input);
    await user.type(input, "CLEAR ENDERLINK DATA");
    await user.click(submitButton("Clear all data"));
    expect(run).toHaveBeenCalledExactlyOnceWith("resetAllData", {
      token: "review-one",
      phrase: "CLEAR ENDERLINK DATA",
    });
    expect(submitButton("Cancel").disabled).toBe(true);
    expect(submitButton("Close dialog").disabled).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(close).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("requires a new confirmation after the reviewed world library changes", async () => {
    const user = userEvent.setup(),
      run = vi.fn(),
      close = vi.fn();
    const s = snapshot();
    const view = renderDialog(
      <ClearAllDataDialog s={s} run={run} close={close} />,
    );
    await waitForReview();
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "CLEAR ENDERLINK DATA",
    );
    plan = { ...plan, token: "review-two", worlds: 2 };
    const next = {
      ...s,
      worlds: [...s.worlds, { ...s.worlds[0], id: "world-b" }],
    };
    view.rerender(
      wrapper(<ClearAllDataDialog s={next} run={run} close={close} />),
    );
    await waitForReview();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Confirmation phrase",
          }) as HTMLInputElement
        ).value,
      ).toBe(""),
    );
    expect(submitButton("Clear all data").disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "CLEAR ENDERLINK DATA",
    );
    await user.click(submitButton("Clear all data"));
    expect(run).toHaveBeenCalledWith("resetAllData", {
      token: "review-two",
      phrase: "CLEAR ENDERLINK DATA",
    });
  });

  it.each(["running", "orphan", "queued"])(
    "blocks a destructive review while a %s operation or server remains",
    async (kind) => {
      const s = snapshot();
      if (kind === "running") s.session = { pid: 42 } as Snapshot["session"];
      if (kind === "orphan")
        s.warnings = ["A server survived an earlier Enderlink session"];
      if (kind === "queued")
        s.operations = [
          { id: "op", finishedAt: null },
        ] as Snapshot["operations"];
      const run = vi.fn();
      renderDialog(<ClearAllDataDialog s={s} run={run} close={vi.fn()} />);
      expect(submitButton("Clear all data").disabled).toBe(true);
      expect(screen.getByRole("alert").textContent).toMatch(
        /stop the server|operations to finish/,
      );
      expect(api).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("keeps a failed reset visible without claiming success or immediately retrying", async () => {
    const user = userEvent.setup();
    const run = vi
      .fn()
      .mockRejectedValue(new Error("Unlock your credential store and retry."));
    const close = vi.fn(),
      onComplete = vi.fn();
    renderDialog(
      <ClearAllDataDialog
        s={snapshot()}
        run={run}
        close={close}
        onComplete={onComplete}
      />,
    );
    await waitForReview();
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "CLEAR ENDERLINK DATA",
    );
    await user.click(submitButton("Clear all data"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unlock your credential store",
    );
    expect(close).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(submitButton("Clear all data").disabled).toBe(true);
  });

  it("cannot clear anything when reviewing inventory fails", async () => {
    const user = userEvent.setup(),
      run = vi.fn();
    api.mockRejectedValueOnce(new Error("Could not inspect local storage"));
    renderDialog(
      <ClearAllDataDialog s={snapshot()} run={run} close={vi.fn()} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not inspect",
    );
    expect(submitButton("Clear all data").disabled).toBe(true);
    await user.click(submitButton("Review again"));
    await waitForReview();
    expect(submitButton("Clear all data").disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("uninstall review", () => {
  it("defaults to preserving a nonempty library and submits a new destination only on final confirmation", async () => {
    const user = userEvent.setup(),
      close = vi.fn(),
      onBusyChange = vi.fn();
    renderDialog(
      <UninstallAppDialog
        s={snapshot()}
        run={vi.fn()}
        close={close}
        onBusyChange={onBusyChange}
      />,
    );
    await waitForReview();
    expect(
      (
        screen.getByRole("radio", {
          name: /Save to a folder/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "UNINSTALL ENDERLINK",
    );
    expect(submitButton("Save & uninstall").disabled).toBe(true);
    await user.click(submitButton("Choose folder"));
    expect(submitButton("Save & uninstall").disabled).toBe(true);
    chooseDirectory.mockResolvedValueOnce("/Users/test/Saved games");
    await user.click(submitButton("Choose folder"));
    const destination = (
      screen.getByRole("textbox", {
        name: "New folder for saved worlds",
      }) as HTMLInputElement
    ).value;
    expect(destination).toMatch(
      /^\/Users\/test\/Saved games\/Enderlink saved worlds /,
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Confirmation phrase",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      native.mock.calls.some(([command]) => command === "uninstall_app"),
    ).toBe(false);
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "UNINSTALL ENDERLINK",
    );
    await user.click(submitButton("Save & uninstall"));
    expect(native).toHaveBeenCalledWith("uninstall_app", {
      token: "review-one",
      phrase: "UNINSTALL ENDERLINK",
      saveTo: destination,
    });
    expect(close).not.toHaveBeenCalled();
    expect(submitButton("Cancel").disabled).toBe(true);
    expect(submitButton("Closing Enderlink…").disabled).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
  });

  it("skips the preservation question after the library was already cleared", async () => {
    const user = userEvent.setup();
    plan = { ...plan, worlds: 0, backups: 0, components: 0, hasLibrary: false };
    renderDialog(
      <UninstallAppDialog
        s={{ ...snapshot(), worlds: [], backups: [], components: [] }}
        run={vi.fn()}
        close={vi.fn()}
      />,
    );
    await waitForReview();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose folder" })).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "UNINSTALL ENDERLINK",
    );
    await user.click(submitButton("Uninstall Enderlink"));
    expect(native).toHaveBeenCalledWith("uninstall_app", {
      token: "review-one",
      phrase: "UNINSTALL ENDERLINK",
      saveTo: null,
    });
  });

  it("invalidates confirmation when choosing permanent deletion instead of saving", async () => {
    const user = userEvent.setup();
    renderDialog(
      <UninstallAppDialog s={snapshot()} run={vi.fn()} close={vi.fn()} />,
    );
    await waitForReview();
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "UNINSTALL ENDERLINK",
    );
    await user.click(screen.getByRole("radio", { name: /Delete everything/ }));
    expect(submitButton("Uninstall Enderlink").disabled).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "Confirmation phrase" }),
      "UNINSTALL ENDERLINK",
    );
    await user.click(submitButton("Uninstall Enderlink"));
    expect(native).toHaveBeenCalledWith("uninstall_app", {
      token: "review-one",
      phrase: "UNINSTALL ENDERLINK",
      saveTo: null,
    });
  });

  it("never removes data when native uninstallation is unsupported", async () => {
    info = {
      supported: false,
      applicationPath: null,
      description: "Remove this package with your package manager.",
      manualCommand: "sudo pacman -R enderlink",
    };
    const run = vi.fn();
    renderDialog(
      <UninstallAppDialog s={snapshot()} run={run} close={vi.fn()} />,
    );
    expect(await screen.findByText("sudo pacman -R enderlink")).toBeTruthy();
    expect(submitButton("Save & uninstall").disabled).toBe(true);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Confirmation phrase",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(
      native.mock.calls.some(([command]) => command === "uninstall_app"),
    ).toBe(false);
  });
});

describe("restore a preserved library", () => {
  it("requires a folder and an empty current library before restoring", async () => {
    const user = userEvent.setup(),
      run = vi.fn(),
      close = vi.fn(),
      onComplete = vi.fn();
    const empty = { ...snapshot(), worlds: [], backups: [] };
    const view = renderDialog(
      <RestoreLibraryDialog
        s={snapshot()}
        run={run}
        close={close}
        onComplete={onComplete}
      />,
    );
    expect(submitButton("Restore saved library").disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("empty library");
    view.rerender(
      wrapper(
        <RestoreLibraryDialog
          s={empty}
          run={run}
          close={close}
          onComplete={onComplete}
        />,
      ),
    );
    expect(submitButton("Restore saved library").disabled).toBe(true);
    chooseDirectory.mockResolvedValueOnce("/Users/test/Enderlink saved worlds");
    await user.click(submitButton("Choose folder"));
    expect(run).not.toHaveBeenCalled();
    await user.click(submitButton("Restore saved library"));
    expect(run).toHaveBeenCalledExactlyOnceWith("restoreLibrary", {
      path: "/Users/test/Enderlink saved worlds",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
