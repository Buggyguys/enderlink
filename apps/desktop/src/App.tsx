import { Select } from "./components/Select";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Play,
  Square,
  Copy,
  ArrowLeft,
  Plus,
  MoreHorizontal,
  X,
  RefreshCw,
  Terminal,
  Trash2,
  Download,
  ShieldCheck,
  HardDrive,
} from "./components/Icons";
import { call, desktop, label, bytes, date } from "./api";
import type {
  Snapshot,
  World,
  Component,
  Version,
  Engine,
  DeletePlan,
  Backup,
} from "./types";
import { Button, Card, Badge, Field, Feedback, useTask } from "./components/UI";
import { Icon, EnderMark, type IconName } from "./components/Icons";
import { Atmosphere } from "./components/Atmosphere";
import { SettingsPage } from "./components/SettingsPage";
import { MemoryStatus } from "./components/MemoryPanel";
import {
  NotificationStack,
  type ToastMessage,
} from "./components/Notifications";
import { BackupTimeline } from "./components/BackupTimeline";
import {
  ClearAllDataDialog,
  UninstallAppDialog,
  RestoreLibraryDialog,
} from "./components/MaintenanceDialogs";
import { WorldBlock, WorldBlockPicker } from "./components/WorldBlock";
import { GameplayFields, gameplayOf } from "./components/GameplayFields";
import {
  PlaytimeHistory,
  localDayBoundaries,
  type PlaytimeHistoryData,
} from "./components/WorldHistory";
type Run = (action: string, args?: unknown) => Promise<unknown>;
type ModalState = { type: string; id?: string };
const empty: Snapshot = {
  worlds: [],
  components: [],
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
  dataDir: "",
  totalMemory: 0,
  warnings: [],
};
function stateOf(w: World, s: Snapshot) {
  return s.session?.worldId === w.id
    ? s.session.state
    : s.components.some((c) => c.id === w.component.id)
      ? "stopped"
      : "software missing";
}
function Form({
  onSubmit,
  children,
}: {
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(""),
    [route, setRoute] = useState("host"),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState<ModalState | null>(null),
    [modalBusy, setModalBusy] = useState(false),
    [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextMessage = useRef(0);
  const notify = useCallback((text: string) => {
    const message = {
      id: `toast-${++nextMessage.current}`,
      text,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, message].slice(-50));
  }, []);
  const dismissMessage = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);
  const pageScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (pageScroll.current) pageScroll.current.scrollTop = 0;
  }, [route, selected]);
  useLayoutEffect(() => {
    const scroller = pageScroll.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !content) return;
    const update = () => {
      // Only paint a thumb when the page can scroll. The reserved gutter stays
      // the same size, including on older webviews with classic scrollbars.
      const scrollable = String(
        scroller.scrollHeight > scroller.clientHeight + 1,
      );
      if (scroller.dataset.scrollable !== scrollable)
        scroller.dataset.scrollable = scrollable;
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const request = useRef(0),
    alive = useRef(true);
  const refresh = useCallback(async () => {
    const seq = ++request.current;
    try {
      const data = await call<Snapshot>("snapshot");
      if (alive.current && seq === request.current) {
        setSnapshot(data);
        setLoadError("");
        setLoaded(true);
      }
    } catch (e) {
      if (alive.current) {
        setLoadError((e as Error).message);
        setLoaded(true);
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.reduceMotion = String(snapshot.settings.reducedMotion);
    root.dataset.glass = String(snapshot.settings.glass !== false);
    root.dataset.glassOpacity = snapshot.settings.glassOpacity || "clear";
    root.dataset.motionSpeed = snapshot.settings.motionSpeed || "gentle";
  }, [
    snapshot.settings.reducedMotion,
    snapshot.settings.glass,
    snapshot.settings.glassOpacity,
    snapshot.settings.motionSpeed,
  ]);
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.effectsPaused = String(document.hidden);
    };
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const unlisten = listen("confirm-close", async () => {
      if (
        await confirm(
          "Save and stop the running world, then quit? Players will disconnect.",
          { title: "Quit Enderlink", kind: "warning" },
        )
      ) {
        try {
          await invoke("quit");
        } catch (e) {
          notify(String(e));
        }
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  const run: Run = async (action, args = {}) => {
    const result = await call(action, args);
    await refresh();
    return result;
  };
  const fire = async (action: string, args: unknown = {}) => {
    try {
      await run(action, args);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("Minecraft address copied.");
    } catch {
      notify("Clipboard unavailable. Select and copy the address.");
    }
  };
  const w = snapshot.worlds.find((x) => x.id === selected),
    running = !!snapshot.session?.pid;
  const activeOps = snapshot.operations.filter((o) => o.finishedAt === null);
  return (
    <div className="app">
      <Atmosphere settings={snapshot.settings} />
      <header className="topbar">
        <div className="brand">
          <EnderMark />
          <span>
            Ender<span className="brand-accent">link</span>
          </span>
        </div>
        <nav
          className="tabs"
          aria-label="Main navigation"
          style={
            {
              "--nav-index": ["host", "settings"].indexOf(route),
            } as React.CSSProperties
          }
        >
          <span className="nav-selection" aria-hidden="true" />
          {(
            [
              ["host", "Host"],
              ["settings", "Settings"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              className="tab"
              aria-label={text}
              aria-current={route === key ? "page" : undefined}
              onClick={() => {
                setRoute(key);
                if (key === "host") setSelected(null);
              }}
            >
              <span className="nav-symbol">
                <Icon name={key as IconName} />
                <span className="nav-accent">
                  <Icon name={key as IconName} accent />
                </span>
              </span>
              <span className="nav-label">
                {text}
                <span className="nav-accent" aria-hidden="true">
                  {text}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="top-state">
          <i className={`dot ${running ? "green" : ""}`} />
          {running ? "1 world active" : "No active session"}
        </div>
      </header>
      <div
        className="page-scroll"
        ref={pageScroll}
        role="region"
        aria-label="Page content"
        tabIndex={0}
      >
        <div className="page-content">
          <main>
            {loadError && (
              <div className="alert">
                {loadError}{" "}
                {desktop && (
                  <button className="text-btn" onClick={refresh}>
                    Retry
                  </button>
                )}
              </div>
            )}
            {snapshot.warnings.map((text) => (
              <div className="alert" key={text}>
                {text}{" "}
                <Button onClick={() => fire("recoverServer")}>
                  Recover server
                </Button>
              </div>
            ))}
            {!loaded ? (
              <div className="empty">Loading your worlds…</div>
            ) : route === "host" ? (
              w ? (
                <Dashboard
                  w={w}
                  s={snapshot}
                  back={() => setSelected(null)}
                  show={(type, id) => setModal({ type, id: id ?? w.id })}
                  run={fire}
                  copy={copy}
                  busy={activeOps.length > 0}
                />
              ) : (
                <Library
                  s={snapshot}
                  openWorld={setSelected}
                  create={() => setModal({ type: "create" })}
                  settings={() => setRoute("settings")}
                  backups={() => setModal({ type: "backups" })}
                />
              )
            ) : (
              <SettingsPage
                s={snapshot}
                run={run}
                show={setModal}
                notify={notify}
                goHost={() => {
                  setRoute("host");
                  setSelected(null);
                }}
              />
            )}
          </main>
        </div>
      </div>
      <Dialog.Root
        open={!!modal}
        onOpenChange={(value) => {
          if (!value && !modalBusy) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (modalBusy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (modalBusy) event.preventDefault();
            }}
          >
            <ModalContents
              m={modal}
              s={snapshot}
              run={run}
              close={() => setModal(null)}
              show={setModal}
              onBusyChange={setModalBusy}
              onComplete={notify}
              select={(id) => {
                setSelected(id);
                setRoute("host");
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <NotificationStack
        operations={snapshot.operations}
        ready={loaded && !loadError}
        messages={messages}
        onDismissMessage={dismissMessage}
        onCancel={(id) => {
          void fire("cancelOperation", { id });
        }}
      />
    </div>
  );
}
function Library({
  s,
  openWorld,
  create,
  settings,
  backups,
}: {
  s: Snapshot;
  openWorld: (id: string) => void;
  create: () => void;
  settings: () => void;
  backups: () => void;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">A little closer, even worlds apart</div>
          <h1>Your worlds</h1>
          <p className="sub">
            Pick up where you left off, or start somewhere new.
          </p>
        </div>
        <div className="actions">
          <Button onClick={backups}>Backups</Button>
          <Button
            kind="primary"
            onClick={s.components.length ? create : settings}
            disabled={!desktop}
          >
            <Plus size={15} />
            {s.components.length ? "Create world" : "Set up hosting"}
          </Button>
        </div>
      </div>
      {s.worlds.length ? (
        <div className="world-grid">
          {s.worlds.map((w) => (
            <article className="card world-card" key={w.id}>
              <div className={`world-art ${w.coverBlock ? "has-block" : ""}`}>
                <WorldBlock kind={w.coverBlock} seed={w.id} />
                <span className="world-symbol" aria-hidden="true">
                  <Icon name="world" size={29} accent />
                </span>
                <Badge tone={stateOf(w, s) === "running" ? "green" : ""}>
                  {stateOf(w, s)}
                </Badge>
              </div>
              <div className="world-body">
                <h2>{w.name}</h2>
                <p className="world-meta">
                  {label(w.component.engine)} · Minecraft{" "}
                  {w.component.minecraft}
                  <br />
                  Last played: {date(w.lastPlayed)}
                </p>
                <div className="actions">
                  <Button onClick={() => openWorld(w.id)}>Open world →</Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card className="world-empty-card">
          <div className="empty world-empty">
            <div className="empty-orbit" aria-hidden="true">
              <EnderMark size={84} />
              <i />
              <i />
            </div>
            <span className="eyebrow">Your next adventure starts here</span>
            <h2>A world of your own.</h2>
            <p>
              {s.components.length
                ? "Your software is ready. Create your first world with the button above."
                : "Set up your server software, then make a place for you and your friends."}
            </p>
          </div>
        </Card>
      )}
    </>
  );
}
function Dashboard({
  w,
  s,
  back,
  show,
  run,
  copy,
  busy,
}: {
  w: World;
  s: Snapshot;
  back: () => void;
  show: (type: string, id?: string) => void;
  run: (action: string, args?: unknown) => Promise<void>;
  copy: (s: string) => Promise<void>;
  busy: boolean;
}) {
  const session = s.session?.worldId === w.id ? s.session : null,
    active = !!session?.pid,
    installed = s.components.some((c) => c.id === w.component.id),
    state = stateOf(w, s),
    backups = s.backups.filter((b) => b.world.id === w.id),
    address = active ? s.provider.endpoints[0] : undefined;
  const [metric, setMetric] = useState<"memory" | "cpu">("memory"),
    [history, setHistory] = useState<{ mem: number; cpu: number }[]>([]),
    [playtime, setPlaytime] = useState<PlaytimeHistoryData | null>(null),
    [playtimeLoading, setPlaytimeLoading] = useState(true),
    [playtimeError, setPlaytimeError] = useState(""),
    [playtimeRefresh, setPlaytimeRefresh] = useState(0);
  useEffect(() => {
    setPlaytime(null);
  }, [w.id]);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    setPlaytimeLoading(true);
    setPlaytimeError("");
    const refreshPlaytime = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await call<PlaytimeHistoryData>("playtime", {
          id: w.id,
          boundaries: localDayBoundaries(30),
        });
        if (alive) {
          setPlaytime(result);
          setPlaytimeError("");
        }
      } catch (error) {
        if (alive)
          setPlaytimeError(
            error instanceof Error ? error.message : "Could not load playtime.",
          );
      } finally {
        inFlight = false;
        if (alive) setPlaytimeLoading(false);
      }
    };
    void refreshPlaytime();
    const timer = window.setInterval(() => void refreshPlaytime(), 15000);
    document.addEventListener("visibilitychange", refreshPlaytime);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshPlaytime);
    };
  }, [w.id, playtimeRefresh]);
  const playerCount = !active
    ? "0"
    : session?.playersKnown
      ? String(session.players.length)
      : "—";
  const last = useRef(0);
  useEffect(() => {
    setHistory([]);
    last.current = 0;
  }, [w.id]);
  useEffect(() => {
    if (session?.pid && Date.now() - last.current > 1500) {
      last.current = Date.now();
      setHistory((old) =>
        [...old, { mem: session.memoryBytes, cpu: session.cpuPercent }].slice(
          -120,
        ),
      );
    }
  }, [session]);
  const vals = history.map((h) => (metric === "memory" ? h.mem : h.cpu)),
    max = metric === "memory" ? Math.max(w.memoryMb * 1048576, ...vals) : 100,
    points = vals
      .map(
        (v, i) =>
          `${(i / Math.max(1, vals.length - 1)) * 440},${118 - Math.min(1, v / max) * 116}`,
      )
      .join(" ");
  const localAddress = `127.0.0.1:${w.port}`,
    elapsed = session
      ? Math.max(0, Math.floor(Date.now() / 1000 - session.startedAt))
      : 0;
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={13} /> All worlds
      </button>
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 9 }}>
            <Badge
              tone={
                state === "running"
                  ? "green"
                  : state === "failed"
                    ? "amber"
                    : ""
              }
            >
              {state}
            </Badge>
            <span className="small muted">
              {label(w.component.engine)} · {w.component.minecraft}
            </span>
          </div>
          <h1>{w.name}</h1>
          <p className="sub">
            A little corner of the world, just for your people.
          </p>
        </div>
        <div className="actions">
          <Button
            ariaLabel="World settings"
            onClick={() => show("worldSettings")}
          >
            <MoreHorizontal size={16} />
          </Button>
          <Button kind="ghost" onClick={() => show("console")}>
            <Terminal size={14} />
            Console
          </Button>
          {active && (
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => show("restart")}
            >
              Restart
            </Button>
          )}
          <Button
            kind={active ? "" : "primary"}
            disabled={busy || (!active && !!s.session?.pid)}
            onClick={() =>
              active
                ? show("stop")
                : installed
                  ? run("start", { id: w.id })
                  : run("install", {
                      engine: w.component.engine,
                      minecraft: w.component.minecraft,
                      version: w.component.version,
                    })
            }
          >
            {active ? (
              <>
                <Square size={13} />
                Save and stop
              </>
            ) : installed ? (
              <>
                <Play size={13} />
                Start world
              </>
            ) : (
              <>Reinstall software</>
            )}
          </Button>
        </div>
      </div>
      <div
        className="session-feedback"
        role={session?.error ? "alert" : undefined}
      >
        {session?.error}
      </div>
      <div className="stats">
        {[
          [
            "Process memory",
            active ? bytes(session!.memoryBytes) : "—",
            `${w.memoryMb / 1024} GB maximum heap`,
          ],
          [
            "CPU usage",
            active ? `${session!.cpuPercent.toFixed(1)}%` : "—",
            "Share of total CPU capacity",
          ],
          [
            "Players online",
            playerCount,
            active && !session?.playersKnown
              ? "Waiting for the server’s player list"
              : `Up to ${w.maxPlayers} allowed players`,
          ],
          [
            "Session time",
            active
              ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
              : "—",
            "World saved on this computer",
          ],
        ].map(([title, value, sub]) => (
          <div className="card stat" key={title}>
            <div className="stat-label">{title}</div>
            <div className="stat-value">{value}</div>
            <div className="stat-foot">{sub}</div>
          </div>
        ))}
      </div>
      <div className="dashboard">
        <Card
          title="Resource activity"
          className="chart-card wide"
          action={
            <div className="segment">
              {(["memory", "cpu"] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={metric === m}
                  onClick={() => setMetric(m)}
                >
                  {m === "memory" ? "Memory" : "CPU"}
                </button>
              ))}
            </div>
          }
        >
          <div
            className="plot-shell"
            role="img"
            aria-label={`${metric} readings over the recent session`}
          >
            <div className="plot-labels">
              {[1, 2 / 3, 1 / 3, 0].map((r) => (
                <span key={r}>
                  {metric === "memory"
                    ? bytes(max * r)
                    : `${Math.round(r * 100)}%`}
                </span>
              ))}
            </div>
            <div className="plot-content">
              <svg
                className="plot-svg"
                viewBox="0 0 440 120"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {[1, 40, 79, 118].map((y) => (
                  <line
                    className="graph-grid"
                    key={y}
                    x1="0"
                    x2="440"
                    y1={y}
                    y2={y}
                  />
                ))}
                <polyline
                  points={points}
                  fill="none"
                  stroke={`var(--chart-${metric === "memory" ? 1 : 2})`}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {history.length < 2 && (
                <span className="plot-empty">
                  {active
                    ? "Collecting readings…"
                    : "Start this world to see activity"}
                </span>
              )}
              <div className="plot-times">
                <span>Recent session</span>
                <span>Now</span>
              </div>
            </div>
          </div>
          <div className="chart-caption">
            <span>Measured locally · updates every 2 seconds</span>
            <span>
              {metric === "memory"
                ? "Process memory, not Java heap"
                : "CPU utilization"}
            </span>
          </div>
        </Card>
        <Card
          title="Connection"
          action={
            <Badge tone={active && address ? "green" : ""}>
              {active && address
                ? "Address assigned"
                : active
                  ? "Local server"
                  : "Stopped"}
            </Badge>
          }
        >
          <div className="conn-steps">
            <div className="conn-step">
              <span className="muted">Minecraft</span>
              <span>{state}</span>
            </div>
            <div className="conn-step">
              <span className="muted">Playit</span>
              <span>
                {s.provider.state === "agentRunning"
                  ? "Agent running"
                  : s.provider.state}
              </span>
            </div>
          </div>
          <p className="helper">Friends’ public address</p>
          <div className="address" style={{ marginTop: 7 }}>
            <code>
              {address || "Configure Playit or use direct/LAN access"}
            </code>
            <button
              className="copy"
              aria-label="Copy public address"
              disabled={!address}
              onClick={() => address && copy(address)}
            >
              <Copy size={14} />
            </button>
          </div>
          <p className="helper" style={{ marginTop: 13 }}>
            Your local address
          </p>
          <div className="address" style={{ marginTop: 7 }}>
            <code>{localAddress}</code>
            <button
              className="copy"
              aria-label="Copy local address"
              onClick={() => copy(localAddress)}
            >
              <Copy size={14} />
            </button>
          </div>
          <p className="helper" style={{ marginTop: 12 }}>
            An assigned address does not verify remote reachability. Friends
            need matching Minecraft/modpack versions.
          </p>
          {s.provider.error && (
            <p className="helper amber" style={{ marginTop: 9 }}>
              {s.provider.error}
            </p>
          )}
        </Card>
        <Card
          title={`Players · ${playerCount}`}
          action={
            <button className="text-btn" onClick={() => show("access")}>
              Manage access →
            </button>
          }
        >
          <div className="list">
            {active && session?.playersKnown && session.players.length ? (
              session!.players.map((name, i) => (
                <div className="list-row" key={name}>
                  <span className={`avatar ${i % 2 ? "violet" : ""}`}>
                    {name.slice(0, 2)}
                  </span>
                  <div className="grow">
                    <div className="name">{name}</div>
                    <div className="detail">Observed in the server log</div>
                  </div>
                  <i className="dot green" />
                </div>
              ))
            ) : (
              <div className="empty small">
                {active && !session?.playersKnown
                  ? "Waiting for a confirmed player list from Minecraft…"
                  : "No players currently observed online."}
              </div>
            )}
          </div>
          <p className="helper" style={{ marginTop: 15 }}>
            <ShieldCheck size={12} /> Whitelist on ·{" "}
            {w.onlineMode === false
              ? "Offline names · accounts unverified"
              : "Minecraft authentication on"}
          </p>
        </Card>
        <Card title="Recent activity">
          <div className="activity">
            {s.logs
              .slice(-4)
              .reverse()
              .map((line, i) => (
                <div className="event" key={`${i}-${line}`}>
                  <i className="dot muted" />
                  <span style={{ overflowWrap: "anywhere" }}>
                    {line.slice(0, 150)}
                  </span>
                </div>
              ))}
            {!s.logs.length && (
              <p className="helper">
                Server activity appears here once you start a world.
              </p>
            )}
          </div>
          <div style={{ marginTop: 18 }}>
            <Button kind="ghost" onClick={() => show("console")}>
              View console
            </Button>
          </div>
        </Card>
        <Card title="World care">
          <div className="protection">
            <div>
              <h3>{backups.length ? "Backup available" : "No backup yet"}</h3>
              <p className="helper">
                {date(backups.at(-1)?.createdAt || null)}
              </p>
            </div>
            <Button
              disabled={active || busy}
              onClick={() => run("backup", { id: w.id })}
            >
              Back up
            </Button>
          </div>
          <div className="protection">
            <div>
              <h3>Server software</h3>
              <p className="helper">
                {label(w.component.engine)} {w.component.version}
              </p>
            </div>
            <Button onClick={() => show("update")} disabled={active || busy}>
              Updates
            </Button>
          </div>
          <p className="helper" style={{ marginTop: 12 }}>
            Stop the world before backup or update.
          </p>
          <div className="actions" style={{ marginTop: 15 }}>
            <button className="text-btn" onClick={() => show("backups")}>
              Browse backups & restore →
            </button>
          </div>
        </Card>
        {active && <MemoryStatus s={s} className="dashboard-memory" />}
        <PlaytimeHistory
          history={playtime?.worldId === w.id ? playtime : null}
          loading={playtimeLoading}
          error={playtimeError}
          trackingUnavailable={active && !session?.playersKnown}
          onRefresh={() => setPlaytimeRefresh((n) => n + 1)}
        />
        <BackupTimeline
          backups={backups}
          worldCreatedAt={w.createdAt}
          worldId={w.id}
          onManage={() => show("backups")}
          onRestore={(backup) => show("restoreBackup", backup.id)}
          restoreDisabled={busy}
        />
      </div>
    </>
  );
}
function ModalShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <div className="dialog-head">
        <div>
          <Dialog.Title asChild>
            <h2>{title}</h2>
          </Dialog.Title>
          <Dialog.Description asChild>
            <p>{description}</p>
          </Dialog.Description>
        </div>
        <Dialog.Close className="btn icon ghost" aria-label="Close dialog">
          <X size={16} />
        </Dialog.Close>
      </div>
      <div className="dialog-body">{children}</div>
      <div className="dialog-foot">
        {footer || <Dialog.Close className="btn primary">Done</Dialog.Close>}
      </div>
    </>
  );
}
function ModalContents({
  m,
  s,
  run,
  close,
  show,
  select,
  onBusyChange,
  onComplete,
}: {
  m: ModalState | null;
  s: Snapshot;
  run: Run;
  close: () => void;
  show: (m: ModalState) => void;
  select: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
  onComplete: (message: string) => void;
}) {
  if (!m) return null;
  const w = s.worlds.find((w) => w.id === m.id);
  switch (m.type) {
    case "create":
      return <CreateWorld s={s} run={run} close={close} select={select} />;
    case "delete":
      return w ? (
        <DeleteWorld w={w} s={s} run={run} close={close} />
      ) : (
        <ModalShell
          title="World removed"
          description="The operation is recorded below."
        >
          <p className="helper">Kept backups remain available.</p>
        </ModalShell>
      );
    case "update":
      return w ? <UpdateWorld w={w} run={run} close={close} /> : null;
    case "worldSettings":
      return w ? (
        <WorldSettings w={w} s={s} run={run} show={show} close={close} />
      ) : null;
    case "access":
      return w ? <Access w={w} s={s} run={run} /> : null;
    case "accountMode":
      return w ? <AccountMode w={w} s={s} run={run} close={close} /> : null;
    case "console":
      return (
        <ModalShell
          title="Server console"
          description="Recent output from the managed Minecraft process."
        >
          <div className="log-view" role="log" aria-live="off">
            {s.logs.length ? s.logs.join("\n") : "No server output yet."}
          </div>
        </ModalShell>
      );
    case "backups":
      return (
        <Backups s={s} run={run} close={close} show={show} worldId={w?.id} />
      );
    case "restoreBackup": {
      const backup = s.backups.find((backup) => backup.id === m.id);
      return backup ? (
        <RestoreBackup backup={backup} run={run} close={close} />
      ) : null;
    }
    case "uninstall":
      return (
        <Uninstall
          c={s.components.find((c) => c.id === m.id)}
          s={s}
          run={run}
          close={close}
        />
      );
    case "stop":
      return <StopWorld run={run} close={close} />;
    case "disconnect":
      return <Disconnect run={run} close={close} />;
    case "storage":
      return <Storage run={run} show={show} />;
    case "cleanup":
      return <Cleanup s={s} run={run} close={close} />;
    case "clearAllData":
      return (
        <ClearAllDataDialog
          s={s}
          run={run}
          close={close}
          onBusyChange={onBusyChange}
          onComplete={onComplete}
        />
      );
    case "uninstallApp":
      return (
        <UninstallAppDialog
          s={s}
          run={run}
          close={close}
          onBusyChange={onBusyChange}
        />
      );
    case "restoreLibrary":
      return (
        <RestoreLibraryDialog
          s={s}
          run={run}
          close={close}
          onBusyChange={onBusyChange}
          onComplete={onComplete}
        />
      );
    case "deleteBackup":
      return (
        <DeleteBackup
          b={s.backups.find((b) => b.id === m.id)}
          run={run}
          close={close}
        />
      );
    case "restart":
      return <RestartWorld id={m.id!} run={run} close={close} />;
    default:
      return null;
  }
}
function AccountModeSelector({
  online,
  setOnline,
  disabled = false,
}: {
  online: boolean;
  setOnline: (online: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Field label="Player accounts">
        <Select
          aria-label="Player accounts"
          value={online ? "verified" : "offline"}
          disabled={disabled}
          onValueChange={(value) => setOnline(value === "verified")}
          options={[
            {
              value: "verified",
              label: "Verified Minecraft accounts (recommended)",
            },
            {
              value: "offline",
              label: "Offline accounts — unverified usernames",
            },
          ]}
        />
      </Field>
      <div className={`notice account-mode-help ${online ? "" : "warning"}`}>
        {online
          ? "A valid Minecraft Java account is required. Only allowed players can join."
          : "Anyone can impersonate an allowed username, including an operator. Offline names must match the launcher exactly."}
      </div>
    </>
  );
}
function AccountMode({
  w,
  s,
  run,
  close,
}: {
  w: World;
  s: Snapshot;
  run: Run;
  close: () => void;
}) {
  const [online, setOnline] = useState(w.onlineMode !== false);
  const { task, busy, error } = useTask();
  const active = s.session?.worldId === w.id && !!s.session.pid;
  const changed = online !== (w.onlineMode !== false);
  return (
    <ModalShell
      title="Player account mode"
      description={w.name}
      footer={
        <>
          <Button kind="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={busy || active || !changed}
            onClick={() =>
              task(async () => {
                await run("changeAccountMode", {
                  id: w.id,
                  revision: w.revision,
                  onlineMode: online,
                });
                close();
              })
            }
          >
            {online
              ? "Back up & verify accounts"
              : "Back up & use offline accounts"}
          </Button>
        </>
      }
    >
      <AccountModeSelector
        online={online}
        setOnline={setOnline}
        disabled={active || busy}
      />
      <p className="helper" style={{ marginTop: 16 }}>
        Enderlink backs up first. Modes use separate inventories, ender chests,
        and progress; existing player files are kept.
      </p>
      <Feedback error={error}>
        {active
          ? "Save and stop this world before changing its account mode."
          : "Wait for the backup and account change to finish before starting the world."}
      </Feedback>
    </ModalShell>
  );
}
function CreateWorld({
  s,
  run,
  close,
  select,
}: {
  s: Snapshot;
  run: Run;
  close: () => void;
  select: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [component, setComponent] = useState(
      s.components.find((c) => c.engine === s.settings.defaultEngine)?.id ||
        s.components[0]?.id ||
        "",
    ),
    [memory, setMemory] = useState(s.settings.memoryMb),
    [seed, setSeed] = useState(""),
    [gameplay, setGameplay] = useState(gameplayOf()),
    [cover, setCover] = useState<string | null>(null),
    [eula, setEula] = useState(false),
    [online, setOnline] = useState(true),
    [notes, setNotes] = useState("");
  const { task, busy, error } = useTask();
  return (
    <ModalShell
      title="Create your world"
      description="Choose its software and give it a name. You can add players before starting."
      footer={
        <>
          <Button onClick={close} kind="ghost">
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={busy || !component || !eula || !name.trim()}
            onClick={() =>
              task(async () => {
                const w = (await run("createWorld", {
                  name,
                  componentId: component,
                  memoryMb: memory,
                  maxPlayers: 8,
                  port: 25565,
                  lan: false,
                  onlineMode: online,
                  seed,
                  acceptEula: eula,
                  packNotes: notes,
                  ...gameplay,
                  coverBlock: cover,
                })) as World;
                select(w.id);
                close();
              })
            }
          >
            {busy ? "Creating…" : "Create world"}
          </Button>
        </>
      }
    >
      <Field label="World name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          placeholder="Mossy Hollow"
          autoFocus
        />
      </Field>
      <Field label="Installed server software">
        <Select
          aria-label="Installed server software"
          value={component}
          onValueChange={setComponent}
          disabled={busy}
          placeholder="Download Paper or Fabric in Settings first"
          options={s.components.map((c) => ({
            value: c.id,
            label: `${label(c.engine)} · ${c.minecraft} · ${c.version}`,
          }))}
        />
      </Field>
      <div className="field-grid">
        <Field label="This world’s memory limit (MB)">
          <input
            type="number"
            min={1024}
            max={65536}
            step={1024}
            value={memory}
            onChange={(e) => setMemory(+e.target.value)}
          />
        </Field>
        <Field label="Seed (optional)">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            maxLength={128}
            placeholder="A new adventure"
          />
        </Field>
      </div>
      <GameplayFields value={gameplay} onChange={setGameplay} disabled={busy} />
      <WorldBlockPicker value={cover} onChange={setCover} disabled={busy} />
      <Field label="Client modpack instructions (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          placeholder="Pack name, version, and where friends can get it"
        />
      </Field>
      <AccountModeSelector
        online={online}
        setOnline={setOnline}
        disabled={busy}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={eula}
          onChange={(e) => setEula(e.target.checked)}
        />
        <span>
          I have read and agree to the{" "}
          <button
            className="text-btn"
            onClick={() => openUrl("https://www.minecraft.net/en-us/eula")}
          >
            Minecraft EULA ↗
          </button>{" "}
          for this server.
        </span>
      </label>
      <Feedback error={error} />
    </ModalShell>
  );
}
function DeleteWorld({
  w,
  s,
  run,
  close,
}: {
  w: World;
  s: Snapshot;
  run: Run;
  close: () => void;
}) {
  const [keep, setKeep] = useState(true),
    [phrase, setPhrase] = useState(""),
    [plan, setPlan] = useState<DeletePlan | null>(null),
    [planError, setPlanError] = useState("");
  const { task, busy, error } = useTask(),
    active = s.session?.worldId === w.id && !!s.session.pid;
  useEffect(() => {
    if (active) return;
    let alive = true;
    setPlan(null);
    setPlanError("");
    setPhrase("");
    call<DeletePlan>("prepareDelete", { id: w.id, keepBackups: keep })
      .then((p) => {
        if (alive) setPlan(p);
      })
      .catch((e) => {
        if (alive) setPlanError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [w.id, w.revision, keep, active]);
  const count = s.backups.filter((b) => b.world.id === w.id).length;
  return (
    <ModalShell
      title={`Delete ${w.name}?`}
      description="This removes every dimension, build, player inventory, mod, and configuration in this world."
      footer={
        <>
          <Button kind="ghost" onClick={close}>
            Keep world
          </Button>
          <Button
            kind="danger"
            disabled={
              active ||
              busy ||
              !plan ||
              phrase.normalize("NFC") !== plan.phrase.normalize("NFC")
            }
            onClick={() =>
              task(async () => {
                await run("deleteWorld", { token: plan!.token, phrase });
                close();
              })
            }
          >
            Delete world
          </Button>
        </>
      }
    >
      <div className="notice danger">
        Deletion cannot be undone. Other worlds and installed engines are not
        removed.
      </div>
      {active ? (
        <div className="notice warning" style={{ marginTop: 16 }}>
          Save and stop this world before deleting it.
        </div>
      ) : (
        <>
          <label className="check-row" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={keep}
              onChange={(e) => setKeep(e.target.checked)}
            />
            Keep existing backups ({count} available)
          </label>
          {!count && (
            <p className="helper" style={{ marginTop: 10 }}>
              There is no backup to restore. You can cancel and create one
              first.
            </p>
          )}
          <hr className="divider" />
          <Field label="To confirm, type the exact phrase below">
            <span className="phrase">DELETE {w.name}</span>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Deletion confirmation phrase"
            />
          </Field>
        </>
      )}
      <Feedback error={error || planError}>
        {plan
          ? "The backend rechecks this review before removing files."
          : "Preparing a fresh deletion review…"}
      </Feedback>
    </ModalShell>
  );
}
function UpdateWorld({
  w,
  run,
  close,
}: {
  w: World;
  run: Run;
  close: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]),
    [v, setV] = useState(""),
    [loadError, setLoadError] = useState(""),
    { task, busy, error } = useTask();
  useEffect(() => {
    let alive = true;
    call<Version[]>("versions", {
      engine: w.component.engine,
      minecraft: w.component.minecraft,
    })
      .then((v) => {
        if (alive) {
          setVersions(v);
          setV(v[0]?.version || "");
        }
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [w.id]);
  return (
    <ModalShell
      title={`Update ${w.name}`}
      description="A newer engine is applied only to this world, after a complete backup."
      footer={
        <>
          <Button onClick={close} kind="ghost">
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={busy || !v || v === w.component.version}
            onClick={() =>
              task(async () => {
                await run("updateWorld", {
                  id: w.id,
                  version: v,
                  revision: w.revision,
                });
                close();
              })
            }
          >
            Back up & update
          </Button>
        </>
      }
    >
      <div className="summary">
        <div className="summary-row">
          <span>Minecraft</span>
          <span>{w.component.minecraft} (unchanged)</span>
        </div>
        <div className="summary-row">
          <span>Current engine</span>
          <span>
            {label(w.component.engine)} {w.component.version}
          </span>
        </div>
      </div>
      <Field label="Target stable version">
        <Select
          aria-label="Target stable version"
          value={v}
          onValueChange={setV}
          disabled={busy}
          options={versions.map((entry) => ({
            value: entry.version,
            label: entry.version,
          }))}
        />
      </Field>
      <div
        className={`notice ${w.component.engine === "fabric" ? "warning" : ""}`}
      >
        {w.component.engine === "fabric"
          ? "Review your modpack’s loader requirements before proceeding. Changing Fabric Loader does not update mods or prove their compatibility."
          : "This is a build update within the same Minecraft version. Other worlds keep their pinned software."}
      </div>
      <p className="helper" style={{ marginTop: 14 }}>
        If backup fails, the world is not updated. After newer software writes
        world data, recovery uses a complete backup—not just an older JAR.
      </p>
      <Feedback error={error || loadError}>
        {v === w.component.version
          ? "This world already uses the latest listed stable version."
          : "World must be stopped."}
      </Feedback>
    </ModalShell>
  );
}
function WorldSettings({
  w,
  s,
  run,
  show,
  close,
}: {
  w: World;
  s: Snapshot;
  run: Run;
  show: (m: ModalState) => void;
  close: () => void;
}) {
  const [name, setName] = useState(w.name),
    [memory, setMemory] = useState(w.memoryMb),
    [port, setPort] = useState(w.port),
    [max, setMax] = useState(w.maxPlayers),
    [lan, setLan] = useState(w.lan),
    [notes, setNotes] = useState(w.packNotes),
    [gameplay, setGameplay] = useState(() => gameplayOf(w)),
    [cover, setCover] = useState<string | null>(w.coverBlock ?? null),
    { task, busy, error } = useTask();
  const active = s.session?.worldId === w.id && !!s.session.pid;
  const importFiles = (kind: string, archive = false) =>
    task(async () => {
      const path = await open({
        multiple: false,
        directory: kind === "server" && !archive,
        filters:
          kind === "server"
            ? archive
              ? [{ name: "Server ZIP", extensions: ["zip"] }]
              : undefined
            : [{ name: "Java archive", extensions: ["jar"] }],
      });
      if (typeof path === "string") {
        if (
          kind === "server" &&
          !(await confirm(
            "This replaces this world's server files after making a backup. Select a complete server folder or ZIP for the same Minecraft version and loader. Client packs may contain incompatible mods.",
            { title: "Import server files?", kind: "warning" },
          ))
        )
          return;
        await run("importFiles", { id: w.id, path, kind });
      }
    });
  return (
    <ModalShell
      title="World settings"
      description={`${w.name} · ${label(w.component.engine)} ${w.component.minecraft}`}
      footer={
        <>
          <Button onClick={close} kind="ghost">
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={busy || active}
            onClick={() =>
              task(async () => {
                await run("saveWorld", {
                  id: w.id,
                  revision: w.revision,
                  name,
                  memoryMb: memory,
                  port,
                  maxPlayers: max,
                  lan,
                  packNotes: notes,
                  ...gameplay,
                  coverBlock: cover,
                });
                close();
              })
            }
          >
            Save settings
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
        />
      </Field>
      <div className="field-grid">
        <Field label="This world’s memory limit (MB)">
          <input
            type="number"
            min={1024}
            max={65536}
            value={memory}
            onChange={(e) => setMemory(+e.target.value)}
          />
        </Field>
        <Field label="Maximum players">
          <input
            type="number"
            min={1}
            max={100}
            value={max}
            onChange={(e) => setMax(+e.target.value)}
          />
        </Field>
        <Field label="Server port">
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(+e.target.value)}
          />
        </Field>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={lan}
          onChange={(e) => setLan(e.target.checked)}
        />
        Allow LAN/direct connections (bind all network interfaces)
      </label>
      <p className="helper" style={{ margin: "8px 0 16px" }}>
        Remote direct access requires router/firewall configuration. Loopback is
        sufficient when using Playit.
      </p>
      <GameplayFields
        value={gameplay}
        onChange={setGameplay}
        disabled={active || busy}
        hardcoreLocked={w.lastPlayed !== null}
      />
      <WorldBlockPicker
        value={cover}
        onChange={setCover}
        disabled={active || busy}
      />
      <Field label="Client pack instructions">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </Field>
      <div
        className={`notice ${w.onlineMode === false ? "warning" : ""}`}
        style={{ marginBottom: 16 }}
      >
        <p>
          {w.onlineMode === false
            ? "Offline accounts · usernames are not verified"
            : "Verified Minecraft accounts"}
        </p>
        <Button
          kind="ghost"
          onClick={() => show({ type: "accountMode", id: w.id })}
        >
          Change player account mode
        </Button>
      </div>
      <div className="actions">
        <Button
          disabled={active || busy}
          onClick={() =>
            importFiles(w.component.engine === "fabric" ? "mods" : "plugins")
          }
        >
          Add {w.component.engine === "fabric" ? "mod" : "plugin"} JAR
        </Button>
        <Button disabled={active || busy} onClick={() => importFiles("server")}>
          Import server folder
        </Button>
        <Button
          disabled={active || busy}
          onClick={() => importFiles("server", true)}
        >
          Import server ZIP
        </Button>
        <Button
          onClick={() =>
            task(async () => {
              const path = (await run("worldPath", { id: w.id })) as string;
              await revealItemInDir(path);
            })
          }
        >
          Open files
        </Button>
      </div>
      <p className="helper" style={{ marginTop: 12 }}>
        Imports first create a backup. Use trusted compatible files; mods and
        plugins execute Java code.
      </p>
      <Feedback error={error}>
        {active
          ? "Stop the world before changing settings or importing files."
          : ""}
      </Feedback>
      <div className="danger-zone">
        <Button
          kind="danger"
          onClick={() => show({ type: "delete", id: w.id })}
        >
          Delete world…
        </Button>
        {active && (
          <Button
            kind="danger"
            onClick={() => show({ type: "stop", id: w.id })}
          >
            Stop / recovery
          </Button>
        )}
      </div>
    </ModalShell>
  );
}
function Access({ w, s, run }: { w: World; s: Snapshot; run: Run }) {
  const [name, setName] = useState(""),
    { task, busy, error } = useTask();
  const offline = w.onlineMode === false;
  const active = s.session?.worldId === w.id && !!s.session.pid;
  const stopRequired = offline && active;
  return (
    <ModalShell
      title="Allowed players"
      description={
        offline
          ? "These exact launcher names are allowed. Minecraft accounts are not verified."
          : "Only these Minecraft accounts can join. Enderlink does not need to run on their computers."
      }
    >
      <div className={`notice ${offline ? "warning" : ""}`}>
        {offline
          ? "Anyone can impersonate an allowed name in offline mode. Match the launcher's capitalization exactly. For public hosting, use a compatible password-login plugin or mod."
          : "Minecraft authentication and the whitelist enforce access. Allowed players do not automatically receive operator privileges."}
      </div>
      {w.allowCommands && (
        <p className="helper" style={{ marginTop: 12 }}>
          New grants allow gameplay commands. Existing server operators keep
          their permissions. Stop the world to change command access.
          {offline
            ? " Offline names can be impersonated, including names with command access."
            : ""}
        </p>
      )}
      <div className="list" style={{ marginTop: 12 }}>
        {w.players.map((p) => (
          <div className="list-row" key={p.uuid}>
            <div className="avatar">{p.name.slice(0, 2)}</div>
            <div className="grow">
              <div className="name">{p.name}</div>
              {p.operator && (p.operatorLevel ?? 2) > 2 && (
                <div className="detail">Existing server operator</div>
              )}
            </div>
            {w.allowCommands && (
              <label className="player-command-toggle">
                <input
                  type="checkbox"
                  aria-label={`Allow commands for ${p.name}`}
                  checked={!!p.operator}
                  disabled={busy || active}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void task(async () => {
                      await run("setOperator", {
                        id: w.id,
                        uuid: p.uuid,
                        operator: enabled,
                        revision: w.revision,
                      });
                    });
                  }}
                />
                Commands
              </label>
            )}
            <Button
              kind="ghost"
              disabled={busy || stopRequired || (active && !!p.operator)}
              onClick={() =>
                task(async () => {
                  if (
                    await confirm(
                      `Remove ${p.name} from the whitelist and disconnect them if online?`,
                      { title: "Remove player access", kind: "warning" },
                    )
                  )
                    await run("setPlayer", {
                      id: w.id,
                      name: p.name,
                      remove: true,
                    });
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Form
        onSubmit={() =>
          task(async () => {
            await run("setPlayer", { id: w.id, name, remove: false });
            setName("");
          })
        }
      >
        <div className="player-form">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Minecraft username"
            aria-label="Minecraft username"
            minLength={3}
            maxLength={16}
            disabled={busy || stopRequired}
          />
          <Button
            kind="primary"
            type="submit"
            disabled={busy || stopRequired || !name.trim()}
          >
            Add player
          </Button>
        </div>
        <Feedback error={error}>
          {stopRequired
            ? "Save and stop this world before editing its offline player list."
            : offline
              ? "Names use Minecraft's offline identities. No Microsoft account lookup is required."
              : "The account is resolved to its authenticated Minecraft identity."}
        </Feedback>
      </Form>
    </ModalShell>
  );
}
function Uninstall({
  c,
  s,
  run,
  close,
}: {
  c?: Component;
  s: Snapshot;
  run: Run;
  close: () => void;
}) {
  const { task, busy, error } = useTask();
  if (!c)
    return (
      <ModalShell
        title="Software removed"
        description="Worlds and backups remain saved."
      >
        <p className="helper">You can reinstall its exact version later.</p>
      </ModalShell>
    );
  const depend = s.worlds.filter((w) => w.component.id === c.id),
    active = depend.some((w) => s.session?.worldId === w.id && !!s.session.pid);
  return (
    <ModalShell
      title={`Uninstall ${label(c.engine)} ${c.version}?`}
      description="Remove this downloaded engine version. Saved worlds and backups are kept."
      footer={
        <>
          <Button kind="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            kind="danger"
            disabled={busy || active}
            onClick={() =>
              task(async () => {
                await run("uninstall", { id: c.id });
                close();
              })
            }
          >
            Uninstall engine
          </Button>
        </>
      }
    >
      <div className="summary">
        <div className="summary-row">
          <span>Minecraft version</span>
          <span>{c.minecraft}</span>
        </div>
        <div className="summary-row">
          <span>Engine artifact</span>
          <span>{bytes(c.bytes)}</span>
        </div>
        <div className="summary-row">
          <span>Dependent worlds</span>
          <span>{depend.map((w) => w.name).join(", ") || "None"}</span>
        </div>
      </div>
      <div className={`notice ${active ? "warning" : ""}`}>
        {active
          ? "Stop the dependent world before uninstalling."
          : depend.length
            ? "These worlds will need their pinned engine reinstalled before starting."
            : "No saved world currently uses this engine."}{" "}
        Shared Java and generated files in world instances are kept.
      </div>
      <Feedback error={error} />
    </ModalShell>
  );
}
function Backups({
  s,
  run,
  show,
  worldId,
}: {
  s: Snapshot;
  run: Run;
  close: () => void;
  show: (m: ModalState) => void;
  worldId?: string;
}) {
  const { task, busy, error } = useTask();
  const backups = s.backups.filter(
    (backup) => !worldId || backup.world.id === worldId,
  );
  const exportBackup = (b: Backup) =>
    task(async () => {
      const path = await save({
        defaultPath: `${b.world.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-backup.zip`,
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (path) await run("exportBackup", { id: b.id, path });
    });
  return (
    <ModalShell
      title="Your backups"
      description="Complete stopped-world snapshots. Restore creates a new world without overwriting an existing one."
    >
      {backups.length ? (
        <div className="list" style={{ maxHeight: 320 }}>
          {[...backups]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((b) => (
              <div className="list-row" key={b.id}>
                <div className="grow">
                  <div className="name">{b.world.name}</div>
                  <div className="detail">
                    {date(b.createdAt)} · {bytes(b.bytes)} ·{" "}
                    {label(b.world.component.engine)}{" "}
                    {b.world.component.version}
                    {!s.worlds.some((w) => w.id === b.world.id)
                      ? " · world deleted"
                      : ""}
                  </div>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => show({ type: "restoreBackup", id: b.id })}
                >
                  Review restore
                </Button>
                <button className="text-btn" onClick={() => exportBackup(b)}>
                  Export
                </button>
                <Button
                  kind="ghost"
                  ariaLabel={`Delete backup of ${b.world.name}`}
                  onClick={() => show({ type: "deleteBackup", id: b.id })}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
        </div>
      ) : (
        <div className="empty">
          No backups yet. Stop a world, then select Back up.
        </div>
      )}
      <Feedback error={error} />
    </ModalShell>
  );
}
function RestoreBackup({
  backup,
  run,
  close,
}: {
  backup: Backup;
  run: Run;
  close: () => void;
}) {
  const { task, busy, error } = useTask();
  return (
    <ModalShell
      title="Restore this backup?"
      description={`${backup.world.name} · ${date(backup.createdAt)}`}
      footer={
        <>
          <Button kind="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              task(async () => {
                await run("restore", { id: backup.id });
                close();
              })
            }
          >
            {busy ? "Preparing…" : "Restore as a new world"}
          </Button>
        </>
      }
    >
      <div className="notice">
        A new world is created from this snapshot. Your current world stays in
        place.
      </div>
      <p className="helper" style={{ marginTop: 14 }}>
        {label(backup.world.component.engine)} {backup.world.component.version}{" "}
        · Minecraft {backup.world.component.minecraft} · {bytes(backup.bytes)}
      </p>
      <p className="helper" style={{ marginTop: 10 }}>
        The new world keeps the backup’s gameplay settings, files and allowed
        players. Its Enderlink playtime chart starts fresh.
      </p>
      <Feedback error={error} />
    </ModalShell>
  );
}
function StopWorld({ run, close }: { run: Run; close: () => void }) {
  const [force, setForce] = useState(""),
    { task, busy, error } = useTask();
  return (
    <ModalShell
      title="Save and stop"
      description="Players will disconnect. Minecraft finishes saving before its process stops."
      footer={
        <>
          <Button onClick={close} kind="ghost">
            Keep playing
          </Button>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              task(async () => {
                await run("stop");
                close();
              })
            }
          >
            Save and stop
          </Button>
        </>
      }
    >
      <div className="notice">
        Your world and its access list remain on this computer. Friends can join
        again when you restart it.
      </div>
      <details className="danger-zone">
        <summary className="small danger-text">
          Server is stuck: force stop
        </summary>
        <p className="helper" style={{ marginBlock: 12 }}>
          Use only if graceful shutdown failed. Unsaved progress can be lost.
          Type FORCE STOP.
        </p>
        <input
          aria-label="Force stop confirmation"
          value={force}
          onChange={(e) => setForce(e.target.value)}
        />
        <div style={{ marginTop: 12 }}>
          <Button
            kind="danger"
            disabled={force !== "FORCE STOP" || busy}
            onClick={() =>
              task(async () => {
                await run("forceStop", { confirmation: force });
                close();
              })
            }
          >
            Force stop
          </Button>
        </div>
      </details>
      <Feedback error={error} />
    </ModalShell>
  );
}
function Disconnect({ run, close }: { run: Run; close: () => void }) {
  const { task, busy, error } = useTask();
  return (
    <ModalShell
      title="Disconnect Playit?"
      description="The tunnel stops and local authorization is removed. The provider account itself is not deleted."
      footer={
        <>
          <Button onClick={close}>Keep connection</Button>
          <Button
            kind="danger"
            disabled={busy}
            onClick={() =>
              task(async () => {
                await run("disconnectProvider");
                close();
              })
            }
          >
            Disconnect
          </Button>
        </>
      }
    >
      <p className="helper">
        Minecraft continues running locally. Remote players using the tunnel
        will disconnect. You can link a provider account again later.
      </p>
      <Feedback error={error} />
    </ModalShell>
  );
}
function Storage({ run, show }: { run: Run; show: (m: ModalState) => void }) {
  const [data, setData] = useState<Record<string, number> | null>(null),
    { task, busy, error } = useTask();
  useEffect(() => {
    task(async () => setData(await call("storage")));
  }, []);
  return (
    <ModalShell
      title="Managed storage"
      description="Worlds, backups, software, and Java are tracked separately."
    >
      {data ? (
        <div className="summary">
          {Object.entries(data).map(([key, n]) => (
            <div className="summary-row" key={key}>
              <span>{key}</span>
              <span>{bytes(n)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="helper">Measuring storage…</p>
      )}
      <Button
        disabled={busy}
        onClick={() =>
          task(async () => {
            await run("cleanCache");
            setData(await call("storage"));
          })
        }
      >
        Remove download staging files
      </Button>
      <p className="helper" style={{ marginTop: 16 }}>
        Uninstall engine versions in Settings. Delete a world from its settings
        with its exact name confirmation. Kept backups remain available here.
      </p>
      <div className="danger-zone">
        <Button kind="danger" onClick={() => show({ type: "cleanup" })}>
          Remove managed data…
        </Button>
      </div>
      <Feedback error={error} />
    </ModalShell>
  );
}

function DeleteBackup({
  b,
  run,
  close,
}: {
  b: Backup | undefined;
  run: Run;
  close: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const { task, busy, error } = useTask();
  if (!b)
    return (
      <ModalShell
        title="Backup removed"
        description="The saved archive is no longer in managed storage."
      >
        <p className="helper">Other worlds and backups remain available.</p>
      </ModalShell>
    );
  const expected = `DELETE BACKUP ${b.world.name}`;
  return (
    <ModalShell
      title="Delete this backup?"
      description={`${b.world.name} · ${date(b.createdAt)} · ${bytes(b.bytes)}. This archive cannot be restored after deletion.`}
      footer={
        <>
          <Button onClick={close}>Keep backup</Button>
          <Button
            kind="danger"
            disabled={busy || phrase !== expected}
            onClick={() =>
              task(async () => {
                await run("deleteBackup", { id: b.id, phrase });
                close();
              })
            }
          >
            Delete backup
          </Button>
        </>
      }
    >
      <Field label={`Type ${expected}`}>
        <input
          aria-label="Backup deletion confirmation"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </Field>
      <Feedback error={error} />
    </ModalShell>
  );
}
function Cleanup({
  s,
  run,
  close,
}: {
  s: Snapshot;
  run: Run;
  close: () => void;
}) {
  const [keepWorlds, setKeepWorlds] = useState(true),
    [keepBackups, setKeepBackups] = useState(true),
    [phrase, setPhrase] = useState("");
  const { task, busy, error } = useTask();
  const active =
    !!s.session?.pid || s.warnings.some((w) => w.includes("server survived"));
  return (
    <ModalShell
      title="Remove managed data"
      description="Prepare for a fresh setup or uninstall. This removes all downloaded engines, managed Java, cached files, and Playit authorization."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            kind="danger"
            disabled={active || busy || phrase !== "REMOVE ENDERLINK DATA"}
            onClick={() =>
              task(async () => {
                await run("removeManagedData", {
                  phrase,
                  worldIds: s.worlds.map((w) => w.id),
                  backupIds: s.backups.map((b) => b.id),
                  keepWorlds,
                  keepBackups,
                });
                close();
              })
            }
          >
            Remove selected data
          </Button>
        </>
      }
    >
      <div className="summary">
        <div className="summary-row">
          <span>Downloaded engines</span>
          <strong>{s.components.length} removed</strong>
        </div>
        <div className="summary-row">
          <span>Worlds</span>
          <strong>
            {s.worlds.length} {keepWorlds ? "kept" : "permanently deleted"}
          </strong>
        </div>
        <div className="summary-row">
          <span>Backups</span>
          <strong>
            {s.backups.length} {keepBackups ? "kept" : "permanently deleted"}
          </strong>
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={keepWorlds}
          onChange={(e) => {
            setKeepWorlds(e.target.checked);
            setPhrase("");
          }}
        />
        Keep my worlds
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={keepBackups}
          onChange={(e) => {
            setKeepBackups(e.target.checked);
            setPhrase("");
          }}
        />
        Keep my backups
      </label>
      <p className="helper">
        Kept worlds need their software reinstalled before starting. Export
        anything you want to keep outside Enderlink first. The app and its small
        settings database remain until you uninstall the application.
      </p>
      <Field label="Type REMOVE ENDERLINK DATA">
        <input
          aria-label="Managed data removal confirmation"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </Field>
      <Feedback
        error={active ? "Stop the server before removing managed data." : error}
      />
    </ModalShell>
  );
}
function RestartWorld({
  id,
  run,
  close,
}: {
  id: string;
  run: Run;
  close: () => void;
}) {
  const { task, busy, error } = useTask();
  return (
    <ModalShell
      title="Save and restart?"
      description="Players disconnect while Minecraft saves and restarts. They can reconnect when the world is ready."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              task(async () => {
                await run("restart", { id });
                close();
              })
            }
          >
            Save and restart
          </Button>
        </>
      }
    >
      <p className="helper">
        The same world, engine version, and player list will be used.
      </p>
      <Feedback error={error} />
    </ModalShell>
  );
}
