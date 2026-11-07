import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import App from "./App";
import type { Snapshot, World } from "./types";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  desktop: true,
  call: api,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));
const world: World = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Mossy Hollow",
  revision: 1,
  component: {
    id: "engine-1",
    engine: "paper",
    minecraft: "1.21.1",
    version: "132",
    javaMajor: 21,
    sha256: "abc",
    bytes: 1024,
    installedAt: 1,
  },
  memoryMb: 4096,
  maxPlayers: 8,
  port: 25565,
  lan: false,
  seed: "",
  difficulty: "normal",
  gamemode: "survival",
  eulaAcceptedAt: 1,
  players: [],
  createdAt: 1,
  lastPlayed: null,
  packNotes: "",
};
let snapshot: Snapshot;
beforeEach(() => {
  snapshot = {
    worlds: [structuredClone(world)],
    components: [structuredClone(world.component)],
    backups: [],
    settings: {
      defaultEngine: "paper",
      memoryMb: 4096,
      reducedMotion: false,
      preventSleep: false,
    },
    session: null,
    provider: {
      linked: false,
      persisted: false,
      agentRegistered: false,
      state: "disconnected",
      endpoints: [],
      error: null,
      claimUrl: null,
    },
    operations: [],
    logs: [],
    dataDir: "/test/enderlink",
    totalMemory: 17179869184,
    warnings: [],
  };
  api.mockReset();
  api.mockImplementation(async (action: string) => {
    if (action === "snapshot") return structuredClone(snapshot);
    if (action === "playtime")
      return {
        worldId: world.id,
        recordedFrom: null,
        days: [],
        players: [],
        observedAt: Date.now() / 1000,
      };
    if (action === "prepareDelete")
      return {
        token: "review-token",
        worldId: world.id,
        revision: 1,
        phrase: "DELETE Mossy Hollow",
        keepBackups: true,
        backupIds: [],
        expiresAt: Date.now() / 1000 + 300,
      };
    if (action === "minecraftVersions") return ["1.21.1"];
    if (action === "versions")
      return [
        {
          ...world.component,
          version: "133",
          url: "https://example.invalid",
          size: 1024,
        },
      ];
    return "operation-id";
  });
});
afterEach(cleanup);
async function dashboard(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Open world →" }));
}
describe("desktop application flows", () => {
  it("requires an exact phrase and sends the backend-issued deletion token", async () => {
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "World settings" }));
    await user.click(screen.getByRole("button", { name: "Delete world…" }));
    const input = await screen.findByRole("textbox", {
      name: "Deletion confirmation phrase",
    });
    await waitFor(() =>
      expect(api.mock.calls.some((c) => c[0] === "prepareDelete")).toBe(true),
    );
    const button = screen.getByRole("button", {
      name: "Delete world",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, "delete Mossy Hollow");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    await user.type(input, "DELETE Mossy Hollow");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("deleteWorld", {
        token: "review-token",
        phrase: "DELETE Mossy Hollow",
      }),
    );
  });
  it("does not prepare a deletion for an active world", async () => {
    snapshot.session = {
      worldId: world.id,
      state: "running",
      pid: 42,
      startedAt: 1,
      memoryBytes: 2048,
      cpuPercent: 2,
      players: [],
      error: null,
    };
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "World settings" }));
    await user.click(screen.getByRole("button", { name: "Delete world…" }));
    expect(
      screen.getByText("Save and stop this world before deleting it."),
    ).toBeTruthy();
    expect(api.mock.calls.some((c) => c[0] === "prepareDelete")).toBe(false);
  });
  it("does not accept the EULA or create a world without explicit consent", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Create world" }),
    );
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "World name" });
    await user.type(name, "Birch");
    const create = within(dialog).getByRole("button", {
      name: "Create world",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(api.mock.calls.some((c) => c[0] === "createWorld")).toBe(false);
    await user.click(
      within(dialog).getByRole("checkbox", { name: /Minecraft EULA/ }),
    );
    expect(create.disabled).toBe(false);
  });
  it("keeps navigation focused on Host and Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Your worlds");
    const nav = within(
      screen.getByRole("navigation", { name: "Main navigation" }),
    );
    expect(nav.queryByRole("button", { name: "Join" })).toBeNull();
    expect(nav.getAllByRole("button")).toHaveLength(2);
    await user.click(nav.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("button", { name: "Refresh versions" }),
    ).toBeTruthy();
    await user.click(nav.getByRole("button", { name: "Host" }));
    expect(await screen.findByText("Your worlds")).toBeTruthy();
  });
  it("engine download never silently updates a world", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Your worlds");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const button = await screen.findByRole("button", {
      name: "Download selected version",
    });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(button);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("install", {
        engine: "paper",
        minecraft: "1.21.1",
        version: "133",
      }),
    );
    expect(api.mock.calls.some((c) => c[0] === "updateWorld")).toBe(false);
  });
  it("shows one setup action for an empty unconfigured host", async () => {
    snapshot.worlds = [];
    snapshot.components = [];
    render(<App />);
    expect(
      (await screen.findAllByRole("button", { name: "Set up hosting" })).length,
    ).toBe(1);
    expect(screen.queryByText("Made for your people")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create world" })).toBeNull();
  });
  it("hides setup prompts once software is installed", async () => {
    snapshot.worlds = [];
    render(<App />);
    expect(
      (await screen.findAllByRole("button", { name: "Create world" })).length,
    ).toBe(1);
    expect(
      screen.queryByRole("button", { name: /Set up hosting|Hosting setup/ }),
    ).toBeNull();
  });
  it("switches the new-world default without converting existing worlds", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Your worlds");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const selector = screen.getByRole("group", {
      name: "Default server software",
    });
    await user.click(within(selector).getByRole("button", { name: "Fabric" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("patchSettings", {
        defaultEngine: "fabric",
      }),
    );
    expect(api.mock.calls.some((c) => c[0] === "updateWorld")).toBe(false);
    expect(
      screen.getByText(/Switching here never converts a world/),
    ).toBeTruthy();
  });
  it("prepares an existing Playit link before any world has been created", async () => {
    snapshot.worlds = [];
    snapshot.components = [];
    snapshot.provider.linked = true;
    snapshot.provider.state = "standby";
    const fallback = api.getMockImplementation()!;
    api.mockImplementation(async (action: string, args: unknown) => {
      if (action === "verifyProvider") {
        snapshot.provider.agentRegistered = true;
        snapshot.providerSetup = { tunnelConfigured: false, checkedAt: 1 };
        return null;
      }
      return fallback(action, args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Your worlds");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByText("Device registered with Playit"),
    ).toBeTruthy();
    expect(screen.getByText(/Click Refresh agents in Playit/)).toBeTruthy();
    expect(screen.getByText(/Playit Network \(Global Anycast\)/)).toBeTruthy();
    expect(screen.queryByText("Minecraft tunnel configured")).toBeNull();
    expect(
      api.mock.calls.some((c) =>
        ["beginLink", "start", "createWorld"].includes(c[0]),
      ),
    ).toBe(false);
  });
  it("distinguishes linked authorization from device registration", async () => {
    snapshot.provider.linked = true;
    snapshot.provider.state = "registering";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Your worlds");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Preparing device")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Registering device…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText("Device registered with Playit")).toBeNull();
    expect(
      screen.getByText(/Wait for this to finish before selecting the agent/),
    ).toBeTruthy();
  });
  it("changes account mode only through the explicit backup action", async () => {
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "World settings" }));
    await user.click(
      screen.getByRole("button", { name: "Change player account mode" }),
    );
    const selector = screen.getByRole("combobox", { name: "Player accounts" });
    expect(selector.getAttribute("data-value")).toBe("verified");
    await user.click(selector);
    await user.click(
      screen.getByRole("option", {
        name: "Offline accounts — unverified usernames",
      }),
    );
    expect(
      screen.getByText(/Anyone can impersonate an allowed username/),
    ).toBeTruthy();
    expect(
      screen.getByText(/separate inventories, ender chests, and progress/),
    ).toBeTruthy();
    expect(api.mock.calls.some((c) => c[0] === "changeAccountMode")).toBe(
      false,
    );
    await user.click(
      screen.getByRole("button", { name: "Back up & use offline accounts" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("changeAccountMode", {
        id: world.id,
        revision: 1,
        onlineMode: false,
      }),
    );
  });
  it("keeps account switching disabled while the world is running", async () => {
    snapshot.session = {
      worldId: world.id,
      state: "running",
      pid: 42,
      startedAt: 1,
      memoryBytes: 0,
      cpuPercent: 0,
      players: [],
      error: null,
    };
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "World settings" }));
    await user.click(
      screen.getByRole("button", { name: "Change player account mode" }),
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Player accounts",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Back up & verify accounts",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Save and stop this world before changing its account mode.",
      ),
    ).toBeTruthy();
    expect(api.mock.calls.some((c) => c[0] === "changeAccountMode")).toBe(
      false,
    );
  });
  it("labels offline access honestly and prevents editing its live whitelist", async () => {
    snapshot.worlds[0].onlineMode = false;
    snapshot.session = {
      worldId: world.id,
      state: "running",
      pid: 42,
      startedAt: 1,
      memoryBytes: 0,
      cpuPercent: 0,
      players: [],
      error: null,
    };
    const user = userEvent.setup();
    await dashboard(user);
    expect(
      screen.getByText(/Offline names · accounts unverified/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Manage access →" }));
    expect(
      screen.getByText(
        /Anyone can impersonate an allowed name in offline mode/,
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Add player" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Save and stop this world before editing its offline player list.",
      ),
    ).toBeTruthy();
    expect(api.mock.calls.some((c) => c[0] === "setPlayer")).toBe(false);
  });
  it("defaults new worlds to verified accounts and sends an explicit offline choice", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Create world" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    const selector = dialog.getByRole("combobox", { name: "Player accounts" });
    expect(selector.getAttribute("data-value")).toBe("verified");
    await user.click(selector);
    await user.click(
      screen.getByRole("option", {
        name: "Offline accounts — unverified usernames",
      }),
    );
    await user.type(
      dialog.getByRole("textbox", { name: "World name" }),
      "Friends",
    );
    await user.click(dialog.getByRole("checkbox", { name: /Minecraft EULA/ }));
    await user.click(dialog.getByRole("button", { name: "Create world" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "createWorld",
        expect.objectContaining({
          onlineMode: false,
          name: "Friends",
          acceptEula: true,
        }),
      ),
    );
  });
  it("creates a chosen block and hardcore rules while keeping commands explicitly opt-in", async () => {
    const fallback = api.getMockImplementation()!;
    api.mockImplementation(async (action: string, args: unknown) =>
      action === "createWorld" ? world : fallback(action, args),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Create world" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    await user.type(
      dialog.getByRole("textbox", { name: "World name" }),
      "Violet expedition",
    );
    await user.click(dialog.getByRole("checkbox", { name: /^Hardcore/ }));
    expect(
      (
        dialog.getByRole("combobox", {
          name: "Default game mode",
        }) as HTMLButtonElement
      ).getAttribute("data-value"),
    ).toBe("survival");
    expect(
      (
        dialog.getByRole("combobox", {
          name: "Difficulty",
        }) as HTMLButtonElement
      ).getAttribute("data-value"),
    ).toBe("hard");
    expect(
      (
        dialog.getByRole("combobox", {
          name: "Difficulty",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(dialog.getByRole("radio", { name: /Amethyst/i }));
    await user.click(dialog.getByRole("checkbox", { name: /Minecraft EULA/ }));
    await user.click(dialog.getByRole("button", { name: "Create world" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "createWorld",
        expect.objectContaining({
          hardcore: true,
          gamemode: "survival",
          difficulty: "hard",
          pvp: true,
          allowCommands: false,
          coverBlock: "amethyst",
        }),
      ),
    );
  });
  it("shows confirmed offline players and fetches local daily history", async () => {
    snapshot.worlds[0].onlineMode = false;
    snapshot.session = {
      worldId: world.id,
      state: "running",
      pid: 42,
      startedAt: 1,
      memoryBytes: 0,
      cpuPercent: 0,
      players: ["Birch", "Moss"],
      playersKnown: true,
      error: null,
    };
    const user = userEvent.setup();
    await dashboard(user);
    expect(screen.getByRole("heading", { name: "Players · 2" })).toBeTruthy();
    expect(screen.getByText("Birch")).toBeTruthy();
    expect(screen.getByText("Moss")).toBeTruthy();
    const request = api.mock.calls.find(([action]) => action === "playtime");
    expect(request?.[1].id).toBe(world.id);
    expect(request?.[1].boundaries).toHaveLength(31);
  });
  it("does not present an unavailable player list as an empty server", async () => {
    snapshot.session = {
      worldId: world.id,
      state: "running",
      pid: 42,
      startedAt: 1,
      memoryBytes: 0,
      cpuPercent: 0,
      players: [],
      playersKnown: false,
      error: null,
    };
    const user = userEvent.setup();
    await dashboard(user);
    expect(screen.getByRole("heading", { name: "Players · —" })).toBeTruthy();
    expect(
      screen.getByText(/Waiting for a confirmed player list/),
    ).toBeTruthy();
    expect(screen.getByText(/unobserved time is not counted/)).toBeTruthy();
  });
  it("grants commands only through an individual player's explicit checkbox", async () => {
    snapshot.worlds[0].allowCommands = true;
    snapshot.worlds[0].players = [
      { uuid: "test-uuid", name: "Birch", operator: false },
    ];
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "Manage access →" }));
    expect(api.mock.calls.some(([action]) => action === "setOperator")).toBe(
      false,
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Allow commands for Birch" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("setOperator", {
        id: world.id,
        uuid: "test-uuid",
        operator: true,
        revision: world.revision,
      }),
    );
  });
  it("reviews a timeline backup before creating a restored world", async () => {
    snapshot.backups = [
      {
        id: "backup-one",
        world: structuredClone(world),
        createdAt: 1700000000,
        bytes: 4096,
        sha256: "checksum",
      },
    ];
    const user = userEvent.setup();
    await dashboard(user);
    await user.click(screen.getByRole("button", { name: "Review restore" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(api.mock.calls.some(([action]) => action === "restore")).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Restore as a new world" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("restore", { id: "backup-one" }),
    );
  });
});
