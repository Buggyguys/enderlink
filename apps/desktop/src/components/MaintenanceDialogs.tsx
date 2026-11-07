import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { bytes, call } from "../api";
import type { Snapshot } from "../types";
import { Button, Feedback, Field } from "./UI";
import { Icon } from "./Icons";
import "./MaintenanceDialogs.css";

export interface MaintenancePlan {
  token: string;
  worlds: number;
  backups: number;
  components: number;
  bytes: number;
  hasLibrary: boolean;
}

export interface UninstallInfo {
  supported: boolean;
  method?: string;
  applicationPath: string | null;
  description: string;
  manualCommand?: string | null;
}

type Props = {
  s: Snapshot;
  run: (action: string, args?: unknown) => Promise<unknown>;
  close: () => void;
  onBusyChange?: (busy: boolean) => void;
  onComplete?: (message: string) => void;
};

function blockReason(s: Snapshot): string {
  if (
    s.session?.pid ||
    s.warnings.some((warning) =>
      /server survived|recovered server process/i.test(warning),
    )
  )
    return "Save and stop the server before continuing.";
  if (s.operations.some((operation) => operation.finishedAt === null))
    return "Wait for the current operations to finish.";
  return "";
}

function inventoryKey(s: Snapshot): string {
  return JSON.stringify([
    s.worlds.map((world) => [world.id, world.revision]),
    s.backups.map((backup) => backup.id),
    s.components.map((component) => component.id),
  ]);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useAction(onBusyChange?: Props["onBusyChange"]) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      busyCallback.current?.(false);
    };
  }, []);
  async function perform(
    action: () => Promise<void>,
    stayBusy = false,
  ): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    busyCallback.current?.(true);
    let success = false;
    try {
      await action();
      success = true;
      return true;
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
      return false;
    } finally {
      if (!success || !stayBusy) {
        lock.current = false;
        if (alive.current) {
          setBusy(false);
          busyCallback.current?.(false);
        }
      }
    }
  }
  return { busy, error, setError, perform };
}

function useReview(s: Snapshot, uninstall: boolean, busy: boolean) {
  const [plan, setPlan] = useState<MaintenancePlan | null>(null);
  const [info, setInfo] = useState<UninstallInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const blocked = blockReason(s);
  const inventory = inventoryKey(s);
  useEffect(() => {
    if (busy) return;
    let live = true;
    setPlan(null);
    setInfo(null);
    setError("");
    if (blocked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      call<MaintenancePlan>("maintenancePlan"),
      uninstall
        ? invoke<UninstallInfo>("uninstall_info")
        : Promise.resolve(null),
    ])
      .then(([nextPlan, nextInfo]) => {
        if (!live) return;
        setPlan(nextPlan);
        setInfo(nextInfo);
      })
      .catch((cause) => {
        if (live) setError(errorText(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [inventory, blocked, uninstall, revision, busy]);
  return {
    plan,
    info,
    loading,
    error,
    blocked,
    refresh: () => setRevision((value) => value + 1),
  };
}

function Shell({
  title,
  description,
  children,
  footer,
  busy,
  close,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  busy: boolean;
  close: () => void;
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
        <Button
          kind="icon ghost"
          ariaLabel="Close dialog"
          disabled={busy}
          onClick={close}
        >
          <Icon name="close" size={16} />
        </Button>
      </div>
      <div className="dialog-body maintenance-body" aria-busy={busy}>
        {children}
      </div>
      <div className="dialog-foot">{footer}</div>
    </>
  );
}

function Inventory({ plan, s }: { plan: MaintenancePlan | null; s: Snapshot }) {
  return (
    <dl className="maintenance-inventory">
      {[
        ["Worlds", plan?.worlds ?? s.worlds.length],
        ["Backups", plan?.backups ?? s.backups.length],
        ["Installed engines", plan?.components ?? s.components.length],
        ["Managed storage", plan ? bytes(plan.bytes) : "—"],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Confirmation({
  phrase,
  value,
  change,
  disabled,
}: {
  phrase: string;
  value: string;
  change: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <Field
      label={
        <>
          Type <strong>{phrase}</strong>
        </>
      }
    >
      <input
        aria-label="Confirmation phrase"
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </Field>
  );
}

export function ClearAllDataDialog({
  s,
  run,
  close,
  onBusyChange,
  onComplete,
}: Props) {
  const action = useAction(onBusyChange);
  const review = useReview(s, false, action.busy);
  const [phrase, setPhrase] = useState("");
  const expected = "CLEAR ENDERLINK DATA";
  useEffect(() => setPhrase(""), [review.plan?.token]);
  const disabled =
    action.busy || review.loading || !!review.blocked || !review.plan;
  async function reset() {
    if (disabled || phrase !== expected) return;
    const token = review.plan!.token;
    const confirmedPhrase = phrase;
    setPhrase("");
    const success = await action.perform(async () => {
      await run("resetAllData", { token, phrase: confirmedPhrase });
    });
    if (success) {
      onComplete?.("Enderlink was reset. All local data was cleared.");
      close();
    } else {
      review.refresh();
    }
  }
  return (
    <Shell
      title="Clear all data"
      description="Reset Enderlink to a fresh install. The app stays installed."
      busy={action.busy}
      close={close}
      footer={
        <>
          <Button disabled={action.busy} onClick={close}>
            Cancel
          </Button>
          <Button
            kind="danger"
            disabled={disabled || phrase !== expected}
            onClick={reset}
          >
            {action.busy ? "Clearing data…" : "Clear all data"}
          </Button>
        </>
      }
    >
      <Inventory plan={review.plan} s={s} />
      <p className="maintenance-warning">
        Permanently deletes all worlds, backups, play history, downloaded
        software, settings and saved Playit authorization.
      </p>
      <p className="maintenance-note">
        Your Playit account and files exported outside Enderlink stay.
      </p>
      <Confirmation
        phrase={expected}
        value={phrase}
        change={setPhrase}
        disabled={disabled}
      />
      <div className="maintenance-feedback">
        <Feedback error={review.blocked || action.error || review.error}>
          {action.busy
            ? "Keep Enderlink open until this finishes."
            : review.loading
              ? "Reviewing local data…"
              : "This cannot be undone."}
        </Feedback>
      </div>
      {(review.error || action.error) && (
        <button
          className="text-btn"
          disabled={action.busy}
          onClick={() => {
            action.setError("");
            review.refresh();
          }}
        >
          Review again
        </button>
      )}
    </Shell>
  );
}

export function UninstallAppDialog({ s, close, onBusyChange }: Props) {
  const action = useAction(onBusyChange);
  const [closing, setClosing] = useState(false);
  const busy = action.busy || closing;
  const review = useReview(s, true, busy);
  const [keep, setKeep] = useState(true);
  const [saveTo, setSaveTo] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [phrase, setPhrase] = useState("");
  const expected = "UNINSTALL ENDERLINK";
  const hasLibrary =
    review.plan?.hasLibrary ?? !!(s.worlds.length || s.backups.length);
  const shouldSave = hasLibrary && keep;
  useEffect(() => setPhrase(""), [review.plan?.token]);
  const disabled =
    busy ||
    choosing ||
    review.loading ||
    !!review.blocked ||
    !review.plan ||
    !review.info?.supported;
  async function chooseFolder() {
    if (busy || choosing) return;
    setChoosing(true);
    action.setError("");
    try {
      const parent = await open({
        title: "Where should Enderlink save your worlds?",
        directory: true,
        multiple: false,
      });
      if (typeof parent === "string") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        setSaveTo(await join(parent, `Enderlink saved worlds ${stamp}`));
        setPhrase("");
      }
    } catch (cause) {
      action.setError(errorText(cause));
    } finally {
      setChoosing(false);
    }
  }
  async function uninstall() {
    if (disabled || phrase !== expected || (shouldSave && !saveTo)) return;
    const token = review.plan!.token;
    const confirmedPhrase = phrase;
    setPhrase("");
    const success = await action.perform(async () => {
      await invoke("uninstall_app", {
        token,
        phrase: confirmedPhrase,
        saveTo: shouldSave ? saveTo : null,
      });
    }, true);
    if (success) setClosing(true);
    else review.refresh();
  }
  const actionLabel = busy
    ? closing
      ? "Closing Enderlink…"
      : shouldSave
        ? "Saving and uninstalling…"
        : "Uninstalling…"
    : shouldSave
      ? "Save & uninstall"
      : "Uninstall Enderlink";
  return (
    <Shell
      title="Uninstall Enderlink"
      description="Remove the app, downloaded software, settings and local Playit authorization."
      busy={busy}
      close={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            kind="danger"
            disabled={
              disabled || phrase !== expected || (shouldSave && !saveTo)
            }
            onClick={uninstall}
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <Inventory plan={review.plan} s={s} />
      {hasLibrary && (
        <fieldset className="maintenance-choices" disabled={busy}>
          <legend>Your worlds & backups</legend>
          <label className={`maintenance-choice ${keep ? "selected" : ""}`}>
            <input
              type="radio"
              name="uninstall-library"
              value="save"
              checked={keep}
              onChange={() => {
                setKeep(true);
                setPhrase("");
              }}
            />
            <span>
              <strong>Save to a folder</strong>
              <small>Keep worlds, backups and play history for later.</small>
            </span>
          </label>
          <label className={`maintenance-choice ${keep ? "" : "selected"}`}>
            <input
              type="radio"
              name="uninstall-library"
              value="delete"
              checked={!keep}
              onChange={() => {
                setKeep(false);
                setPhrase("");
              }}
            />
            <span>
              <strong>Delete everything</strong>
              <small>Permanently delete the saved library too.</small>
            </span>
          </label>
        </fieldset>
      )}
      {hasLibrary && (
        <div className="maintenance-destination">
          {keep ? (
            <>
              <label htmlFor="uninstall-save-folder">
                New folder for saved worlds
              </label>
              <div className="maintenance-folder-row">
                <input
                  id="uninstall-save-folder"
                  readOnly
                  value={saveTo}
                  title={saveTo || undefined}
                  placeholder="Choose where to save…"
                />
                <Button disabled={busy || choosing} onClick={chooseFolder}>
                  {choosing ? "Choosing…" : "Choose folder"}
                </Button>
              </div>
              <p>Use Restore saved library after reinstalling Enderlink.</p>
            </>
          ) : (
            <p className="maintenance-warning">
              The worlds, backups and play history listed above will be deleted.
            </p>
          )}
        </div>
      )}
      <div className="maintenance-target">
        <p>{review.info?.description || "Checking this installation…"}</p>
        {review.info?.applicationPath && (
          <code title={review.info.applicationPath}>
            {review.info.applicationPath}
          </code>
        )}
        {review.info?.manualCommand && <pre>{review.info.manualCommand}</pre>}
      </div>
      <p className="maintenance-note">
        Your Playit account and existing external exports stay.
      </p>
      <Confirmation
        phrase={expected}
        value={phrase}
        change={setPhrase}
        disabled={disabled}
      />
      <div className="maintenance-feedback">
        <Feedback error={review.blocked || action.error || review.error}>
          {busy
            ? closing
              ? "Enderlink will close to finish removal."
              : "Keep Enderlink open until this finishes."
            : review.loading
              ? "Reviewing local data…"
              : shouldSave
                ? "Your library is saved before any local data is removed."
                : "App data is permanently removed after confirmation."}
        </Feedback>
      </div>
      {(review.error || action.error) && (
        <button
          className="text-btn"
          disabled={busy}
          onClick={() => {
            action.setError("");
            review.refresh();
          }}
        >
          Review again
        </button>
      )}
    </Shell>
  );
}

export function RestoreLibraryDialog({
  s,
  run,
  close,
  onBusyChange,
  onComplete,
}: Props) {
  const action = useAction(onBusyChange);
  const [path, setPath] = useState("");
  const [choosing, setChoosing] = useState(false);
  const blocked =
    blockReason(s) ||
    (s.worlds.length || s.backups.length
      ? "Restore saved worlds into an empty library. Your current worlds and backups will not be overwritten."
      : "");
  async function chooseFolder() {
    setChoosing(true);
    action.setError("");
    try {
      const selected = await open({
        title: "Choose a saved Enderlink library",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") setPath(selected);
    } catch (cause) {
      action.setError(errorText(cause));
    } finally {
      setChoosing(false);
    }
  }
  async function restore() {
    if (!path || blocked || action.busy || choosing) return;
    const success = await action.perform(async () => {
      await run("restoreLibrary", { path });
    });
    if (success) {
      onComplete?.("Saved worlds, backups and play history restored.");
      close();
    }
  }
  return (
    <Shell
      title="Restore saved library"
      description="Open a library folder saved by Enderlink before uninstalling."
      busy={action.busy}
      close={close}
      footer={
        <>
          <Button disabled={action.busy} onClick={close}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={action.busy || choosing || !!blocked || !path}
            onClick={restore}
          >
            {action.busy ? "Restoring…" : "Restore saved library"}
          </Button>
        </>
      }
    >
      <div className="maintenance-destination">
        <label htmlFor="restore-library-folder">Saved library folder</label>
        <div className="maintenance-folder-row">
          <input
            id="restore-library-folder"
            readOnly
            value={path}
            title={path || undefined}
            placeholder="Choose a saved library…"
          />
          <Button
            disabled={action.busy || choosing || !!blocked}
            onClick={chooseFolder}
          >
            {choosing ? "Choosing…" : "Choose folder"}
          </Button>
        </div>
      </div>
      <p className="maintenance-note">
        Restores worlds, backups and play history. Server software can be
        reinstalled from Settings.
      </p>
      <div className="maintenance-feedback">
        <Feedback error={blocked || action.error}>
          {action.busy
            ? "Keep Enderlink open until this finishes."
            : "The saved folder is kept."}
        </Feedback>
      </div>
    </Shell>
  );
}
