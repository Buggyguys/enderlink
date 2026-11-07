import { Select } from "./Select";
import { useId } from "react";
import type { Snapshot } from "../types";
import { bytes } from "../api";
import { Icon } from "./Icons";
import { Card } from "./UI";
import "./MemoryPanel.css";

export function MemoryStatus({
  s,
  className = "",
}: {
  s: Snapshot;
  className?: string;
}) {
  const m = s.memory?.total ? s.memory : undefined;
  const total = m?.total || s.totalMemory;
  const known = (m?.app || 0) + (m?.server || 0) + (m?.minecraftClients || 0);
  // Process figures can include shared pages. Keep the bar within the OS total,
  // while the legend retains the actual process estimates.
  const scale = m && known > m.used && known > 0 ? m.used / known : 1;
  const parts = [
    {
      key: "system",
      label: "System & other apps",
      value: m ? bytes(m.other) : "—",
      bar: m ? Math.max(0, m.used - known) : 0,
    },
    {
      key: "app",
      label: "Enderlink",
      value: m ? bytes(m.app) : "—",
      bar: (m?.app || 0) * scale,
    },
    {
      key: "client",
      label: "Minecraft game",
      value: !m
        ? "—"
        : m.clientCount
          ? bytes(m.minecraftClients)
          : "Not detected",
      bar: (m?.minecraftClients || 0) * scale,
    },
    {
      key: "server",
      label: "Hosted server",
      value: !m ? "—" : s.session?.pid ? bytes(m.server) : "Stopped",
      bar: (m?.server || 0) * scale,
    },
    {
      key: "available",
      label: "Available",
      value: m ? bytes(m.available) : "—",
      bar: m?.available || 0,
    },
  ];

  return (
    <Card
      title="Computer memory"
      className={`memory-status ${className}`}
      action={<Icon name="memory" size={22} accent />}
    >
      <div className="memory-status-total">
        <p>
          <strong>{m ? bytes(m.used) : "—"}</strong>
          <span> / {total ? bytes(total) : "—"} in use</span>
        </p>
        <span className="memory-status-sample">
          {m ? (
            <>
              Updated{" "}
              <time dateTime={new Date(m.observedAt * 1000).toISOString()}>
                {new Date(m.observedAt * 1000).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            </>
          ) : (
            "Waiting for measurements"
          )}
        </span>
      </div>
      <div
        className="memory-status-bar"
        role="img"
        aria-label={
          m
            ? `Memory use: ${bytes(m.used)} of ${bytes(m.total)}. ${bytes(m.available)} available.`
            : "Waiting for system memory measurements"
        }
      >
        {parts.map((part) => (
          <span
            key={part.key}
            className={`memory-status-part memory-tone-${part.key}`}
            style={{
              width: `${m ? Math.max(0, Math.min(100, (part.bar / m.total) * 100)) : 0}%`,
            }}
          />
        ))}
      </div>
      <dl className="memory-status-legend">
        {parts.map((part) => (
          <div key={part.key}>
            <dt>
              <i
                className={`memory-status-swatch memory-tone-${part.key}`}
                aria-hidden="true"
              />
              {part.label}
            </dt>
            <dd>{part.value}</dd>
          </div>
        ))}
      </dl>
      <details className="memory-status-details">
        <summary>About these measurements</summary>
        <p>
          Updates about every five seconds. Process figures are estimates and
          may share memory. Some helpers and unrecognized Minecraft clients
          appear under System & other apps. Available includes reclaimable
          memory.
          {m?.partialProcessVisibility
            ? " Your OS hides some process details."
            : ""}
        </p>
      </details>
    </Card>
  );
}

export function MemorySettings({
  s,
  disabled,
  allocate,
}: {
  s: Snapshot;
  disabled: boolean;
  allocate: (mb: number) => void;
}) {
  const id = useId();
  const options = [
    ...new Set([
      1024,
      2048,
      3072,
      4096,
      6144,
      8192,
      12288,
      16384,
      24576,
      32768,
      s.settings.memoryMb,
    ]),
  ].sort((left, right) => left - right);
  return (
    <Card title="Default memory for new worlds" className="memory-settings">
      <div className="memory-settings-allocation">
        <label htmlFor={id}>Maximum server memory</label>
        <Select
          id={id}
          aria-label="Default memory for new worlds"
          aria-describedby={`${id}-description`}
          disabled={disabled}
          value={String(s.settings.memoryMb)}
          onValueChange={(value) => allocate(Number(value))}
          options={options.map((mb) => ({
            value: String(mb),
            label: `${mb / 1024} GB`,
          }))}
        />
      </div>
      <p className="memory-settings-copy" id={`${id}-description`}>
        A limit for the hosted server’s Java heap. Existing worlds keep their
        own setting; your Minecraft game uses the memory set in its launcher.
      </p>
      <details className="memory-settings-guide">
        <summary>
          <Icon name="info" size={15} />
          Allocation guide
        </summary>
        <table>
          <caption>Starting points for server memory</caption>
          <thead>
            <tr>
              <th scope="col">Your world</th>
              <th scope="col">Starting point</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Paper · a few friends</th>
              <td>2–4 GB</td>
            </tr>
            <tr>
              <th scope="row">Fabric · light mods</th>
              <td>4–6 GB</td>
            </tr>
            <tr>
              <th scope="row">Larger modpacks</th>
              <td>Follow the pack’s server requirements</td>
            </tr>
          </tbody>
        </table>
      </details>
    </Card>
  );
}
