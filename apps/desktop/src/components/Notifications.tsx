import { useCallback, useEffect, useRef, useState } from "react";
import type { Operation } from "../types";
import { Icon } from "./Icons";
import "./Notifications.css";

export interface ToastMessage {
  id: string;
  text: string;
  createdAt: number;
}

type TrackedOperation = { operation: Operation; seenAt: number };
const DISPLAY_MS = 3000;
const EXIT_MS = 180;

export function NotificationStack({
  operations,
  ready,
  messages,
  onDismissMessage,
  onCancel,
}: {
  operations: Operation[];
  ready: boolean;
  messages: ToastMessage[];
  onDismissMessage: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const initialized = useRef(false);
  const completed = useRef(new Set<string>());
  const [tracked, setTracked] = useState<TrackedOperation[]>([]);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!initialized.current) {
      // Completed work in the first snapshot is history, not a new popup.
      operations
        .filter((op) => op.finishedAt !== null)
        .forEach((op) => completed.current.add(op.id));
      initialized.current = true;
    }
    const updates = operations.filter(
      (op) => op.finishedAt === null || !completed.current.has(op.id),
    );
    updates
      .filter((op) => op.finishedAt !== null)
      .forEach((op) => completed.current.add(op.id));
    const ids = new Set(operations.map((op) => op.id));
    // The backend keeps a bounded operation history. Its pruned IDs cannot reappear.
    for (const id of completed.current)
      if (!ids.has(id)) completed.current.delete(id);
    const now = Date.now();
    setTracked((previous) => {
      const next = new Map(
        previous
          .filter(
            ({ operation }) =>
              operation.finishedAt !== null || ids.has(operation.id),
          )
          .map((entry) => [entry.operation.id, entry]),
      );
      for (const operation of updates) {
        const existing = next.get(operation.id);
        next.set(operation.id, { operation, seenAt: existing?.seenAt ?? now });
      }
      return [...next.values()];
    });
  }, [operations, ready]);
  const dismissOperation = useCallback((id: string) => {
    setTracked((current) =>
      current.filter(({ operation }) => operation.id !== id),
    );
  }, []);
  const notices = [
    ...tracked.map(({ operation, seenAt }) => ({
      id: `op-${operation.id}`,
      at: seenAt,
      operation,
      message: undefined,
    })),
    ...messages.map((message) => ({
      id: message.id,
      at: message.createdAt,
      operation: undefined,
      message,
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <aside className="notification-stack" aria-label="Notifications">
      {notices.map(({ id, operation, message }) => (
        <Notification
          key={id}
          operation={operation}
          text={message?.text}
          hidden={hidden}
          onDismiss={() =>
            operation ? dismissOperation(operation.id) : onDismissMessage(id)
          }
          onCancel={() => operation && onCancel(operation.id)}
        />
      ))}
    </aside>
  );
}

function Notification({
  operation,
  text,
  hidden,
  onDismiss,
  onCancel,
}: {
  operation?: Operation;
  text?: string;
  hidden: boolean;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const active = !!operation && operation.finishedAt === null;
  const phase = operation?.status ?? "message";
  const failed = operation?.status === "failed";
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const remaining = useRef(DISPLAY_MS);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const paused = hovered || focused || hidden || !visible;
  useEffect(() => {
    // Removing a focused Cancel button does not reliably dispatch blur.
    setFocused(card.current?.contains(document.activeElement) ?? false);
  }, [phase, active]);
  useEffect(() => {
    const element = card.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.9),
      { root: element.parentElement, threshold: [0, 0.9] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    remaining.current = DISPLAY_MS;
  }, [phase]);
  useEffect(() => {
    if (active || paused || leaving) return;
    const started = performance.now();
    const timer = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - started),
      );
    };
  }, [active, phase, paused, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => dismiss.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return (
    <div
      ref={card}
      className={`notification-card ${failed ? "notification-error" : ""} ${leaving ? "notification-leaving" : ""}`}
      role={failed ? "alert" : "status"}
      aria-live={active ? "off" : "polite"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div className="notification-heading">
        {active ? (
          <i className="busy-indicator" />
        ) : (
          <Icon name={failed ? "info" : "check"} size={15} />
        )}
        <strong>{operation?.label ?? "Enderlink"}</strong>
        {!active && (
          <button
            className="notification-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setLeaving(true)}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <p>{operation?.message ?? text}</p>
      {active && operation.progress !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-label={operation.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            Math.max(0, Math.min(100, operation.progress * 100)),
          )}
        >
          <i
            style={{
              width: `${Math.max(0, Math.min(100, operation.progress * 100))}%`,
            }}
          />
        </div>
      )}
      {operation?.status === "queued" && (
        <button className="text-btn" onClick={onCancel}>
          Cancel queued operation
        </button>
      )}
    </div>
  );
}
