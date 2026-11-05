/**
 * Pure maths for the ASCII wordmark: glyph mask -> distance field -> noise ->
 * character + colour per cell. No DOM here, so it is cheap to reason about.
 */

export const Tone = {
  Core: 1,
  Empty: 0,
  Field: 4,
  Halo: 2,
  HaloBright: 3,
} as const;
export type ToneValue = (typeof Tone)[keyof typeof Tone];

/** Characters that can appear, in atlas order. */
export const GLYPHS = ["6", "/", "?", "+", "*", "-", "."] as const;
const G_SIX = 0;
const G_SLASH = 1;
const G_QUESTION = 2;
const G_PLUS = 3;
const G_STAR = 4;
const G_DASH = 5;
const G_DOT = 6;

export const BLANK_GLYPH = 255;

/* ------------------------------------------------------------------ */
/* noise                                                               */
/* ------------------------------------------------------------------ */

const fract = (value: number) => value - Math.floor(value);

/** Stable pseudo-random value in [0, 1) for an integer lattice point. */
export const hash3 = (x: number, y: number, z: number): number =>
  fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43_758.5453);

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1]. */
export const valueNoise = (x: number, y: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const a = hash3(xi, yi, 0);
  const b = hash3(xi + 1, yi, 0);
  const c = hash3(xi, yi + 1, 0);
  const d = hash3(xi + 1, yi + 1, 0);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
};

/* ------------------------------------------------------------------ */
/* glyph mask -> distance                                              */
/* ------------------------------------------------------------------ */

const FAR = 1e6;

/**
 * Two-pass chamfer distance transform over the cell grid. Distances are in
 * column units; `rowWeight` is cellHeight / cellWidth so a step up/down costs
 * as much as it looks on screen.
 */
export const distanceField = (
  inside: Uint8Array,
  cols: number,
  rows: number,
  rowWeight: number
): Float32Array => {
  const diag = Math.hypot(1, rowWeight);
  const dist = new Float32Array(cols * rows);
  for (let i = 0; i < dist.length; i += 1) {
    dist[i] = inside[i] ? 0 : FAR;
  }
  const at = (c: number, r: number) =>
    c < 0 || c >= cols || r < 0 || r >= rows
      ? FAR
      : (dist[r * cols + c] ?? FAR);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      dist[i] = Math.min(
        dist[i] ?? FAR,
        at(c - 1, r) + 1,
        at(c, r - 1) + rowWeight,
        at(c - 1, r - 1) + diag,
        at(c + 1, r - 1) + diag
      );
    }
  }
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      const i = r * cols + c;
      dist[i] = Math.min(
        dist[i] ?? FAR,
        at(c + 1, r) + 1,
        at(c, r + 1) + rowWeight,
        at(c + 1, r + 1) + diag,
        at(c - 1, r + 1) + diag
      );
    }
  }
  return dist;
};

/* ------------------------------------------------------------------ */
/* per-frame shading                                                   */
/* ------------------------------------------------------------------ */

export interface FieldGrid {
  readonly cols: number;
  readonly rows: number;
  /** 0..1 glyph coverage per cell */
  readonly coverage: Float32Array;
  /** distance to nearest glyph cell, in columns */
  readonly distance: Float32Array;
}

export interface ShadeOutput {
  /** glyph index per cell, BLANK_GLYPH = nothing */
  readonly glyph: Uint8Array;
  readonly tone: Uint8Array;
}

export const CORE_THRESHOLD = 0.42;
const HALO_RADIUS = 4.6;
const FLICKER_RATE = 7;

interface CellSample {
  /** drifting noise, 0..1 */
  readonly n: number;
  /** per-cell flicker roll, 0..1, re-rolled a few times a second */
  readonly flick: number;
}

type CellResult = readonly [glyph: number, tone: ToneValue] | null;

const shadeCore = ({ n, flick }: CellSample, cover: number): CellResult => {
  // rare dropouts make the letters breathe
  if (flick < 0.035 && n < 0.45) {
    return null;
  }
  const edge = cover < 0.85;
  if (flick > 0.93 || (edge && flick > 0.72)) {
    return [n > 0.5 ? G_SLASH : G_QUESTION, Tone.Core];
  }
  if (n > 0.78 && flick > 0.55) {
    return [G_SLASH, Tone.Core];
  }
  return [G_SIX, Tone.Core];
};

const shadeHalo = ({ n, flick }: CellSample, distance: number): CellResult => {
  const halo = Math.max(0, 1 - distance / HALO_RADIUS);
  if (halo === 0) {
    return null;
  }
  const value = halo * 1.05 + (n - 0.5) * 0.6 + (flick - 0.5) * 0.3;
  if (value <= 0.34) {
    return null;
  }
  const bright = value > 0.95;
  return [
    bright || flick > 0.82 ? G_STAR : G_PLUS,
    bright ? Tone.HaloBright : Tone.Halo,
  ];
};

const shadeField = ({ n, flick }: CellSample, depth: number): CellResult => {
  // the background field gets denser toward the bottom edge
  const density = 0.03 + 0.62 * depth * depth;
  const value = density * (0.55 + n * 0.9) - (1 - flick) * 0.18;
  if (value > 0.12 + (1 - depth) * 0.05) {
    if (n > 0.52) {
      return [G_DASH, Tone.Field];
    }
    return [flick > 0.97 ? G_PLUS : G_DOT, Tone.Field];
  }
  // a sparse sprinkle of dim crosses keeps the empty sky alive
  if (flick > 0.992 && n > 0.4) {
    return [G_PLUS, Tone.Field];
  }
  return null;
};

/**
 * Shade one frame. `time` is in seconds (already multiplied by speed).
 * Writes into `out` to avoid per-frame allocation.
 */
export const shade = (
  grid: FieldGrid,
  time: number,
  out: ShadeOutput
): void => {
  const { cols, rows, coverage, distance } = grid;
  const flickerTick = Math.floor(time * FLICKER_RATE);
  const driftX = time * 0.35;
  const driftY = time * 0.12;
  const lastRow = Math.max(1, rows - 1);

  for (let r = 0; r < rows; r += 1) {
    const depth = r / lastRow;
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      // two drifting octaves: slow large swell + quicker fine grain
      const swell = valueNoise(c * 0.07 + driftX, r * 0.22 - driftY);
      const grain = valueNoise(c * 0.31 - driftX * 1.7, r * 0.6 + driftY * 2.3);
      // each cell re-rolls on its own phase so the field flickers unevenly
      const phase = Math.floor(hash3(c, r, 7) * FLICKER_RATE);
      const sample: CellSample = {
        flick: hash3(c, r, flickerTick + phase),
        n: swell * 0.65 + grain * 0.35,
      };
      const cover = coverage[i] ?? 0;
      const result =
        cover > CORE_THRESHOLD
          ? shadeCore(sample, cover)
          : (shadeHalo(sample, distance[i] ?? FAR) ??
            shadeField(sample, depth));
      out.glyph[i] = result ? result[0] : BLANK_GLYPH;
      out.tone[i] = result ? result[1] : Tone.Empty;
    }
  }
};
