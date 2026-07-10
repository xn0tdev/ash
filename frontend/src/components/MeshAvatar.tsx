import { useMemo } from "react";

// Generative, deterministic mesh-gradient avatar for background agents — a
// smooth blend of a few seeded hues in a rounded square, unique per agent (à la
// outpacestudios / Boring Avatars). Replaces the dot-matrix grid loader; the
// "working" state drifts the gradient gently, "waiting" desaturates it.

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MeshAvatarProps {
  /** Stable per-agent seed (its id) — the same seed always renders the same blob. */
  seed: string;
  size?: number;
  /** Gentle gradient drift while the agent is actively working. */
  animating?: boolean;
  /** Desaturated + dim for a not-yet-started (waiting) reservation. */
  muted?: boolean;
}

// Four colour spots, one per corner, spread around a seeded base hue.
const SPOTS = [
  { x: 22, y: 20, dh: 0 },
  { x: 82, y: 24, dh: 45 },
  { x: 24, y: 84, dh: 205 },
  { x: 80, y: 80, dh: 150 },
];

export default function MeshAvatar({ seed, size = 16, animating = false, muted = false }: MeshAvatarProps) {
  const bg = useMemo(() => {
    const rnd = mulberry32(hashSeed(seed));
    const base = rnd() * 360;
    const layers = SPOTS.map((s) => {
      const hue = (base + s.dh + rnd() * 30) % 360;
      const sat = 60 + rnd() * 20;
      const light = 50 + rnd() * 16;
      const reach = 52 + rnd() * 22;
      return `radial-gradient(circle at ${s.x}% ${s.y}%, hsl(${hue} ${sat}% ${light}%) 0%, transparent ${reach}%)`;
    });
    return {
      backgroundImage: layers.join(","),
      backgroundColor: `hsl(${(base + 90) % 360} 52% 44%)`,
    };
  }, [seed]);

  return (
    <span
      className={`mesh-avatar${animating ? " live" : ""}${muted ? " muted" : ""}`}
      style={{ width: size, height: size, borderRadius: "50%", ...bg }}
      aria-hidden
    />
  );
}
