import { memo, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./WorldBlock.css";

/** Original Enderlink artwork. The patterns do not use Minecraft textures. */
export const BLOCK_KINDS = [
  {
    id: "amethyst",
    label: "Amethyst",
    description: "A little violet crystal, cut by starlight.",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    description: "Dark stone with a hint of pink beneath the surface.",
  },
  {
    id: "rose-quartz",
    label: "Rose quartz",
    description: "Soft pink facets and bright mineral veins.",
  },
  {
    id: "moonstone",
    label: "Moonstone",
    description: "A pale, cratered piece of a faraway moon.",
  },
  {
    id: "endstone",
    label: "End stone",
    description: "Weathered violet stone from somewhere beyond.",
  },
  {
    id: "glowstone",
    label: "Glowstone",
    description: "Warm pink light caught inside a mosaic of stone.",
  },
  {
    id: "crystal-glass",
    label: "Crystal glass",
    description: "Clear violet glass with a floating crystal inside.",
  },
  {
    id: "rose-glass",
    label: "Rose glass",
    description: "Rose-tinted glass, edged with a little neon.",
  },
  {
    id: "void-core",
    label: "Void core",
    description: "A quiet dark cube with a bright, geometric heart.",
  },
  {
    id: "starfield",
    label: "Starfield",
    description: "A tiny pocket of the night sky.",
  },
  {
    id: "pink-ore",
    label: "Pink ore",
    description: "Rose-colored mineral clusters in dark rock.",
  },
  {
    id: "moss",
    label: "Violet moss",
    description: "Soft violet growth over layered midnight stone.",
  },
  {
    id: "bricks",
    label: "Dusk bricks",
    description: "A tiny piece of a castle in pink and purple.",
  },
  {
    id: "circuit",
    label: "Circuit",
    description: "Bright trails linking a miniature purple machine.",
  },
  {
    id: "runes",
    label: "Runestone",
    description: "Original luminous markings on an ancient cube.",
  },
  {
    id: "portal",
    label: "Portal",
    description: "Nested neon doorways leading a little further in.",
  },
  {
    id: "pumpkin",
    label: "Pumpkin",
    description: "A friendly carved pumpkin glowing in shades of rose.",
  },
  {
    id: "cake",
    label: "Cake",
    description: "Pink icing, little berries, and a reason to celebrate.",
  },
  {
    id: "mushroom",
    label: "Mushroom",
    description: "A spotted violet cap from a moonlit mushroom grove.",
  },
  {
    id: "lantern",
    label: "Lantern",
    description: "A little pink flame to guide everyone home.",
  },
] as const;

export type WorldBlockKind = (typeof BLOCK_KINDS)[number]["id"];
type Face = "front" | "back" | "right" | "left" | "top" | "bottom";
const FACES: readonly Face[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];
const PREVIEW_FACES: readonly Face[] = ["front", "right", "top"];
const PREVIEW_GLASS_FACES: readonly Face[] = FACES;

type Palette = {
  base: string;
  dark: string;
  mid: string;
  light: string;
  glow: string;
  glass?: string;
};
const PALETTES: Record<WorldBlockKind, Palette> = {
  amethyst: {
    base: "#65358f",
    dark: "#331a50",
    mid: "#9751be",
    light: "#d29bee",
    glow: "#f0b3f0",
  },
  obsidian: {
    base: "#24202e",
    dark: "#100d1a",
    mid: "#46304f",
    light: "#85618f",
    glow: "#eb6bc6",
  },
  "rose-quartz": {
    base: "#c56bba",
    dark: "#793e7e",
    mid: "#e59ed3",
    light: "#ffddf1",
    glow: "#ffeaf9",
  },
  moonstone: {
    base: "#a08fb9",
    dark: "#5b4e77",
    mid: "#c0afcf",
    light: "#e5d6f1",
    glow: "#fce6ff",
  },
  endstone: {
    base: "#795d9d",
    dark: "#49345f",
    mid: "#9e7eb7",
    light: "#ccb2de",
    glow: "#ecd0ff",
  },
  glowstone: {
    base: "#492336",
    dark: "#241726",
    mid: "#a44d83",
    light: "#f8a2d5",
    glow: "#ffe0f0",
  },
  "crystal-glass": {
    base: "#493665",
    dark: "#53406f",
    mid: "#917ac8",
    light: "#e0c5ff",
    glow: "#f1dcff",
    glass: "#9b75df24",
  },
  "rose-glass": {
    base: "#63374f",
    dark: "#663f62",
    mid: "#cb76b8",
    light: "#ffbfe6",
    glow: "#ffe4f5",
    glass: "#ef80c321",
  },
  "void-core": {
    base: "#211b32",
    dark: "#100d1b",
    mid: "#493367",
    light: "#b888ea",
    glow: "#ff9de4",
  },
  starfield: {
    base: "#2b2049",
    dark: "#150f27",
    mid: "#543669",
    light: "#c88ddb",
    glow: "#ffb5e9",
  },
  "pink-ore": {
    base: "#3b2c4b",
    dark: "#1e172a",
    mid: "#69516e",
    light: "#c966aa",
    glow: "#ffa2dc",
  },
  moss: {
    base: "#48304f",
    dark: "#251c33",
    mid: "#846095",
    light: "#c883c4",
    glow: "#e8a6e0",
  },
  bricks: {
    base: "#3b244d",
    dark: "#26182f",
    mid: "#795082",
    light: "#b270a8",
    glow: "#edadd6",
  },
  circuit: {
    base: "#31223e",
    dark: "#191421",
    mid: "#573365",
    light: "#b36bc6",
    glow: "#f8a6e4",
  },
  runes: {
    base: "#513d6a",
    dark: "#2a203b",
    mid: "#745188",
    light: "#bf8ed2",
    glow: "#ffc7ee",
  },
  portal: {
    base: "#281c42",
    dark: "#100b20",
    mid: "#73409c",
    light: "#c56ce2",
    glow: "#ffa4e7",
  },
  pumpkin: {
    base: "#a24787",
    dark: "#40213f",
    mid: "#cf65a9",
    light: "#f99cce",
    glow: "#ffe2f1",
  },
  cake: {
    base: "#94517b",
    dark: "#4b294a",
    mid: "#c47fa7",
    light: "#f1b4d5",
    glow: "#ffe6f3",
  },
  mushroom: {
    base: "#a14f9a",
    dark: "#4b2b60",
    mid: "#c776b4",
    light: "#e5b5e2",
    glow: "#fbe0f0",
  },
  lantern: {
    base: "#2d213b",
    dark: "#150f23",
    mid: "#6e447c",
    light: "#e780be",
    glow: "#ffd4ed",
  },
};

function knownKind(value: string | null | undefined): WorldBlockKind | null {
  return BLOCK_KINDS.find((block) => block.id === value)?.id ?? null;
}

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return result >>> 0;
}

function motionStyle(seed: string): CSSProperties {
  const sample = (suffix: string) => hash(`${seed}:${suffix}`) / 0xffffffff;
  return {
    "--block-turn-duration": `${34 + sample("turn") * 22}s`,
    "--block-float-duration": `${10 + sample("float") * 7}s`,
    "--block-turn-delay": `${-sample("turn-phase") * 52}s`,
    "--block-float-delay": `${-sample("float-phase") * 16}s`,
    "--block-turn-direction": sample("direction") > 0.5 ? "normal" : "reverse",
    "--block-drift-left": `${-3 - sample("left") * 3}px`,
    "--block-drift-right": `${3 + sample("right") * 4}px`,
    "--block-drift-up": `${-3 - sample("up") * 3}px`,
    "--block-drift-down": `${2 + sample("down") * 2}px`,
  } as CSSProperties;
}

/** Simple SVG marks on a six-sided cube; the top and sides share one palette. */
function Pattern({ kind, face }: { kind: WorldBlockKind; face: Face }) {
  const p = PALETTES[kind];
  const top = face === "top";
  const bottom = face === "bottom";
  let pattern: ReactNode;

  switch (kind) {
    case "amethyst":
      pattern = (
        <>
          <path d="M0 0H32L20 23 0 36Z M64 12V64L39 44Z" fill={p.dark} />
          <path
            d="M32 0 64 12 39 44 20 23Z M0 36 20 23 39 44 13 64H0Z"
            fill={p.mid}
          />
          <path
            d="M32 0 20 23 39 44Z M39 44 64 64H13Z"
            fill={p.light}
            opacity=".6"
          />
          <path
            d="M32 0 20 23 39 44 64 12 M20 23 0 36 M39 44 13 64"
            fill="none"
            stroke={p.glow}
            strokeWidth="1.2"
            opacity=".58"
          />
          <path d="M21 22 31 9 27 26Z" fill={p.glow} opacity=".55" />
        </>
      );
      break;
    case "obsidian":
      pattern = (
        <>
          <path
            d="M4 5 27 2 23 18 6 26Z M35 4 61 7 53 26 32 19Z M3 36 22 27 36 42 21 60 3 55Z M40 31 61 34 58 58 34 61 43 47Z"
            fill={p.mid}
            opacity=".65"
          />
          <path
            d="M0 30 27 23 31 0 M27 23 40 33 64 28 M40 33 30 50 34 64"
            fill="none"
            stroke={p.dark}
            strokeWidth="4"
          />
          <path
            d="M9 28 27 23 31 10 M27 23 40 33 55 30 M40 33 33 46"
            fill="none"
            stroke={p.glow}
            strokeWidth="1.3"
            opacity=".8"
          />
          <path
            d="m8 8 14-2 M41 38l13 2 M8 45l8-3"
            stroke={p.light}
            strokeWidth="1.2"
            opacity=".5"
          />
        </>
      );
      break;
    case "rose-quartz":
      pattern = (
        <>
          <path
            d="M0 0H27L13 31 0 40Z M64 0 35 19 47 44 64 29Z M13 31 27 64H0V40Z"
            fill={p.mid}
          />
          <path
            d="M27 0 35 19 13 31Z M47 44 64 29V64H37Z"
            fill={p.dark}
            opacity=".5"
          />
          <path
            d="M0 40 13 31 35 19 27 0 M13 31 27 64 M35 19 47 44 64 54"
            fill="none"
            stroke={p.light}
            strokeWidth="3"
          />
          <path
            d="m6 40 10-5 17-8 M43 43l8 5"
            fill="none"
            stroke={p.glow}
            strokeWidth="1.1"
          />
        </>
      );
      break;
    case "moonstone":
      pattern = (
        <>
          <path
            d="M0 7 25 0 23 14 6 22 0 20Z M33 37 64 28V45L43 56 28 49Z"
            fill={p.light}
            opacity=".35"
          />
          {[
            [15, 37, 9],
            [43, 16, 7],
            [49, 48, 4],
            [12, 13, 3],
            [29, 56, 3],
          ].map(([x, y, r]) => (
            <g key={x}>
              <path
                d={`M${x - r} ${y - r / 2} ${x - r / 2} ${y - r}H${x + r / 2}L${x + r} ${y - r / 2}V${y + r / 2}L${x + r / 2} ${y + r}H${x - r / 2}L${x - r} ${y + r / 2}Z`}
                fill={p.dark}
                opacity=".5"
              />
              <path
                d={`M${x - r} ${y + r / 2} ${x - r / 2} ${y + r}H${x + r / 2}L${x + r} ${y + r / 2}`}
                fill="none"
                stroke={p.light}
                strokeWidth="2"
              />
            </g>
          ))}
          <path d="M29 28h3v3h-3z M56 7h2v2h-2z M5 54h2v2H5z" fill={p.glow} />
        </>
      );
      break;
    case "endstone":
      pattern = (
        <>
          <path
            d="M0 7h19v12H0z M32 0h16v9H32z M39 25h25v13H39z M13 48h25v16H13z"
            fill={p.mid}
            opacity=".7"
          />
          {[
            [8, 10, 7],
            [33, 15, 6],
            [52, 9, 4],
            [17, 34, 5],
            [48, 44, 8],
            [5, 54, 5],
            [29, 55, 4],
          ].map(([x, y, w]) => (
            <g key={x}>
              <path
                d={`M${x} ${y}h${w}v${w - 2}h${-w}Z`}
                fill={p.dark}
                opacity=".7"
              />
              <path
                d={`M${x - 1} ${y + w}h${w + 2}`}
                stroke={p.light}
                strokeWidth="2"
                opacity=".7"
              />
            </g>
          ))}
        </>
      );
      break;
    case "glowstone":
      pattern = (
        <>
          <path
            d="M3 4h18v14H3z M25 2h20v11H25z M48 5h13v20H48z M5 22h12v18H5z M21 18h23v24H21z M49 30h12v14H49z M2 45h19v15H2z M25 47h15v14H25z M44 49h18v12H44z"
            fill={p.mid}
          />
          <path
            d="M6 7h12v7H6z M28 4h13v6H28z M51 9h7v12h-7z M8 25h6v10H8z M25 22h15v16H25z M52 33h6v7h-6z M6 49h12v8H6z M28 50h8v8h-8z M48 52h11v6H48z"
            fill={p.light}
          />
          <path
            d="M7 7h8v3H7z M26 23h11v6H26z M8 50h8v3H8z M51 53h6v2h-6z"
            fill={p.glow}
          />
        </>
      );
      break;
    case "crystal-glass":
    case "rose-glass":
      pattern = (
        <>
          <path
            d="M2 2h60v60H2Z"
            fill="none"
            stroke={p.light}
            strokeWidth="2.2"
            opacity=".8"
          />
          <path d="M7 7h50v50H7Z" fill="none" stroke={p.mid} opacity=".45" />
          <path
            d="M10 26 26 10h7L10 33Z M38 54 54 38v7l-9 9Z"
            fill={p.light}
            opacity=".45"
          />
          {kind === "crystal-glass" ? (
            <>
              <path d="m32 20 10 12-10 12-10-12Z" fill={p.mid} opacity=".58" />
              <path d="m32 20 10 12H32Z" fill={p.glow} opacity=".7" />
              <path d="M32 32v12L22 32Z" fill={p.light} opacity=".7" />
            </>
          ) : (
            <path
              d="m32 21 11 11-11 11-11-11Z m0 6 5 5-5 5-5-5Z"
              fill={p.glow}
              fillRule="evenodd"
              opacity=".5"
            />
          )}
          <path
            d="M2 15V2h13 M49 62h13V49"
            fill="none"
            stroke={p.glow}
            strokeWidth="2"
          />
        </>
      );
      break;
    case "void-core":
      pattern = (
        <>
          <path
            d="M3 3h58v58H3Z M9 9h46v46H9Z"
            fill="none"
            stroke={p.mid}
            strokeWidth="2"
          />
          <path
            d="m32 10 22 22-22 22-22-22Z"
            fill={p.dark}
            stroke={p.light}
            strokeWidth="1.5"
          />
          <path d="m32 20 12 12-12 12-12-12Z" fill={p.mid} />
          <path d="m32 25 7 7-7 7-7-7Z" fill={p.glow} />
          <path
            d="M32 2v7 M32 55v7 M2 32h7 M55 32h7"
            stroke={p.glow}
            strokeWidth="2"
          />
        </>
      );
      break;
    case "starfield":
      pattern = (
        <>
          <path
            d="M0 36 22 22 43 34 64 16V36L43 52 20 43 0 55Z"
            fill={p.mid}
            opacity=".35"
          />
          <path
            d="m19 11 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z M45 35l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"
            fill={p.glow}
          />
          <path
            d="M7 34h3v3H7z M47 9h2v2h-2z M31 30h2v2h-2z M23 51h3v3h-3z M57 53h2v2h-2z M6 58h2v2H6z M36 7h2v2h-2z"
            fill={p.light}
          />
          <path d="m26 45 2 2-2 2-2-2Z m30-22 2 2-2 2-2-2Z" fill={p.glow} />
        </>
      );
      break;
    case "pink-ore":
      pattern = (
        <>
          <path
            d="M0 9 18 4 26 17 11 26 0 24Z M36 3 64 11V30L48 27 34 14Z M0 45 23 36 38 56 32 64H0Z M42 36 64 35V64H47Z"
            fill={p.mid}
            opacity=".45"
          />
          <path
            d="m14 12 9 3 3 8-8 4-7-5Z m27 8 7-4 9 5-3 9-9-1Z M34 43l8-8 9 5-2 12-10 4Z M10 47l8-3 6 9-8 7-7-5Z"
            fill={p.dark}
          />
          <path
            d="m15 14 7 3 1 5-6 2-4-4Z m29 7 4-2 6 4-3 5-5-1Z m-7 23 6-6 5 4-2 8-6 3Z m-25 4 5-1 4 5-5 5-4-3Z"
            fill={p.light}
          />
          <path
            d="m15 14 7 3-5 3-4-1Z m22 30 6-6 1 6-4 3Z m7-23 4-2 6 4-5 1Z"
            fill={p.glow}
          />
        </>
      );
      break;
    case "moss":
      pattern = top ? (
        <>
          <path d="M0 0h64v64H0Z" fill={p.mid} />
          <path
            d="M3 8h18v8H3z M28 2h17v12H28z M48 20h16v17H48z M17 30h21v13H17z M0 46h12v18H0z M34 51h20v13H34z"
            fill={p.light}
          />
          <path
            d="M10 12h6v3h-6z M30 6h8v4h-8z M26 34h5v4h-5z M40 54h7v3h-7z M51 25h7v4h-7z"
            fill={p.glow}
          />
        </>
      ) : (
        <>
          <path
            d="M0 31h14v7h18v-6h32v12H49v8H19v-6H0Z M0 57h24v-5h13v7h27v5H0Z"
            fill={p.mid}
            opacity=".4"
          />
          {!bottom && (
            <>
              <path d="M0 0h64v13H53v7H39V12H25v10H10v-8H0Z" fill={p.mid} />
              <path d="M0 0h64v7H48v6H38V6H22v8H11V6H0Z" fill={p.light} />
              <path d="M9 3h9v3H9z M34 2h9v3h-9z M55 3h6v3h-6z" fill={p.glow} />
            </>
          )}
          <path
            d="M8 42h8v2H8z M40 28h11v2H40z M47 55h8v2h-8z"
            fill={p.light}
            opacity=".5"
          />
        </>
      );
      break;
    case "bricks":
      pattern = (
        <>
          <path
            d="M2 2h27v17H2z M33 2h29v17H33z M2 23h12v17H2z M18 23h29v17H18z M51 23h11v17H51z M2 44h27v18H2z M33 44h29v18H33z"
            fill={p.mid}
          />
          <path
            d="M4 4h23v3H4z M35 4h25v3H35z M20 25h25v3H20z M4 46h23v3H4z M35 46h25v3H35z"
            fill={p.light}
          />
          <path
            d="M5 17h20 M36 17h23 M21 38h22 M5 60h20 M36 60h23"
            stroke={p.dark}
            strokeWidth="2"
          />
          <path
            d="M21 10h5v3h-5z M39 32h5v3h-5z M39 52h6v3h-6z"
            fill={p.glow}
            opacity=".3"
          />
        </>
      );
      break;
    case "circuit":
      pattern = (
        <>
          <path d="M2 2h60v60H2Z" fill="none" stroke={p.mid} strokeWidth="2" />
          <path
            d="M0 16h15v16h14 M64 48H49V32H35 M32 0v15h16v10 M32 64V49H16V39"
            fill="none"
            stroke={p.light}
            strokeWidth="2"
          />
          <path
            d="M0 9h22v12 M64 55H42V43 M55 0v18 M9 64V46"
            fill="none"
            stroke={p.mid}
            strokeWidth="2"
          />
          <path
            d="M24 24h16v16H24Z"
            fill={p.dark}
            stroke={p.glow}
            strokeWidth="2"
          />
          <path
            d="M29 29h6v6h-6z M45 22h6v6h-6z M13 36h6v6h-6z M19 18h6v6h-6z M39 40h6v6h-6z"
            fill={p.glow}
          />
        </>
      );
      break;
    case "runes":
      pattern = (
        <>
          <path
            d="M6 2 2 24l7 15-5 23 M58 2l4 20-8 17 6 23"
            fill="none"
            stroke={p.dark}
            strokeWidth="3"
          />
          <path
            d="M12 8h40v48H12Z"
            fill="none"
            stroke={p.mid}
            strokeWidth="2"
          />
          <path
            d={
              top || bottom
                ? "m32 16 16 16-16 16-16-16Z M24 24l16 16 M40 24 24 40"
                : "M24 46V18l16 11-16 8 M40 18v28 M19 22l5-4 5 4 M35 42l5 4 5-4"
            }
            fill="none"
            stroke={p.glow}
            strokeWidth="2.5"
            strokeLinejoin="miter"
          />
          <path d="M18 12h3v2h-3z M43 50h3v2h-3z" fill={p.light} />
        </>
      );
      break;
    case "portal":
      pattern = (
        <>
          <path d="M0 0h64v64H0Z" fill={p.dark} />
          <path d="M4 4h56v56H4Z" fill="none" stroke={p.mid} strokeWidth="4" />
          <path
            d="M11 11h42v42H11Z"
            fill="none"
            stroke={p.light}
            strokeWidth="2.5"
          />
          <path
            d="M18 18h28v28H18Z"
            fill={p.base}
            stroke={p.glow}
            strokeWidth="2"
          />
          <path
            d="M25 25h14v14H25Z"
            fill="none"
            stroke={p.mid}
            strokeWidth="2"
          />
          <path
            d="M12 12h12 M12 12v12 M52 52H40 M52 52V40"
            stroke={p.glow}
            strokeWidth="2"
          />
          <path d="M30 30h4v4h-4z" fill={p.glow} />
        </>
      );
      break;
    case "pumpkin":
      pattern =
        top || bottom ? (
          <>
            <path d="M0 0h64v64H0Z" fill={p.mid} />
            <path
              d="M4 0h8l11 24-7 3Z M29 0h6v22h-6Z M52 0h8L46 27l-6-3Z M0 30h22v5H0Z M42 30h22v5H42Z M4 64h8l11-24-7-3Z M29 64h6V42h-6Z M52 64h8L46 37l-6 3Z"
              fill={p.base}
            />
            <path d="M23 23h18v18H23Z" fill={p.dark} />
            <path d="M27 25h11v12H27Z M31 20h6v6h-6Z" fill={p.base} />
            <path d="M29 25h3v9h-3Z" fill={p.light} />
          </>
        ) : (
          <>
            <path
              d="M4 0h9v64H4Z M25 0h14v64H25Z M51 0h9v64h-9Z"
              fill={p.mid}
            />
            <path
              d="M5 4h3v56H5Z M27 3h4v57h-4Z M53 5h3v55h-3Z"
              fill={p.light}
              opacity=".45"
            />
            <path d="M0 0h64v5H0Z M0 59h64v5H0Z" fill={p.dark} opacity=".25" />
            {face === "front" && (
              <>
                <path
                  d="m12 16 13 12H10Z M52 16 39 28h15Z M29 28h6v7h-6Z M10 38h11v7h7v-5h8v5h7v-7h11v11l-9 7H19l-9-7Z"
                  fill={p.dark}
                />
                <path
                  d="m14 20 6 6h-7Z m36 0-6 6h7Z M13 41h5v7h13v-5h2v5h13v-7h5v6l-8 6H21l-8-6Z"
                  fill={p.glow}
                />
              </>
            )}
          </>
        );
      break;
    case "cake":
      pattern = top ? (
        <>
          <path d="M0 0h64v64H0Z" fill={p.light} />
          <path d="M3 3h58v58H3Z" fill={p.glow} />
          <path
            d="M9 10h11v3H9Z M43 14h12v3H43Z M26 30h12v3H26Z M9 48h10v3H9Z M43 46h10v3H43Z"
            fill={p.mid}
            opacity=".5"
          />
          {[
            [16, 21],
            [44, 29],
            [28, 48],
          ].map(([x, y]) => (
            <g key={x}>
              <path
                d={`M${x - 5} ${y - 5}h10v3h3v7h-3v3h-10v-3h-3v-7h3Z`}
                fill={p.base}
              />
              <path d={`M${x - 4} ${y - 3}h6v3h-6Z`} fill={p.light} />
              <path
                d={`M${x} ${y - 6}v-4h5`}
                fill="none"
                stroke={p.dark}
                strokeWidth="2"
              />
            </g>
          ))}
        </>
      ) : (
        <>
          <path d="M0 19h64v45H0Z" fill={p.mid} />
          <path d="M0 29h64v7H0Z M0 47h64v6H0Z" fill={p.light} />
          <path d="M0 37h64v4H0Z M0 57h64v7H0Z" fill={p.dark} opacity=".65" />
          <path
            d="M0 0h64v14h-7v8H47V12H35v6H24v-5H12v12H4v-9H0Z"
            fill={p.light}
          />
          <path d="M0 0h64v9H53v6h-4V7H32v5h-5V7H9v11H6V8H0Z" fill={p.glow} />
          <path
            d="M8 26h4v2H8Z M24 22h3v3h-3Z M48 26h5v2h-5Z M18 43h4v2h-4Z M43 43h3v2h-3Z M9 55h3v2H9Z"
            fill={p.base}
          />
        </>
      );
      break;
    case "mushroom":
      pattern = top ? (
        <>
          <path d="M0 0h64v64H0Z" fill={p.mid} />
          <path d="M0 0h64v5H5v59H0Z" fill={p.light} opacity=".28" />
          <path
            d="M9 8h12v4h4v9H9Z M38 5h14v13H38Z M25 29h14v13H25Z M46 38h12v4h4v12H46Z M6 46h11v12H6Z"
            fill={p.light}
          />
          <path
            d="M12 10h7v5h-7Z M40 7h8v4h-8Z M28 31h8v4h-8Z M49 41h7v5h-7Z M8 48h6v4H8Z"
            fill={p.glow}
          />
          <path d="M6 32h4v5H6Z M54 25h4v4h-4Z M31 54h5v4h-5Z" fill={p.base} />
        </>
      ) : (
        <>
          <path d="M0 0h64v42H0Z" fill={p.mid} />
          <path d="M0 33h64v10H0Z" fill={p.base} />
          <path d="M0 42h64v22H0Z" fill={p.light} />
          <path
            d="M4 44h5v20H4Z M17 44h4v20h-4Z M30 44h5v20h-5Z M44 44h4v20h-4Z M56 44h4v20h-4Z"
            fill={p.dark}
            opacity=".35"
          />
          <path d="M0 42h64v4H0Z M0 61h64v3H0Z" fill={p.glow} opacity=".65" />
          <path
            d="M7 8h12v13H7Z M36 4h14v11H36Z M26 24h11v10H26Z M53 23h11v9H53Z"
            fill={p.light}
          />
          <path d="M9 10h7v4H9Z M39 6h8v4h-8Z M28 26h6v3h-6Z" fill={p.glow} />
        </>
      );
      break;
    case "lantern":
      pattern =
        top || bottom ? (
          <>
            <path
              d="M3 3h58v58H3Z"
              fill={p.dark}
              stroke={p.mid}
              strokeWidth="3"
            />
            <path d="M11 11h42v42H11Z" fill={p.mid} />
            <path
              d="M18 18h28v28H18Z"
              fill={p.base}
              stroke={p.light}
              strokeWidth="2"
            />
            <path
              d="M24 24h16v16H24Z"
              fill="none"
              stroke={p.mid}
              strokeWidth="4"
            />
            <path
              d="M4 30h14v4H4Z M46 30h14v4H46Z M30 4h4v14h-4Z M30 46h4v14h-4Z"
              fill={p.dark}
            />
            <path
              d="M20 19h24 M19 20v24"
              fill="none"
              stroke={p.glow}
              strokeWidth="1"
              opacity=".7"
            />
          </>
        ) : (
          <>
            <path d="M9 10h46v44H9Z" fill={p.mid} />
            <path d="M13 14h38v36H13Z" fill={p.light} />
            <path d="m32 18 3 10 7 5v9l-10 5-10-5v-8l7-6Z" fill={p.glow} />
            <path d="m32 29 4 8-4 6-4-6Z" fill="#fff0f8" />
            <path
              d="M0 0h64v10H0Z M0 54h64v10H0Z M0 10h9v44H0Z M55 10h9v44h-9Z"
              fill={p.dark}
            />
            <path
              d="M4 4h56v3H4Z M4 57h56v3H4Z M4 10h3v44H4Z M57 10h3v44h-3Z"
              fill={p.mid}
            />
            <path
              d="M10 10 22 22 M54 10 42 22 M10 54l12-12 M54 54 42 42"
              stroke={p.base}
              strokeWidth="3"
            />
            <path
              d="M3 3h4v4H3Z M57 3h4v4h-4Z M3 57h4v4H3Z M57 57h4v4h-4Z"
              fill={p.light}
            />
          </>
        );
      break;
  }

  const shade =
    face === "top"
      ? 0
      : face === "bottom"
        ? 0.36
        : face === "right" || face === "back"
          ? 0.2
          : 0.06;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className="world-block-texture"
    >
      <rect width="64" height="64" fill="var(--block-surface)" />
      {pattern}
      <rect width="64" height="64" fill="#0e081b" opacity={shade} />
      <path
        d="M.5 63.5V.5h63"
        stroke={p.light}
        strokeWidth="1"
        fill="none"
        opacity=".32"
      />
    </svg>
  );
}

function Cube({
  kind,
  seed,
  decorative,
  preview,
  className,
}: {
  kind: WorldBlockKind;
  seed?: string;
  decorative: boolean;
  preview: boolean;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const palette = PALETTES[kind];
  const block = BLOCK_KINDS.find((item) => item.id === kind)!;
  useEffect(() => {
    if (preview || !root.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "30px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [preview]);
  const style = {
    ...motionStyle(`${seed || "enderlink"}:${kind}`),
    "--block-solid": palette.base,
    "--block-glass": palette.glass,
    "--block-halo": `${palette.glow}20`,
  } as CSSProperties;
  const faces = preview && !palette.glass ? PREVIEW_FACES : PREVIEW_GLASS_FACES;

  return (
    <span
      ref={root}
      className={`world-block${preview ? " world-block-preview" : ""}${className ? ` ${className}` : ""}`}
      data-kind={kind}
      data-material={palette.glass ? "glass" : "stone"}
      data-visible={visible}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${block.label} block`}
      aria-hidden={decorative || undefined}
      style={style}
    >
      <span className="world-block-drift">
        <span className="world-block-cube">
          {faces.map((face) => (
            <span
              key={face}
              className={`world-block-face world-block-face-${face}`}
            >
              <Pattern kind={kind} face={face} />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export const WorldBlock = memo(function WorldBlock({
  kind,
  seed,
  decorative = true,
  preview = false,
  className,
}: {
  kind: string | null | undefined;
  seed?: string;
  decorative?: boolean;
  preview?: boolean;
  className?: string;
}) {
  const valid = knownKind(kind);
  return valid ? (
    <Cube
      kind={valid}
      seed={seed}
      decorative={decorative}
      preview={preview}
      className={className}
    />
  ) : null;
});

export function WorldBlockPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null | undefined;
  onChange: (kind: WorldBlockKind | null) => void;
  disabled?: boolean;
}) {
  const groupId = useId();
  const selected = knownKind(value);
  const description = BLOCK_KINDS.find(
    (block) => block.id === selected,
  )?.description;
  const choices = [{ id: null, label: "None" }, ...BLOCK_KINDS];

  return (
    <fieldset
      className="world-block-picker"
      disabled={disabled}
      aria-describedby={`${groupId}-description`}
    >
      <legend>
        World artwork <span className="world-block-optional">Optional</span>
      </legend>
      <div className="world-block-picker-caption">
        <span>A little block to call your own.</span>
      </div>
      <div className="world-block-choices">
        {choices.map((choice) => (
          <label className="world-block-choice" key={choice.id || "none"}>
            <input
              type="radio"
              name={`${groupId}-block`}
              value={choice.id || "none"}
              checked={selected === choice.id}
              onChange={() => onChange(choice.id)}
              onFocus={(event) =>
                event.currentTarget.parentElement?.scrollIntoView?.({
                  block: "nearest",
                  inline: "nearest",
                  behavior: "auto",
                })
              }
            />
            <span className="world-block-choice-tile">
              <span className="world-block-choice-image" aria-hidden="true">
                {choice.id ? (
                  <WorldBlock kind={choice.id} preview />
                ) : (
                  <svg
                    width="29"
                    height="29"
                    viewBox="0 0 32 32"
                    fill="none"
                    className="world-block-none"
                  >
                    <rect
                      x="5"
                      y="5"
                      width="22"
                      height="22"
                      rx="5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M12 16h8"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </span>
              <span className="world-block-choice-label">{choice.label}</span>
              <svg
                className="world-block-choice-check"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m3 8 3 3 7-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </label>
        ))}
      </div>
      <p
        className="world-block-description"
        id={`${groupId}-description`}
        aria-live="polite"
      >
        {description || "Keep your cover simple, without a block."}
      </p>
    </fieldset>
  );
}
