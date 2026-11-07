import { useId, type CSSProperties } from "react";
export type IconName =
  | "host"
  | "join"
  | "settings"
  | "play"
  | "stop"
  | "copy"
  | "back"
  | "plus"
  | "more"
  | "close"
  | "refresh"
  | "terminal"
  | "trash"
  | "download"
  | "shield"
  | "storage"
  | "check"
  | "spark"
  | "memory"
  | "arrow"
  | "external"
  | "moon"
  | "layers"
  | "world"
  | "info";
const paths: Record<IconName, React.ReactNode> = {
  host: (
    <>
      <path d="m3 9 9-6 9 6v11H3Z" />
      <path d="M8 20v-8h8v8M6 7V4h3" />
    </>
  ),
  join: (
    <>
      <path d="M8 4H4v16h4M14 4h6v16h-6M8 12h9m-4-4 4 4-4 4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M8 3v6m8 0v6m-6 0v6" strokeWidth="3" />
    </>
  ),
  play: <path d="m7 4 13 8-13 8Z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  copy: (
    <>
      <path d="M8 6V3h13v14h-3" />
      <rect x="3" y="7" width="13" height="14" rx="2" />
    </>
  ),
  back: <path d="m10 5-7 7 7 7M3 12h18" />,
  plus: <path d="M12 4v16M4 12h16" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="m5 5 14 14M19 5 5 19" />,
  refresh: (
    <>
      <path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5M4 15a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m6 8 4 4-4 4m7 0h5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 3h6m-10 3 1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z" />
      <path d="m7 12 3 3 7-7" />
    </>
  ),
  storage: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  spark: (
    <>
      <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
      <path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z" />
    </>
  ),
  memory: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M8 2v3m8-3v3M8 19v3m8-3v3M2 8h3m-3 8h3M19 8h3m-3 8h3" />
    </>
  ),
  arrow: <path d="M3 12h18m-7-7 7 7-7 7" />,
  external: (
    <>
      <path d="M13 3h8v8M21 3 10 14M9 4H3v17h17v-6" />
    </>
  ),
  moon: <path d="M20 14A9 9 0 0 1 10 3a9.5 9.5 0 1 0 10 11Z" />,
  layers: (
    <>
      <path d="m12 2 10 5-10 5L2 7Zm-10 10 10 5 10-5M2 17l10 5 10-5" />
    </>
  ),
  world: (
    <>
      <path d="m12 2 10 6v9l-10 5-10-5V8Zm-10 6 10 6 10-6m-10 6v8M7 5l10 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  accent = false,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  accent?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`el-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={accent ? `url(#${id})` : "currentColor"}
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {accent && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ff8bda" />
            <stop offset="1" stopColor="#a78bff" />
          </linearGradient>
        </defs>
      )}
      {paths[name]}
    </svg>
  );
}
type Props = { size?: number };
export const Play = (p: Props) => <Icon name="play" {...p} />;
export const Square = (p: Props) => <Icon name="stop" {...p} />;
export const Copy = (p: Props) => <Icon name="copy" {...p} />;
export const ArrowLeft = (p: Props) => <Icon name="back" {...p} />;
export const Plus = (p: Props) => <Icon name="plus" {...p} />;
export const MoreHorizontal = (p: Props) => <Icon name="more" {...p} />;
export const X = (p: Props) => <Icon name="close" {...p} />;
export const RefreshCw = (p: Props) => <Icon name="refresh" {...p} />;
export const Terminal = (p: Props) => <Icon name="terminal" {...p} />;
export const Trash2 = (p: Props) => <Icon name="trash" {...p} />;
export const Download = (p: Props) => <Icon name="download" {...p} />;
export const ShieldCheck = (p: Props) => <Icon name="shield" {...p} />;
export const HardDrive = (p: Props) => <Icon name="storage" {...p} />;
export function EnderMark({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className="ender-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={id}
          x1="8"
          y1="6"
          x2="40"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff8cda" />
          <stop offset=".5" stopColor="#ee4fba" />
          <stop offset="1" stopColor="#9768ff" />
        </linearGradient>
      </defs>
      <g
        transform="rotate(-35 24 24)"
        stroke={`url(#${id})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M23 14H11a7 7 0 0 0-7 7v6a7 7 0 0 0 7 7h12a7 7 0 0 0 7-7v-1a2 2 0 0 0-2-2h-8a2 2 0 0 1-2-2v-1a7 7 0 0 1 7-7h12a7 7 0 0 1 7 7v6a7 7 0 0 1-7 7H25" />
      </g>
    </svg>
  );
}
