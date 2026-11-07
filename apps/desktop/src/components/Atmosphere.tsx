import { memo, type CSSProperties } from "react";
import type { Settings } from "../types";

// Independent seeded samples, never index-based coordinates. The same sky stays
// in place through navigation and polling; no frame loop or canvas is needed.
function makeSky() {
  let seed = 0x8e4d7c39;
  const random = () => {
    seed += 0x6d2b79f5;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const positions: { x: number; y: number }[] = [];
  return Array.from({ length: 88 }, () => {
    let x = 0,
      y = 0;
    // Avoid crowded points without introducing a grid or evenly spaced rows.
    for (let attempt = 0; attempt < 40; attempt++) {
      x = random() * 100;
      y = random() * 100;
      if (positions.every((p) => Math.hypot(x - p.x, y - p.y) > 4)) break;
    }
    positions.push({ x, y });
    const kind = random();
    const shape = kind < 0.65 ? "pixel" : kind < 0.87 ? "cross" : "diamond";
    const size =
      shape === "pixel"
        ? 1.6 + random() * 2.6
        : shape === "cross"
          ? 5 + random() * 5
          : 3 + random() * 3;
    const radius = 65 + random() * 95;
    const angle = random() * Math.PI * 2;
    const points = Array.from({ length: 4 }, (_, n) => {
      const a = angle + (n * Math.PI) / 2 + (random() - 0.5) * 0.6;
      return [
        Math.cos(a) * radius * (0.65 + random() * 0.35),
        Math.sin(a) * radius * (0.55 + random() * 0.45),
      ];
    });
    return {
      x,
      y,
      size,
      shape,
      points,
      duration: 34 + random() * 30,
      phase: random(),
      shimmer: 7 + random() * 9,
      opacity: 0.4 + random() * 0.5,
      colour: ["#deaaff", "#fda9df", "#bfa6ff", "#e8bef8"][
        Math.floor(random() * 4)
      ],
    };
  });
}
const sky = makeSky();
export const Atmosphere = memo(
  function Atmosphere({ settings }: { settings: Settings }) {
    const count =
      settings.starDensity === "low"
        ? 32
        : settings.starDensity === "high"
          ? 88
          : 56;
    const speed =
      settings.starSpeed === "slow"
        ? 0.5
        : settings.starSpeed === "lively"
          ? 1.8
          : 1;
    const motion = settings.starMotion || "wander";
    const distance = motion === "float" ? 0.3 : 1;
    return (
      <div className="atmosphere" aria-hidden="true">
        <div className="nebula" />
        {settings.stars !== false && (
          <div
            className="starfield"
            data-testid="starfield"
            data-motion={motion}
            data-shimmer={settings.starShimmer !== false}
          >
            {sky.slice(0, count).map((star, i) => (
              <i
                key={i}
                className={`end-star ${star.shape}`}
                style={
                  {
                    left: `${star.x.toFixed(3)}%`,
                    top: `${star.y.toFixed(3)}%`,
                    "--size": `${star.size.toFixed(2)}px`,
                    "--travel-duration": `${star.duration / speed}s`,
                    "--travel-delay": `${(-star.phase * star.duration) / speed}s`,
                    "--shimmer-duration": `${star.shimmer}s`,
                    "--shimmer-delay": `${-star.phase * star.shimmer}s`,
                    "--star-opacity": star.opacity,
                    "--star-colour": star.colour,
                    ...Object.fromEntries(
                      star.points.flatMap(([x, y], n) => [
                        [`--x${n}`, `${(x * distance).toFixed(2)}px`],
                        [`--y${n}`, `${(y * distance).toFixed(2)}px`],
                      ]),
                    ),
                  } as CSSProperties
                }
              >
                <span className="star-light" />
              </i>
            ))}
          </div>
        )}
      </div>
    );
  },
  (before, after) =>
    (
      [
        "stars",
        "starDensity",
        "starMotion",
        "starSpeed",
        "starShimmer",
      ] as const
    ).every((key) => before.settings[key] === after.settings[key]),
);
