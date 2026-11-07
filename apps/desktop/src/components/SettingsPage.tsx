import { Select } from "./Select";
import { useEffect, useState, type ReactNode } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { call, desktop, bytes, date, label } from "../api";
import type { Snapshot, Settings, Engine, Version } from "../types";
import { Button, Card, Badge, Field, Feedback, useTask } from "./UI";
import { Icon } from "./Icons";
import { MemorySettings } from "./MemoryPanel";
type Props = {
  s: Snapshot;
  run: (action: string, args?: unknown) => Promise<unknown>;
  show: (m: { type: string; id?: string }) => void;
  notify: (text: string) => void;
  goHost: () => void;
};
function Brand({
  name,
  size = 32,
}: {
  name: Engine | "playit";
  size?: number;
}) {
  return (
    <img
      className={`software-logo ${name}`}
      src={`/brands/${name}.${name === "paper" ? "svg" : "png"}`}
      width={size}
      height={size}
      alt=""
    />
  );
}
function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="setting-row toggle-row">
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}
export function SettingsPage({ s, run, show, notify, goHost }: Props) {
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [engine, setEngine] = useState<Engine>(s.settings.defaultEngine),
    [games, setGames] = useState<string[]>([]),
    [game, setGame] = useState(""),
    [versions, setVersions] = useState<Version[]>([]),
    [version, setVersion] = useState(""),
    [catalogError, setCatalogError] = useState(""),
    [catalogCheckedAt, setCatalogCheckedAt] = useState<Date | null>(null),
    [loading, setLoading] = useState(false),
    [remember, setRemember] = useState(true),
    [checking, setChecking] = useState(false),
    [checkingProvider, setCheckingProvider] = useState(false),
    [checkError, setCheckError] = useState("");
  const { task, busy, error } = useTask();
  const signature = s.components
    .map((c) => c.id)
    .sort()
    .join(",");
  const checkUpdates = async (force = false) => {
    setChecking(true);
    setCheckError("");
    try {
      await run("checkUpdates", { force });
    } catch (e) {
      setCheckError(String(e));
    } finally {
      setChecking(false);
    }
  };
  const verifyProvider = async () => {
    setCheckingProvider(true);
    try {
      await run("verifyProvider");
    } catch {
      /* Backend snapshot provides the recovery message. */
    } finally {
      setCheckingProvider(false);
    }
  };
  useEffect(() => {
    checkUpdates();
    const timer = setInterval(() => {
      if (!document.hidden) checkUpdates();
    }, 900000);
    return () => clearInterval(timer);
  }, [signature]);
  useEffect(() => {
    if (s.provider.linked) verifyProvider();
  }, [s.provider.linked]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCatalogError("");
    setCatalogCheckedAt(null);
    setGames([]);
    setGame("");
    setVersions([]);
    setVersion("");
    call<string[]>("minecraftVersions", { engine })
      .then((g) => {
        if (alive) {
          setGames(g);
          const existing = s.components.find(
            (c) => c.engine === engine,
          )?.minecraft;
          setGame(existing && g.includes(existing) ? existing : g[0] || "");
        }
      })
      .catch((e) => {
        if (alive) setCatalogError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [engine, catalogRevision]);
  useEffect(() => {
    if (!game) return;
    let alive = true;
    setLoading(true);
    setCatalogError("");
    setVersions([]);
    setVersion("");
    call<Version[]>("versions", { engine, minecraft: game })
      .then((v) => {
        if (alive) {
          setVersions(v);
          setVersion(v[0]?.version || "");
          setCatalogCheckedAt(new Date());
        }
      })
      .catch((e) => {
        if (alive) setCatalogError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [engine, game, catalogRevision]);
  const setting = (patch: Partial<Settings>) =>
    task(async () => {
      await run("patchSettings", patch);
    });
  const installed = s.components.filter((c) => c.engine === engine),
    picked = versions.find((v) => v.version === version),
    exists = installed.some(
      (c) => c.minecraft === game && c.version === version,
    );
  const updates = s.softwareUpdates || [];
  const needsUpdate = updates.some(
    (u) =>
      u.status === "updateAvailable" &&
      (() => {
        const c = s.components.find((c) => c.id === u.componentId);
        return (
          c &&
          (s.worlds.some((w) => w.component.id === c.id) ||
            !s.components.some(
              (n) =>
                n.engine === c.engine &&
                n.minecraft === c.minecraft &&
                n.version === u.latest,
            ))
        );
      })(),
  );
  const softwareReady = s.components.some(
    (c) => c.engine === s.settings.defaultEngine,
  );
  const softwareUnknown =
    updates.some((u) => u.status === "unavailable") || !!checkError;
  const worldReady = s.worlds.some(
    (w) =>
      w.players.length > 0 &&
      w.eulaAcceptedAt > 0 &&
      s.components.some((c) => c.id === w.component.id),
  );
  const tunnelReady =
    s.provider.linked &&
    (s.providerSetup?.tunnelConfigured || !!s.provider.endpoints.length);
  const registering = s.provider.state === "registering";
  const loadingAuthorization = s.provider.state === "loadingAuthorization";
  const agentReady = s.provider.agentRegistered;
  const providerAttention = !!s.provider.error;
  const steps = [
    {
      name: "Server software",
      desc: needsUpdate
        ? "An update is available"
        : softwareUnknown
          ? "Update check unavailable"
          : softwareReady
            ? `${label(s.settings.defaultEngine)} is installed`
            : `Install ${label(s.settings.defaultEngine)}`,
      done: softwareReady && !needsUpdate && !softwareUnknown,
      attention: needsUpdate || softwareUnknown,
      icon: "storage" as const,
      target: "software",
    },
    {
      name: "Your connection",
      desc: registering
        ? "Registering this device…"
        : providerAttention
          ? "Connection needs attention"
          : s.provider.linked && agentReady
            ? "Device registered with Playit"
            : s.provider.linked
              ? "Prepare this device"
              : "Link your free Playit account",
      done: s.provider.linked && agentReady && !providerAttention,
      attention: providerAttention,
      icon: "join" as const,
      target: "provider",
    },
    {
      name: "Public tunnel",
      desc: tunnelReady
        ? "Minecraft tunnel configured"
        : checkingProvider
          ? "Checking your tunnel…"
          : "Add a Minecraft Java tunnel",
      done: !!tunnelReady,
      attention: false,
      icon: "shield" as const,
      target: "provider",
    },
    {
      name: "First world",
      desc: worldReady
        ? "World and access list ready"
        : "Create a world & allow players",
      done: worldReady,
      attention: false,
      icon: "world" as const,
      target: "world",
    },
  ];
  const complete = steps.filter((s) => s.done).length;
  const jump = (target: string) => {
    if (target === "world") goHost();
    else
      document
        .getElementById(target)
        ?.scrollIntoView({ block: "start", behavior: "auto" });
  };
  const lightweight =
    s.settings.reducedMotion &&
    s.settings.glass === false &&
    s.settings.stars === false;
  return (
    <div className="settings-page">
      <div className="page-head centered-head">
        <div>
          <div className="eyebrow">Your corner of the End</div>
          <h1>Make it yours.</h1>
          <p className="sub">A little setup. A lot of possibility.</p>
        </div>
      </div>
      <div className="settings">
        <Card className={`setup-card ${complete === 4 ? "complete" : ""}`}>
          <div className="setup-heading">
            <div>
              <div className="eyebrow">Hosting setup</div>
              <h2>
                {complete === 4
                  ? "All good. Your next adventure is ready."
                  : steps.some((s) => s.attention)
                    ? "A little attention, then you’re ready."
                    : "A few steps to your own world."}
              </h2>
              <p className="helper">
                {complete === 4
                  ? "Your configuration is ready. Start a world whenever you want to play."
                  : "Your progress stays here. We’ll flag updates or changes that need a look."}
              </p>
            </div>
            <span className="setup-count">
              {complete === 4 ? (
                <Icon name="check" size={24} />
              ) : (
                <>
                  {complete}
                  <small>/ 4</small>
                </>
              )}
            </span>
          </div>
          <div className="setup-track">
            <span style={{ width: `${complete * 25}%` }} />
          </div>
          <div className="setup-steps">
            {steps.map((step, i) => (
              <button
                key={step.name}
                className={`setup-step ${step.done ? "done" : step.attention ? "attention" : ""}`}
                onClick={() => jump(step.target)}
              >
                <span className="step-num">
                  {step.done ? (
                    <Icon name="check" size={16} />
                  ) : (
                    <Icon name={step.icon} size={18} />
                  )}
                </span>
                <span className="step-index">0{i + 1}</span>
                <strong>{step.name}</strong>
                <span>{step.desc}</span>
              </button>
            ))}
          </div>
          <span className="setup-footnote">
            {checking
              ? "Checking installed versions…"
              : s.providerSetup?.checkedAt
                ? `Tunnel last checked ${date(s.providerSetup.checkedAt)}. Live reachability is shown when hosting.`
                : "Configuration checks do not prove that a remote player can connect."}
          </span>
        </Card>
        <div id="software" className="settings-anchor">
          <Card
            title="Server software"
            action={
              <span className="small muted">Managed inside Enderlink</span>
            }
          >
            <div
              className="engine-switch"
              role="group"
              aria-label="Default server software"
            >
              <span
                className={`engine-selection ${engine === "fabric" ? "fabric" : ""}`}
                aria-hidden="true"
              />
              {(["paper", "fabric"] as const).map((e) => (
                <button
                  key={e}
                  aria-pressed={engine === e}
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      await run("patchSettings", { defaultEngine: e });
                      setEngine(e);
                    })
                  }
                >
                  <Brand name={e} size={26} />
                  <span>{label(e)}</span>
                  <Icon name={e === "paper" ? "world" : "layers"} size={15} />
                </button>
              ))}
            </div>
            <div className="engine-title">
              <div className="engine-icon">
                <Brand name={engine} size={36} />
              </div>
              <div>
                <h2>
                  {label(engine)}{" "}
                  <span className="small gradient-text">Selected</span>
                </h2>
                <p className="helper">
                  {engine === "paper"
                    ? "Classic Minecraft, with room for server plugins."
                    : "Build something different with Fabric mods and matching client packs."}
                </p>
              </div>
            </div>
            <p className="selection-explainer">
              <Icon name="info" size={16} />
              <span>
                <strong>
                  {label(s.settings.defaultEngine)} is used by default for new
                  worlds.
                </strong>{" "}
                Each existing world keeps its own software and version.
                Switching here never converts a world.
              </span>
            </p>
            <div className="download-panel">
              <div className="field-grid">
                <Field label="Minecraft version">
                  <Select
                    aria-label="Minecraft version"
                    value={game}
                    onValueChange={setGame}
                    disabled={busy || !games.length}
                    placeholder={
                      catalogError ? "Catalog unavailable" : "Loading versions…"
                    }
                    options={games.map((g) => ({ value: g, label: g }))}
                  />
                </Field>
                <Field
                  label={engine === "paper" ? "Stable build" : "Stable loader"}
                >
                  <Select
                    aria-label={
                      engine === "paper" ? "Stable build" : "Stable loader"
                    }
                    value={version}
                    onValueChange={setVersion}
                    disabled={busy || loading || !versions.length}
                    placeholder="Choose a version"
                    options={versions.map((v) => ({
                      value: v.version,
                      label: v.version,
                    }))}
                  />
                </Field>
              </div>
              <div className="actions">
                <Button
                  kind="primary"
                  disabled={!picked || busy || loading || exists || !desktop}
                  onClick={() =>
                    task(async () => {
                      await run("install", {
                        engine,
                        minecraft: game,
                        version,
                      });
                    })
                  }
                >
                  <Icon name={exists ? "check" : "download"} size={16} />
                  {exists ? "Installed" : "Download selected version"}
                </Button>
                <span className="helper">
                  {picked
                    ? `Java ${picked.javaMajor} included${picked.size ? " · " + bytes(picked.size) : ""}`
                    : "Compatible Java included"}
                </span>
              </div>
              <div className="catalog-feedback">
                <Feedback error={catalogError}>
                  Live from {engine === "paper" ? "PaperMC" : "Fabric"} · stable
                  releases only
                  {catalogCheckedAt
                    ? ` · checked ${catalogCheckedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                  . Existing worlds keep their pinned version.
                </Feedback>
                <button
                  className="text-btn"
                  disabled={loading}
                  onClick={() => setCatalogRevision((n) => n + 1)}
                >
                  <Icon name="refresh" size={13} />{" "}
                  {loading
                    ? "Refreshing…"
                    : catalogError
                      ? "Retry catalog"
                      : "Refresh versions"}
                </button>
              </div>
            </div>
            <div className="installed-heading">
              <h3>
                Installed versions <span>{installed.length}</span>
              </h3>
              <button
                className="text-btn"
                disabled={checking}
                onClick={() => checkUpdates(true)}
              >
                <Icon name="refresh" size={14} />
                {checking ? "Checking…" : "Check updates"}
              </button>
            </div>
            <div className="installed-list">
              {installed.length ? (
                installed.map((c) => {
                  const update = updates.find((u) => u.componentId === c.id),
                    worlds = s.worlds.filter((w) => w.component.id === c.id);
                  return (
                    <div className="version-row" key={c.id}>
                      <Brand name={engine} size={25} />
                      <div className="meta">
                        <strong>Minecraft {c.minecraft}</strong>
                        <span>
                          {engine === "paper" ? "Build" : "Loader"} {c.version}{" "}
                          · {bytes(c.bytes)}
                        </span>
                        <small>
                          {worlds.map((w) => w.name).join(", ") ||
                            "Available for a new world"}
                        </small>
                      </div>
                      <div className="version-status">
                        <Badge
                          tone={
                            update?.status === "updateAvailable"
                              ? "amber"
                              : update?.status === "upToDate"
                                ? "green"
                                : ""
                          }
                        >
                          {update?.status === "updateAvailable"
                            ? `Update ${update.latest}`
                            : update?.status === "upToDate"
                              ? "Up to date"
                              : update?.status === "unavailable"
                                ? "Check unavailable"
                                : "Installed"}
                        </Badge>
                        {update?.status === "updateAvailable" &&
                          (worlds.length ? (
                            <button
                              className="text-btn"
                              onClick={() =>
                                show({ type: "update", id: worlds[0].id })
                              }
                            >
                              Review world update
                            </button>
                          ) : (
                            <button
                              className="text-btn"
                              disabled={busy}
                              onClick={() =>
                                task(async () => {
                                  await run("install", {
                                    engine: c.engine,
                                    minecraft: c.minecraft,
                                    version: update.latest,
                                  });
                                })
                              }
                            >
                              Download update
                            </button>
                          ))}
                      </div>
                      <Button
                        kind="ghost"
                        ariaLabel={`Uninstall ${label(engine)} ${c.minecraft} ${c.version}`}
                        onClick={() => show({ type: "uninstall", id: c.id })}
                      >
                        <Icon name="trash" size={16} />
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="empty-list">
                  No {label(engine)} versions installed yet. Pick one above to
                  get started.
                </p>
              )}
            </div>
            <p className="helper">
              Removing software keeps worlds and backups. Updates stay within
              each world’s Minecraft version.
            </p>
          </Card>
        </div>
        <div id="provider" className="settings-anchor">
          <Card
            title="Bring your friends along"
            action={
              <Badge tone={agentReady ? "green" : ""}>
                {loadingAuthorization
                  ? "Loading saved connection"
                  : registering
                    ? "Preparing device"
                    : agentReady
                      ? "Device registered"
                      : s.provider.linked
                        ? "Account linked"
                        : "Not linked"}
              </Badge>
            }
          >
            <div className="provider-heading">
              <div className="provider-identity">
                <Brand name="playit" size={48} />
                <div>
                  <h2>
                    playit<span className="muted">.gg</span>
                  </h2>
                  <p className="helper">
                    Your world. A public address. No router setup.
                  </p>
                </div>
              </div>
              <Button
                kind="ghost"
                onClick={() =>
                  task(() => openUrl("https://playit.gg/account/tunnels"))
                }
              >
                Dashboard
                <Icon name="external" size={14} />
              </Button>
            </div>
            <div className="provider-guide">
              <div>
                <span>01</span>
                <strong>Link your account</strong>
                <p>
                  Only the host needs a free Playit account. Authorize Enderlink
                  in your browser, then wait for “Device registered” here.
                </p>
              </div>
              <div>
                <span>02</span>
                <strong>Add a game tunnel</strong>
                <p>
                  Choose Minecraft Java and Playit Network (Global Anycast).
                  Select this agent and use local address 127.0.0.1:25565.
                </p>
              </div>
              <div>
                <span>03</span>
                <strong>Share & play</strong>
                <p>
                  Start your world. Friends paste its address into Minecraft. No
                  Enderlink account.
                </p>
              </div>
            </div>
            {!s.provider.linked && (
              <label className="check-row remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember this connection in the system credential store
              </label>
            )}
            <div className="actions">
              {!s.provider.linked ? (
                <Button
                  kind="primary"
                  disabled={busy || !desktop || loadingAuthorization}
                  onClick={() =>
                    task(async () => {
                      const url = (await run("beginLink", {
                        remember,
                      })) as string;
                      await openUrl(url);
                    })
                  }
                >
                  <Icon name="join" size={16} />
                  {s.provider.claimUrl
                    ? "Restart linking"
                    : "Link Playit account"}
                </Button>
              ) : (
                <>
                  <Button
                    kind="primary"
                    disabled={checkingProvider || registering}
                    onClick={verifyProvider}
                  >
                    <Icon name={tunnelReady ? "shield" : "refresh"} size={16} />
                    {registering
                      ? "Registering device…"
                      : checkingProvider
                        ? "Checking…"
                        : "Check connection"}
                  </Button>
                  {s.session?.pid && (
                    <Button
                      onClick={() =>
                        task(async () => {
                          await run("retryProvider");
                        })
                      }
                    >
                      Reconnect tunnel
                    </Button>
                  )}
                  <Button
                    kind="ghost"
                    onClick={() => show({ type: "disconnect" })}
                  >
                    Disconnect
                  </Button>
                </>
              )}
              {s.provider.claimUrl && (
                <Button
                  onClick={() => task(() => openUrl(s.provider.claimUrl!))}
                >
                  Continue in browser
                  <Icon name="external" size={14} />
                </Button>
              )}
            </div>
            <Feedback error={s.provider.error || undefined}>
              {loadingAuthorization
                ? "Respond to your system’s credential prompt to restore the saved connection."
                : registering
                  ? "Registering this device with Playit. Wait for this to finish before selecting the agent in your browser."
                  : s.provider.linked
                    ? !agentReady
                      ? "Account linked. Choose Check connection to prepare this device for Minecraft Java tunnels."
                      : tunnelReady
                        ? ""
                        : "Device registered. Click Refresh agents in Playit, select this agent, and finish creating the tunnel. Then choose Check connection here."
                    : "Link once and reuse the connection for all your worlds."}
              {s.provider.linked && !s.provider.persisted
                ? " Authorization lasts for this app session only."
                : ""}
            </Feedback>
          </Card>
        </div>
        <MemorySettings
          s={s}
          disabled={busy}
          allocate={(memoryMb) => setting({ memoryMb })}
        />
        <Card
          title="A little atmosphere"
          action={<Badge>{lightweight ? "Lightweight" : "Personalize"}</Badge>}
        >
          <Toggle
            label="Animations"
            description="App motion. Respects your system’s reduced-motion setting."
            checked={!s.settings.reducedMotion}
            disabled={busy}
            onChange={(on) => setting({ reducedMotion: !on })}
          />
          <Toggle
            label="Starfield"
            description="Show stars in the background."
            checked={s.settings.stars !== false}
            disabled={busy}
            onChange={(stars) => setting({ stars })}
          />
          <Toggle
            label="Frosted glass"
            description="Blur behind cards. Off uses solid surfaces."
            checked={s.settings.glass !== false}
            disabled={busy}
            onChange={(glass) => setting({ glass })}
          />
          <div className="field-grid appearance-options">
            <Field label="Star density">
              <Select
                aria-label="Star density"
                value={s.settings.starDensity || "medium"}
                disabled={busy || s.settings.stars === false}
                onValueChange={(value) =>
                  setting({ starDensity: value as Settings["starDensity"] })
                }
                options={[
                  { value: "low", label: "A few distant stars" },
                  { value: "medium", label: "A little atmosphere" },
                  { value: "high", label: "A fuller sky" },
                ]}
              />
            </Field>
            <Field label="Star movement">
              <Select
                aria-label="Star movement"
                value={s.settings.starMotion || "wander"}
                disabled={
                  busy || s.settings.stars === false || s.settings.reducedMotion
                }
                onValueChange={(value) =>
                  setting({ starMotion: value as Settings["starMotion"] })
                }
                options={[
                  { value: "wander", label: "Free drift · wider random paths" },
                  { value: "float", label: "Gentle float · smaller paths" },
                  { value: "still", label: "Still · color changes only" },
                ]}
              />
            </Field>
            <Field label="Star speed">
              <Select
                aria-label="Star speed"
                value={s.settings.starSpeed || "balanced"}
                disabled={
                  busy ||
                  s.settings.stars === false ||
                  s.settings.reducedMotion ||
                  s.settings.starMotion === "still"
                }
                onValueChange={(value) =>
                  setting({ starSpeed: value as Settings["starSpeed"] })
                }
                options={[
                  { value: "slow", label: "Slow · a quiet drift" },
                  { value: "balanced", label: "Balanced · visible movement" },
                  { value: "lively", label: "Lively · a little more energy" },
                ]}
              />
            </Field>
            <Field label="Glass finish">
              <Select
                aria-label="Glass finish"
                value={s.settings.glassOpacity || "clear"}
                disabled={busy || s.settings.glass === false}
                onValueChange={(value) =>
                  setting({ glassOpacity: value as Settings["glassOpacity"] })
                }
                options={[
                  {
                    value: "clear",
                    label: "Clear · visible stars, light blur",
                  },
                  { value: "frosted", label: "Frosted · softened stars" },
                  { value: "dense", label: "Dense · muted background" },
                ]}
              />
            </Field>
            <Field label="Interface animation pace">
              <Select
                aria-label="Interface animation pace"
                value={s.settings.motionSpeed || "gentle"}
                disabled={busy || s.settings.reducedMotion}
                onValueChange={(value) =>
                  setting({ motionSpeed: value as Settings["motionSpeed"] })
                }
                options={[
                  { value: "gentle", label: "Gentle" },
                  { value: "normal", label: "Balanced" },
                  { value: "lively", label: "Lively" },
                ]}
              />
            </Field>
          </div>
          <Toggle
            label="Color shimmer"
            description="Shift between pink and purple."
            checked={s.settings.starShimmer !== false}
            disabled={
              busy || s.settings.stars === false || s.settings.reducedMotion
            }
            onChange={(starShimmer) => setting({ starShimmer })}
          />
          <div className="performance-preset compact-preset">
            <Button
              disabled={busy || lightweight}
              onClick={() =>
                setting({ reducedMotion: true, glass: false, stars: false })
              }
            >
              {lightweight ? "Lightweight enabled" : "Use lightweight mode"}
            </Button>
          </div>
        </Card>
        <Card title="While you’re hosting">
          <Toggle
            label="Prevent sleep while hosting"
            description="Keep the computer awake. Closing its lid may still pause hosting."
            checked={s.settings.preventSleep}
            disabled={busy}
            onChange={(preventSleep) => setting({ preventSleep })}
          />
          <div className="setting-row">
            <div>
              <h3>Close gently</h3>
              <p>Quitting asks to save and stop an active world.</p>
            </div>
            <Icon name="shield" accent size={22} />
          </div>
        </Card>
        <Card
          title="Backups & storage"
          action={
            <Button onClick={() => show({ type: "backups" })}>
              <Icon name="storage" size={16} />
              Browse backups
            </Button>
          }
        >
          <div className="setting-row">
            <div>
              <h3>Everything stays on this computer</h3>
              <p>
                {s.worlds.length} worlds · {s.backups.length} backups ·{" "}
                {s.components.length} installed engines
              </p>
            </div>
            <Button onClick={() => show({ type: "storage" })}>Manage</Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Data folder</h3>
              <p className="data-path">{s.dataDir}</p>
            </div>
            <Button
              disabled={!s.dataDir}
              onClick={() => task(() => revealItemInDir(s.dataDir))}
            >
              Show folder
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Clean download staging files</h3>
              <p>Keep your worlds, installed software, and backups.</p>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                task(async () => {
                  await run("cleanCache");
                  notify("Download staging files removed.");
                })
              }
            >
              Clean cache
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Export diagnostics</h3>
              <p>
                A small support report. No credentials, addresses, logs, or
                player names.
              </p>
            </div>
            <Button
              onClick={() =>
                task(async () => {
                  const path = await save({
                    defaultPath: "enderlink-diagnostics.json",
                    filters: [{ name: "JSON report", extensions: ["json"] }],
                  });
                  if (path) {
                    await run("exportDiagnostics", { path });
                    notify("Diagnostics exported.");
                  }
                })
              }
            >
              Export report
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Restore a saved library</h3>
              <p>
                Bring back worlds, backups and play history after reinstalling.
              </p>
            </div>
            <Button onClick={() => show({ type: "restoreLibrary" })}>
              Restore saved library
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Start fresh</h3>
              <p>
                Erase all local data and settings. Keep Enderlink installed.
              </p>
            </div>
            <Button
              kind="danger"
              onClick={() => show({ type: "clearAllData" })}
            >
              Clear all data…
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h3>Remove Enderlink</h3>
              <p>
                Save your worlds to a folder or delete them, then uninstall.
              </p>
            </div>
            <Button
              kind="danger"
              onClick={() => show({ type: "uninstallApp" })}
            >
              Uninstall Enderlink…
            </Button>
          </div>
        </Card>
        <Feedback error={error || checkError} />
      </div>
    </div>
  );
}
