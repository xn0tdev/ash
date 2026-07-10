import { useEffect, useMemo, useRef } from "react";

// Dot-matrix loaders (ported from craftui.space dot-matrix-* components):
// five animation variants over the same SVG dot grid. Each background agent
// gets its own variant + color so they're tellable at a glance.

export type DotMatrixVariant = "vortex" | "chase" | "rain" | "bits" | "life";

interface DotMatrixProps {
  variant: DotMatrixVariant;
  size?: number;
  color?: string;
  animating?: boolean;
  gridSize?: number;
  /** Seconds per full cycle (variant-specific meaning). */
  duration?: number;
}

const BASE = 0.07;
const VORTEX_TAIL = [1, 0.72, 0.48, 0.28, 0.14, 0.07];
const LEADER_TAIL = [1, 0.8, 0.62, 0.46, 0.32, 0.2, 0.12, 0.06];
const CHASER_TAIL = [0.55, 0.4, 0.27, 0.17, 0.09];
const RAIN_TAIL = [1, 0.65, 0.38, 0.18, 0.08];
const RAIN_COOLDOWN = 5;

/** Clockwise perimeter cells for each concentric ring (outermost first). */
function buildRings(n: number): number[][] {
  const rings: number[][] = [];
  const maxDepth = Math.floor((n - 1) / 2);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const top = depth, bottom = n - 1 - depth, left = depth, right = n - 1 - depth;
    const cells: number[] = [];
    if (top === bottom && left === right) {
      cells.push(top * n + left);
    } else if (top + 1 === bottom && left + 1 === right) {
      cells.push(top * n + left, top * n + right, bottom * n + right, bottom * n + left);
    } else {
      for (let c = left; c <= right; c++) cells.push(top * n + c);
      for (let r = top + 1; r <= bottom; r++) cells.push(r * n + right);
      for (let c = right - 1; c >= left; c--) cells.push(bottom * n + c);
      for (let r = bottom - 1; r >= top + 1; r--) cells.push(r * n + left);
    }
    rings.push(cells);
  }
  return rings;
}

function buildSpiralPath(n: number): number[] {
  const path: number[] = [];
  let top = 0, bottom = n - 1, left = 0, right = n - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) path.push(top * n + c);
    top++;
    for (let r = top; r <= bottom; r++) path.push(r * n + right);
    right--;
    if (top <= bottom) { for (let c = right; c >= left; c--) path.push(bottom * n + c); bottom--; }
    if (left <= right) { for (let r = bottom; r >= top; r--) path.push(r * n + left); left++; }
  }
  return path;
}

// ── game of life (toroidal) ────────────────────────────────
type LifeGrid = boolean[][];

function lifeNext(grid: LifeGrid, n: number): LifeGrid {
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      let count = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (grid[(r + dr + n) % n][(c + dc + n) % n]) count++;
        }
      return grid[r][c] ? count === 2 || count === 3 : count === 3;
    }),
  );
}

function lifeKey(g: LifeGrid): string {
  return g.map((r) => r.map((c) => (c ? "1" : "0")).join("")).join("|");
}

function lifeSeed(n: number): LifeGrid {
  const g: LifeGrid = Array.from({ length: n }, () => Array(n).fill(false));
  const mid = Math.floor(n / 2);
  g[mid][Math.max(0, mid - 1)] = true;
  g[mid][mid] = true;
  g[mid][Math.min(n - 1, mid + 1)] = true;
  if (n >= 4) {
    const r2 = Math.floor(n / 4), c2 = Math.floor((3 * n) / 4);
    g[r2][Math.max(0, c2 - 1)] = true;
    g[r2][c2] = true;
    g[r2][Math.min(n - 1, c2 + 1)] = true;
  }
  if (n >= 5) {
    const r3 = Math.floor((3 * n) / 4), c3 = Math.floor(n / 4);
    g[Math.max(0, r3 - 1)][c3] = true;
    g[r3][c3] = true;
    g[Math.min(n - 1, r3 + 1)][c3] = true;
  }
  return g;
}

export default function DotMatrix({
  variant,
  size = 16,
  color = "currentColor",
  animating = true,
  gridSize = 5,
  duration,
}: DotMatrixProps) {
  const n = Math.max(3, Math.min(6, gridSize));
  const stride = 100 / (n + 1);
  const r = (stride * 0.82) / 2;

  const rings = useMemo(() => buildRings(n), [n]);
  const path = useMemo(() => buildSpiralPath(n), [n]);

  const stepMs = useMemo(() => {
    switch (variant) {
      case "vortex": return Math.max(16, ((duration ?? 2) * 1000) / (rings[0]?.length ?? 1));
      case "chase": return Math.max(16, ((duration ?? 2.5) * 1000) / path.length);
      case "rain": return Math.max(16, ((duration ?? 1.8) * 1000) / (n + RAIN_COOLDOWN));
      case "bits": return Math.max(16, ((duration ?? 3) * 1000) / (1 << n));
      case "life": return Math.max(80, (duration ?? 0.5) * 1000);
    }
  }, [variant, duration, rings, path, n]);

  // Per-frame opacities computed for a given tick/life state — no React state,
  // so animating never re-renders the component (a pile of finished agents all
  // looping used to jank the sidebar scroll). We write straight to the circle
  // <ref>s instead.
  const computeOps = (tick: number, life: LifeGrid): number[] => {
    const ops = new Array(n * n).fill(BASE);
    switch (variant) {
      case "vortex": {
        rings.forEach((ring, depth) => {
          const speed = 1 << depth;
          if (ring.length === 1) {
            ops[ring[0]] = Math.floor((tick * speed) / 3) % 2 === 0 ? 0.85 : BASE;
            return;
          }
          const head = (tick * speed) % ring.length;
          for (let d = 0; d < VORTEX_TAIL.length && d < ring.length; d++) {
            const idx = ring[(head - d + ring.length) % ring.length];
            ops[idx] = Math.max(ops[idx], VORTEX_TAIL[d]);
          }
        });
        break;
      }
      case "chase": {
        const len = path.length;
        const leader = tick % len;
        const chaser = (tick + Math.floor(len * 0.55)) % len;
        for (let d = 0; d < LEADER_TAIL.length; d++) {
          const idx = path[(leader - d + len) % len];
          ops[idx] = Math.max(ops[idx], LEADER_TAIL[d]);
        }
        for (let d = 0; d < CHASER_TAIL.length; d++) {
          const idx = path[(chaser - d + len) % len];
          ops[idx] = Math.max(ops[idx], CHASER_TAIL[d]);
        }
        break;
      }
      case "rain": {
        const cycle = n + RAIN_COOLDOWN;
        for (let col = 0; col < n; col++) {
          const phase = (tick + Math.round((col / n) * cycle * 0.85)) % cycle;
          if (phase >= n) continue;
          for (let row = 0; row < n; row++) {
            const dist = phase - row;
            if (dist >= 0 && dist < RAIN_TAIL.length) {
              const idx = row * n + col;
              ops[idx] = Math.max(ops[idx], RAIN_TAIL[dist]);
            }
          }
        }
        break;
      }
      case "bits": {
        for (let i = 0; i < n * n; i++) {
          const row = Math.floor(i / n), col = i % n;
          const counter = Math.floor(tick / (1 << (n - 1 - row)));
          ops[i] = ((counter >> (n - 1 - col)) & 1) === 1 ? 0.96 : BASE;
        }
        break;
      }
      case "life": {
        life.forEach((row, ri) =>
          row.forEach((cell, ci) => {
            ops[ri * n + ci] = cell ? 0.95 : BASE;
          }),
        );
        break;
      }
    }
    return ops;
  };

  const dots = useRef<(SVGCircleElement | null)[]>([]);
  useEffect(() => {
    if (!animating) return;
    let tick = 0;
    let life = lifeSeed(n);
    const history = new Set<string>();
    const paint = (ops: number[]) => {
      for (let i = 0; i < ops.length; i++) dots.current[i]?.setAttribute("opacity", String(ops[i]));
    };
    paint(computeOps(0, life));
    const id = setInterval(() => {
      if (variant === "life") {
        const next = lifeNext(life, n);
        const key = lifeKey(next);
        const dead = next.every((row) => row.every((c) => !c));
        if (dead || history.has(key)) {
          history.clear();
          life = lifeSeed(n);
        } else {
          if (history.size > 16) history.clear();
          history.add(key);
          life = next;
        }
      } else {
        tick += 1;
      }
      paint(computeOps(tick, life));
    }, stepMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, stepMs, variant, n]);

  // Static frame when idle: keep the FULL grid faintly lit (never collapse to a
  // lone center dot) so a finished agent still reads as its grid theme.
  const staticOpacity = (i: number) => (animating ? BASE : i === Math.floor((n * n) / 2) ? 0.55 : 0.18);

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Working" role="img">
      {Array.from({ length: n * n }, (_, i) => (
        <circle
          key={i}
          ref={(el) => {
            dots.current[i] = el;
          }}
          className="dm-dot"
          cx={stride + (i % n) * stride}
          cy={stride + Math.floor(i / n) * stride}
          r={r}
          fill={color}
          opacity={staticOpacity(i)}
        />
      ))}
    </svg>
  );
}
