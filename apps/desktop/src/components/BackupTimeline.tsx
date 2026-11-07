import { Select } from "./Select";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Backup } from "../types";
import { bytes } from "../api";
import { Icon } from "./Icons";
import { Badge, Button, Card } from "./UI";
import {
  clampRange,
  groupTimelinePoints,
  minimumSpan,
  panRange,
  tickStepLabel,
  timelineDomain,
  timelineTicks,
  timePosition,
  zoomRange,
  type TimeRange,
} from "./timelineMath";
import "./BackupTimeline.css";

interface Props {
  backups: Backup[];
  worldCreatedAt: number;
  worldId?: string;
  onManage: () => void;
  onRestore?: (backup: Backup) => void;
  restoreDisabled?: boolean;
  /** A supplied timestamp makes the clock deterministic in tests. */
  now?: number;
}

function exactTime(time: number): string {
  return new Date(time * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function rangeLabel(range: TimeRange): string {
  const start = new Date(range.start * 1000);
  const end = new Date(range.end * 1000);
  if (start.toDateString() === end.toDateString())
    return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} — ${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** A separate keyed body resets view state only when the world changes. */
export function BackupTimeline(props: Props) {
  return <Timeline key={props.worldId ?? props.worldCreatedAt} {...props} />;
}

function Timeline({
  backups,
  worldCreatedAt,
  onManage,
  onRestore,
  restoreDisabled = false,
  now,
}: Props) {
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const [view, setView] = useState<TimeRange | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState(720);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    range: TimeRange;
    width: number;
  } | null>(null);
  const id = useId().replace(/:/g, "");
  const ordered = useMemo(
    () =>
      [...backups].sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      ),
    [backups],
  );
  const timestampCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const backup of ordered)
      counts.set(backup.createdAt, (counts.get(backup.createdAt) ?? 0) + 1);
    return counts;
  }, [ordered]);
  const selected =
    ordered.find((backup) => backup.id === selectedId) ?? ordered.at(-1);
  const domain = timelineDomain(worldCreatedAt, now ?? clock);
  const range = view ? clampRange(view, domain) : domain;
  const allTime =
    !view || range.end - range.start >= domain.end - domain.start - 0.001;
  const visibleGroups = useMemo(
    () => groupTimelinePoints(ordered, range, width),
    [ordered, range.start, range.end, width],
  );
  const selectedGroup = visibleGroups.find((group) =>
    group.points.some((point) => point.id === selected?.id),
  );
  const { step, ticks } = useMemo(
    () => timelineTicks(range, width),
    [range.start, range.end, width],
  );
  const current = useRef({ range, domain, width });
  current.current = { range, domain, width };
  const selectedVisible =
    selected &&
    selected.createdAt >= range.start &&
    selected.createdAt <= range.end;
  const visiblePoints = visibleGroups.flatMap((group) => group.points);
  // Paint the chosen backup last so coincident dots cannot cover its highlight.
  const paintOrder = selectedVisible
    ? [...visiblePoints.filter((backup) => backup.id !== selected.id), selected]
    : visiblePoints;
  const canZoomIn = range.end - range.start > minimumSpan(domain) + 0.001;

  useEffect(() => {
    if (now !== undefined) return;
    const update = () => {
      if (!document.hidden) setClock(Date.now() / 1000);
    };
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [now]);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const applyRange = useCallback((next: TimeRange) => {
    const domain = current.current.domain;
    const bounded = clampRange(next, domain);
    current.current.range = bounded;
    setView(
      bounded.end - bounded.start >= domain.end - domain.start - 0.001
        ? null
        : bounded,
    );
  }, []);
  const zoom = useCallback(
    (factor: number, anchor = 0.5) => {
      const { range, domain } = current.current;
      applyRange(zoomRange(range, domain, factor, anchor));
    },
    [applyRange],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const anchorAt = (x: number) => {
      const rect = track.current?.getBoundingClientRect();
      return rect?.width
        ? Number.isFinite(x)
          ? Math.max(0, Math.min(1, (x - rect.left) / rect.width))
          : 0.5
        : 0.5;
    };
    const wheel = (event: WheelEvent) => {
      const units =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoom(
          Math.exp(Math.max(-1, Math.min(1, event.deltaY * units * 0.006))),
          anchorAt(event.clientX),
        );
      } else if (
        event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        const { range, domain, width } = current.current;
        const dx =
          event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const next = panRange(
          range,
          domain,
          ((dx * units) / Math.max(1, width)) * (range.end - range.start),
        );
        if (next.start !== range.start) {
          event.preventDefault();
          applyRange(next);
        }
      }
      // Plain vertical scrolling always belongs to the page.
    };
    // Safari/WKWebView sends gesture events for trackpad pinches on macOS.
    type PinchEvent = Event & { scale: number; clientX: number };
    let pinch: { range: TimeRange; anchor: number } | null = null;
    const startPinch = (raw: Event) => {
      const event = raw as PinchEvent;
      event.preventDefault();
      pinch = { range: current.current.range, anchor: anchorAt(event.clientX) };
    };
    const changePinch = (raw: Event) => {
      const event = raw as PinchEvent;
      if (!pinch || !Number.isFinite(event.scale) || event.scale <= 0) return;
      event.preventDefault();
      applyRange(
        zoomRange(
          pinch.range,
          current.current.domain,
          1 / event.scale,
          pinch.anchor,
        ),
      );
    };
    const stopPinch = () => {
      pinch = null;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", startPinch, { passive: false });
    element.addEventListener("gesturechange", changePinch, { passive: false });
    element.addEventListener("gestureend", stopPinch);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", startPinch);
      element.removeEventListener("gesturechange", changePinch);
      element.removeEventListener("gestureend", stopPinch);
    };
  }, [applyRange, zoom]);

  const reveal = (backup: Backup) => {
    setSelectedId(backup.id);
    if (backup.createdAt >= range.start && backup.createdAt <= range.end)
      return;
    const half = (range.end - range.start) / 2;
    applyRange({
      start: backup.createdAt - half,
      end: backup.createdAt + half,
    });
  };
  const zoomButton = (factor: number) =>
    zoom(
      factor,
      selectedVisible ? timePosition(selected.createdAt, range) : 0.5,
    );
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (event.button !== 0 && event.pointerType !== "touch") ||
      (event.target as Element).closest("button,select")
    )
      return;
    drag.current = { pointer: event.pointerId, x: event.clientX, range, width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 3) setDragging(true);
    applyRange(
      panRange(
        start.range,
        current.current.domain,
        -(dx / Math.max(1, start.width)) *
          (start.range.end - start.range.start),
      ),
    );
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const span = range.end - range.start;
    if (["+", "="].includes(event.key)) zoom(0.5);
    else if (event.key === "-") zoom(2);
    else if (event.key === "ArrowLeft")
      applyRange(panRange(range, domain, -span * 0.2));
    else if (event.key === "ArrowRight")
      applyRange(panRange(range, domain, span * 0.2));
    else if (event.key === "Home")
      applyRange({ start: domain.start, end: domain.start + span });
    else if (event.key === "End")
      applyRange({ start: domain.end - span, end: domain.end });
    else if (event.key === "0") setView(null);
    else return;
    event.preventDefault();
  };

  return (
    <Card
      className="world-history backup-history"
      title="Backup timeline"
      action={
        <div className="history-header-actions">
          <Badge>{backups.length} saved</Badge>
          <button className="text-btn" type="button" onClick={onManage}>
            Manage backups <span aria-hidden="true">→</span>
          </button>
        </div>
      }
    >
      <div className="backup-time-toolbar">
        <span
          className="backup-time-range"
          title={`${exactTime(range.start)} — ${exactTime(range.end)}`}
        >
          {rangeLabel(range)}
        </span>
        <div
          className="backup-time-zoom"
          role="group"
          aria-label="Timeline zoom"
        >
          <span className="backup-time-scale">{tickStepLabel(step)}</span>
          <Button
            kind="icon ghost"
            ariaLabel="Zoom out timeline"
            disabled={allTime}
            onClick={() => zoomButton(2)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 12h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </Button>
          <Button
            kind="icon ghost"
            ariaLabel="Zoom in timeline"
            disabled={!canZoomIn}
            onClick={() => zoomButton(0.5)}
          >
            <Icon name="plus" size={16} />
          </Button>
          <Button
            kind="ghost"
            ariaLabel="Show entire timeline"
            disabled={allTime}
            onClick={() => setView(null)}
          >
            All time
          </Button>
        </div>
      </div>
      <div
        className="backup-time-viewport"
        ref={viewport}
        tabIndex={0}
        role="group"
        aria-label="Backup time axis"
        aria-describedby={`${id}-instructions`}
        data-dragging={dragging}
        data-range-start={range.start}
        data-range-end={range.end}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={keyboard}
      >
        <div className="backup-time-track" ref={track}>
          <svg
            className="backup-time-svg"
            viewBox={`0 0 ${width} 132`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id={`${id}-line`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2={width}
                y2="0"
              >
                <stop stopColor="var(--violet)" />
                <stop offset="1" stopColor="var(--pink)" />
              </linearGradient>
            </defs>
            <line
              className="backup-time-line"
              x1="0"
              x2={width}
              y1="52"
              y2="52"
              stroke={`url(#${id}-line)`}
            />
            {ticks.map((tick) => {
              const position = timePosition(tick.time, range);
              const x = position * width;
              return (
                <g key={tick.time} className="backup-time-tick">
                  <line x1={x} x2={x} y1="66" y2="73" />
                  <text
                    x={x}
                    y="93"
                    textAnchor={
                      position < 0.06
                        ? "start"
                        : position > 0.94
                          ? "end"
                          : "middle"
                    }
                  >
                    {tick.label}
                  </text>
                  {tick.context && (
                    <text
                      className="backup-time-context"
                      x={x}
                      y="111"
                      textAnchor={
                        position < 0.06
                          ? "start"
                          : position > 0.94
                            ? "end"
                            : "middle"
                      }
                    >
                      {tick.context}
                    </text>
                  )}
                </g>
              );
            })}
            {range.start === domain.start && (
              <g className="backup-time-endpoint">
                <line x1="0" x2="0" y1="46" y2="58" />
                <text x="0" y="21">
                  Created
                </text>
              </g>
            )}
            {range.end >= domain.end - 0.001 && (
              <g className="backup-time-endpoint">
                <line x1={width} x2={width} y1="46" y2="58" />
                <text x={width} y="21" textAnchor="end">
                  Now
                </text>
              </g>
            )}
            {paintOrder.map((backup) => (
              <circle
                key={backup.id}
                className="backup-time-dot"
                data-selected={selected?.id === backup.id}
                cx={timePosition(backup.createdAt, range) * width}
                cy="52"
                r={selected?.id === backup.id ? 6 : 4.5}
              />
            ))}
          </svg>
          {visibleGroups.map((group) => {
            const active = group.points.some(
              (point) => point.id === selected?.id,
            );
            return (
              <button
                key={group.points[0].id}
                className="backup-time-hit"
                type="button"
                style={{ left: `${group.position * 100}%` }}
                aria-pressed={active}
                title={
                  group.points.length === 1
                    ? exactTime(group.points[0].createdAt)
                    : `${group.points.length} nearby backups`
                }
                aria-label={
                  group.points.length === 1
                    ? `Backup ${exactTime(group.points[0].createdAt)}, ${bytes(group.points[0].bytes)}`
                    : `${group.points.length} nearby backups, from ${exactTime(group.points[0].createdAt)}`
                }
                onClick={() =>
                  setSelectedId(
                    active && selected ? selected.id : group.points[0].id,
                  )
                }
              >
                {group.points.length > 1 && (
                  <span className="backup-time-count">
                    {group.points.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="backup-time-details">
        <div className="backup-time-selection">
          {selected ? (
            <>
              <label className="backup-time-picker">
                <span>Selected backup</span>
                <Select
                  aria-label="Selected backup"
                  value={selected.id}
                  onValueChange={(value) => {
                    const backup = ordered.find(
                      (backup) => backup.id === value,
                    );
                    if (backup) reveal(backup);
                  }}
                  options={ordered.map((backup, index) => ({
                    value: backup.id,
                    label:
                      exactTime(backup.createdAt) +
                      ((timestampCounts.get(backup.createdAt) ?? 0) > 1
                        ? ` · #${index + 1}`
                        : ""),
                  }))}
                />
              </label>
              <span className="backup-time-meta">
                {bytes(selected.bytes)}
                {selectedGroup && selectedGroup.points.length > 1
                  ? ` · ${selectedGroup.points.length} nearby backups at this zoom`
                  : ""}
              </span>
            </>
          ) : (
            <div className="backup-time-empty">
              <strong>No backups yet</strong>
              <span>Stop the world and choose Back up.</span>
            </div>
          )}
        </div>
        <div className="backup-time-review">
          {onRestore && (
            <Button
              kind="ghost"
              disabled={!selected || restoreDisabled}
              onClick={() => selected && onRestore(selected)}
            >
              Review restore
            </Button>
          )}
          <span>{restoreDisabled ? "An operation is in progress." : ""}</span>
        </div>
      </div>
      <div className="backup-time-help">
        <span>Drag to pan · Pinch or Ctrl/⌘ + scroll to zoom</span>
        <span>Local time</span>
      </div>
      <span id={`${id}-instructions`} className="backup-time-sr">
        Use plus and minus to zoom, left and right arrows to pan, Home or End to
        move to the bounds, and zero for all time. Choose a backup dot or use
        Selected backup for every snapshot, including overlapping dots.
      </span>
    </Card>
  );
}
