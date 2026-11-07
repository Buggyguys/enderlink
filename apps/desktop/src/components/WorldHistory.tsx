import { Select } from "./Select";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icons";
import { Button, Card } from "./UI";
import "./WorldHistory.css";

export interface PlaytimePlayer {
  id: string;
  name: string;
  verified: boolean;
}

export interface PlaytimeDay {
  start: number;
  end: number;
  worldSeconds: number;
  players: { id: string; name: string; seconds: number }[];
}

export interface PlaytimeHistoryData {
  worldId: string;
  recordedFrom: number | null;
  days: PlaytimeDay[];
  players: PlaytimePlayer[];
  observedAt: number;
}

/** Local calendar edges, including tomorrow. Constructing each midnight handles DST. */
export function localDayBoundaries(
  dayCount: number,
  now = new Date(),
): number[] {
  const count = Math.min(90, Math.max(1, Math.floor(dayCount)));
  return Array.from({ length: count + 1 }, (_, index) =>
    Math.floor(
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - count + 1 + index,
      ).getTime() / 1000,
    ),
  );
}

export function formatPlaytime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole === 0) return "0m";
  if (whole < 60) return `${whole}s`;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

function exactPlaytime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return [
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    (rest || !whole) && `${rest}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function dayLabel(start: number, full = false): string {
  return new Date(start * 1000).toLocaleDateString(
    undefined,
    full
      ? { weekday: "long", month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" },
  );
}

function playerLabel(player: PlaytimePlayer): string {
  return `${player.name} · ${player.verified ? "verified" : "offline name"}`;
}

const plotWidth = 720;
const plotHeight = 156;
const plotTop = 10;

function plotPath(
  values: (number | null)[],
  maximum: number,
  area = false,
): string {
  const chunks: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) chunks.push(current);
      current = [];
    } else {
      current.push({
        x: ((index + 0.5) / values.length) * plotWidth,
        y: plotHeight - (value / maximum) * (plotHeight - plotTop),
      });
    }
  });
  if (current.length) chunks.push(current);
  return chunks
    .map((points) => {
      const line = points
        .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
        .join(" ");
      return area
        ? `${line} L${points[points.length - 1].x},${plotHeight} L${points[0].x},${plotHeight} Z`
        : line;
    })
    .join(" ");
}

export function PlaytimeHistory({
  history,
  loading = false,
  error,
  onRefresh,
  trackingUnavailable = false,
}: {
  history: PlaytimeHistoryData | null;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  trackingUnavailable?: boolean;
}) {
  const [range, setRange] = useState<7 | 30>(7);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const days = useMemo(
    () =>
      [...(history?.days ?? [])]
        .sort((left, right) => left.start - right.start)
        .slice(-range),
    [history?.days, range],
  );
  const player = history?.players.find(
    (candidate) => candidate.id === selectedPlayer,
  );
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => day.start === activeStart),
  );
  const inspectedIndex =
    activeStart !== null && days[activeIndex]?.start === activeStart
      ? activeIndex
      : days.length - 1;
  const inspected = days[inspectedIndex];
  const isRecorded = (day: PlaytimeDay) =>
    history?.recordedFrom != null &&
    day.end > history.recordedFrom &&
    day.start <= history.observedAt;
  const playerSeconds = (day: PlaytimeDay) =>
    day.players.find((entry) => entry.id === player?.id)?.seconds ?? 0;
  const worldTotal = days.reduce((sum, day) => sum + day.worldSeconds, 0);
  const personalTotal = days.reduce((sum, day) => sum + playerSeconds(day), 0);
  const activeDays = days.filter((day) => day.worldSeconds > 0).length;
  const hasActivity = worldTotal > 0;
  const maximumValue = Math.max(
    60,
    ...days.map((day) => Math.max(day.worldSeconds, playerSeconds(day))),
  );
  const maximum =
    [300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400, 115200].find(
      (limit) => limit >= maximumValue * 1.05,
    ) ?? Math.ceil(maximumValue / 3600) * 3600;
  const worldValues = days.map((day) =>
    isRecorded(day) ? day.worldSeconds : null,
  );
  const personalValues = days.map((day) =>
    isRecorded(day) ? playerSeconds(day) : null,
  );

  useEffect(() => {
    setSelectedPlayer("");
    setActiveStart(null);
  }, [history?.worldId]);

  const moveDay = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "ArrowRight"
        ? Math.min(index + 1, days.length - 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? days.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>(".playtime-day")
      [next]?.focus();
  };

  return (
    <Card
      className="world-history playtime-history"
      title="Time together"
      action={
        <div className="history-header-actions">
          <div className="segment" aria-label="Playtime date range">
            {([7, 30] as const).map((count) => (
              <button
                type="button"
                key={count}
                aria-pressed={range === count}
                onClick={() => setRange(count)}
              >
                {count} days
              </button>
            ))}
          </div>
          {onRefresh && (
            <Button
              kind="icon ghost"
              ariaLabel="Refresh playtime"
              disabled={loading}
              onClick={onRefresh}
            >
              <Icon name="refresh" size={16} />
            </Button>
          )}
        </div>
      }
    >
      <p className="history-caption">
        Time with someone in your world, remembered day by day.
      </p>
      <div className="playtime-toolbar">
        <div
          className="playtime-totals"
          aria-label="Playtime in selected period"
        >
          <div>
            <span className="playtime-total-label">
              <i className="playtime-key world" />
              World activity
            </span>
            <strong>{history ? formatPlaytime(worldTotal) : "—"}</strong>
          </div>
          {player ? (
            <div>
              <span className="playtime-total-label">
                <i className="playtime-key player" />
                {player.name}
              </span>
              <strong>{formatPlaytime(personalTotal)}</strong>
            </div>
          ) : (
            <div>
              <span className="playtime-total-label">Days played</span>
              <strong>
                {history ? activeDays : "—"}
                <small> / {range}</small>
              </strong>
            </div>
          )}
        </div>
        <label className="playtime-player-picker" htmlFor={`${id}-player`}>
          <span>Compare a player</span>
          <Select
            id={`${id}-player`}
            aria-label="Compare a player"
            value={player?.id ?? ""}
            onValueChange={setSelectedPlayer}
            disabled={!history?.players.length}
            options={[
              { value: "", label: "World activity only" },
              ...(history?.players ?? []).map((entry) => ({
                value: entry.id,
                label: playerLabel(entry),
              })),
            ]}
          />
        </label>
      </div>
      {hasActivity ? (
        <>
          <div className="playtime-plot-shell">
            <div className="playtime-y-axis" aria-hidden="true">
              {[1, 0.5, 0].map((fraction) => (
                <span key={fraction}>{formatPlaytime(maximum * fraction)}</span>
              ))}
            </div>
            <div className="playtime-plot-body">
              <div className="playtime-plot">
                <svg
                  viewBox={`0 0 ${plotWidth} ${plotHeight + 2}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id={`${id}-area`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop stopColor="var(--violet)" stopOpacity="0.16" />
                      <stop
                        offset="1"
                        stopColor="var(--violet)"
                        stopOpacity="0.01"
                      />
                    </linearGradient>
                  </defs>
                  {[plotTop, (plotHeight + plotTop) / 2, plotHeight].map(
                    (y) => (
                      <line
                        className="playtime-grid"
                        key={y}
                        x1="0"
                        x2={plotWidth}
                        y1={y}
                        y2={y}
                      />
                    ),
                  )}
                  <path
                    d={plotPath(worldValues, maximum, true)}
                    fill={`url(#${id}-area)`}
                  />
                  <path
                    className="playtime-line world"
                    d={plotPath(worldValues, maximum)}
                  />
                  {player && (
                    <path
                      className="playtime-line player"
                      d={plotPath(personalValues, maximum)}
                    />
                  )}
                  {days.map(
                    (day, index) =>
                      isRecorded(day) && (
                        <g key={day.start}>
                          <circle
                            className="playtime-point world"
                            cx={((index + 0.5) / days.length) * plotWidth}
                            cy={
                              plotHeight -
                              (day.worldSeconds / maximum) *
                                (plotHeight - plotTop)
                            }
                            r={index === inspectedIndex ? 4 : 2}
                          />
                          {player && (
                            <circle
                              className="playtime-point player"
                              cx={((index + 0.5) / days.length) * plotWidth}
                              cy={
                                plotHeight -
                                (playerSeconds(day) / maximum) *
                                  (plotHeight - plotTop)
                              }
                              r={index === inspectedIndex ? 4 : 2}
                            />
                          )}
                        </g>
                      ),
                  )}
                </svg>
                <div
                  className="playtime-day-targets"
                  role="group"
                  aria-label="Daily playtime. Use left and right arrow keys to explore days."
                >
                  {days.map((day, index) => (
                    <button
                      className="playtime-day"
                      key={day.start}
                      type="button"
                      tabIndex={index === inspectedIndex ? 0 : -1}
                      data-inspected={index === inspectedIndex}
                      aria-label={`${dayLabel(day.start, true)}: ${isRecorded(day) ? `world activity ${exactPlaytime(day.worldSeconds)}${player ? `, ${playerLabel(player)} ${exactPlaytime(playerSeconds(day))}` : ""}` : "before recording began"}`}
                      onFocus={() => setActiveStart(day.start)}
                      onMouseEnter={() => setActiveStart(day.start)}
                      onClick={() => setActiveStart(day.start)}
                      onKeyDown={(event) => moveDay(event, index)}
                    />
                  ))}
                </div>
              </div>
              <div
                className={`playtime-x-axis ${range === 30 ? "month" : "week"}`}
                aria-hidden="true"
              >
                {days.map((day, index) => (
                  <span
                    key={day.start}
                    data-visible={
                      range === 7 ||
                      index % 5 === 0 ||
                      index === days.length - 1
                    }
                  >
                    {dayLabel(day.start)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div
            className="playtime-inspected"
            aria-live="polite"
            aria-atomic="true"
          >
            <time
              dateTime={
                inspected
                  ? new Date(inspected.start * 1000).toISOString()
                  : undefined
              }
            >
              {inspected ? dayLabel(inspected.start, true) : ""}
            </time>
            <span>
              {inspected && isRecorded(inspected) ? (
                <>
                  <span className="playtime-reading">
                    <i className="playtime-key world" />
                    World{" "}
                    <strong>{exactPlaytime(inspected.worldSeconds)}</strong>
                  </span>
                  {player && (
                    <span className="playtime-reading">
                      <i className="playtime-key player" />
                      {player.name}{" "}
                      <strong>{exactPlaytime(playerSeconds(inspected))}</strong>
                    </span>
                  )}
                </>
              ) : (
                "Before recording began"
              )}
            </span>
          </div>
        </>
      ) : (
        <div className="history-empty playtime-empty" role="status">
          <span className="history-empty-icon">
            <Icon name="spark" size={28} accent />
          </span>
          <strong>
            {loading && !history
              ? "Loading your play history…"
              : error && !history
                ? "Play history is unavailable."
                : trackingUnavailable
                  ? "Waiting for Minecraft’s player list."
                  : history?.recordedFrom != null
                    ? `No recorded playtime in these ${range} days.`
                    : "Adventures will leave a trail here."}
          </strong>
          <p>
            {error && !history
              ? "Try refreshing to load the recorded activity."
              : trackingUnavailable
                ? "Recording resumes when Minecraft confirms who is connected. Your recorded playtime is kept."
                : history?.recordedFrom != null
                  ? "Connect a player to add time here. Earlier sessions may be outside this date range."
                  : "Connect a player to this world to start recording. Only time spent connected counts."}
          </p>
        </div>
      )}
      <div className="playtime-footnote">
        <span>
          World time counts once when players overlap. Connected time includes
          AFK. Unobserved time is not counted.
        </span>
        <span>
          {history?.recordedFrom != null
            ? `Recording since ${dayLabel(history.recordedFrom)} · your local time`
            : "Recording starts with this update. Earlier playtime is unavailable."}
        </span>
        {player && !player.verified && (
          <span>Offline names identify a name, not a verified account.</span>
        )}
      </div>
      <div className="history-feedback" role={error ? "alert" : "status"}>
        {error ||
          (trackingUnavailable
            ? "Waiting for Minecraft’s player list; unobserved time is not counted."
            : loading && history
              ? "Updating playtime…"
              : "")}
      </div>
      {hasActivity && (
        <details className="playtime-data">
          <summary>View daily values</summary>
          <div className="playtime-table-scroll">
            <table>
              <caption>Connected playtime in your local calendar days</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">World activity</th>
                  {player && <th scope="col">{playerLabel(player)}</th>}
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((day) => (
                  <tr key={day.start}>
                    <th scope="row">{dayLabel(day.start, true)}</th>
                    <td>
                      {isRecorded(day)
                        ? exactPlaytime(day.worldSeconds)
                        : "Not recorded"}
                    </td>
                    {player && (
                      <td>
                        {isRecorded(day)
                          ? exactPlaytime(playerSeconds(day))
                          : "Not recorded"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
