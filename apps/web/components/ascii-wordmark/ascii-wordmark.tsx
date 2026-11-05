"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { DEFAULT_ASCII_COLORS } from "./colors";
import type { AsciiWordmarkColors } from "./colors";
import {
  BLANK_GLYPH,
  CORE_THRESHOLD,
  GLYPHS,
  Tone,
  distanceField,
  shade,
} from "./field";
import type { FieldGrid, ToneValue } from "./field";

export interface AsciiWordmarkProps {
  /** Word drawn as the glyph mask. Keep it short and uppercase. */
  readonly word?: string;
  readonly colors?: Partial<AsciiWordmarkColors>;
  /** Animation speed multiplier (1 = default drift). */
  readonly speed?: number;
  /** Frame cap; the field reads as a flicker, so 30 is plenty. */
  readonly fps?: number;
  /** Width / height of the band. */
  readonly aspectRatio?: number;
  readonly className?: string;
}

/** Roughly how many character columns span a desktop-width band. */
const TARGET_COLS = 128;
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 18;
const LINE_HEIGHT = 1.26;
const MAX_DPR = 2;
const MASK_SCALE = 0.5;
/** Fraction of the band height the letters may use, and where they start. */
const LETTER_BAND = 0.56;
const LETTER_TOP = 0.2;
const MAX_FRAME_GAP_MS = 100;
const STATIC_TIME = 12.4;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

interface Layout {
  readonly grid: FieldGrid;
  readonly glyph: Uint8Array;
  readonly tone: Uint8Array;
  readonly atlas: HTMLCanvasElement;
  readonly tileW: number;
  readonly tileH: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly dpr: number;
}

const toneRows: readonly ToneValue[] = [
  Tone.Core,
  Tone.Halo,
  Tone.HaloBright,
  Tone.Field,
];

const buildAtlas = (
  family: string,
  fontPx: number,
  tileW: number,
  tileH: number,
  dpr: number,
  colors: AsciiWordmarkColors
): HTMLCanvasElement => {
  const atlas = document.createElement("canvas");
  atlas.width = tileW * GLYPHS.length;
  atlas.height = tileH * toneRows.length;
  const ctx = atlas.getContext("2d");
  if (!ctx) {
    return atlas;
  }
  const toneColor: Record<number, string> = {
    [Tone.Core]: colors.core,
    [Tone.Field]: colors.field,
    [Tone.Halo]: colors.halo,
    [Tone.HaloBright]: colors.haloBright,
  };
  ctx.font = `${fontPx * dpr}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [row, tone] of toneRows.entries()) {
    ctx.fillStyle = toneColor[tone] ?? colors.field;
    for (const [col, char] of GLYPHS.entries()) {
      ctx.fillText(char, col * tileW + tileW / 2, row * tileH + tileH / 2);
    }
  }
  return atlas;
};

/** Rasterise the word and reduce it to per-cell coverage. */
const buildCoverage = (
  word: string,
  family: string,
  width: number,
  height: number,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number
): Float32Array => {
  const coverage = new Float32Array(cols * rows);
  const mask = document.createElement("canvas");
  mask.width = Math.max(1, Math.ceil(width * MASK_SCALE));
  mask.height = Math.max(1, Math.ceil(height * MASK_SCALE));
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return coverage;
  }
  ctx.scale(MASK_SCALE, MASK_SCALE);

  const probe = 100;
  ctx.font = `${probe}px ${family}`;
  const metrics = ctx.measureText(word);
  const ascent = metrics.actualBoundingBoxAscent || probe * 0.7;
  const fitWidth = ((width * 0.99) / metrics.width) * probe;
  const fitHeight = ((height * LETTER_BAND) / ascent) * probe;
  const fontPx = Math.min(fitWidth, fitHeight);
  const scaledAscent = (ascent / probe) * fontPx;

  ctx.font = `${fontPx}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.fillText(word, width / 2, height * LETTER_TOP + scaledAscent);

  const { data } = ctx.getImageData(0, 0, mask.width, mask.height);
  const samples = [0.2, 0.5, 0.8] as const;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let hits = 0;
      for (const sy of samples) {
        for (const sx of samples) {
          const px = Math.floor((c + sx) * cellW * MASK_SCALE);
          const py = Math.floor((r + sy) * cellH * MASK_SCALE);
          if (px < mask.width && py < mask.height) {
            hits += (data[(py * mask.width + px) * 4 + 3] ?? 0) > 127 ? 1 : 0;
          }
        }
      }
      coverage[r * cols + c] = hits / (samples.length * samples.length);
    }
  }
  return coverage;
};

const buildLayout = (
  canvas: HTMLCanvasElement,
  word: string,
  colors: AsciiWordmarkColors
): Layout | null => {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!ctx || width === 0 || height === 0) {
    return null;
  }
  const family = getComputedStyle(canvas).fontFamily || "monospace";
  ctx.font = `100px ${family}`;
  const advance = ctx.measureText("6").width / 100 || 0.6;

  const fontPx = clamp(width / TARGET_COLS / advance, MIN_FONT_PX, MAX_FONT_PX);
  const cellW = fontPx * advance;
  const cellH = fontPx * LINE_HEIGHT;
  const cols = Math.ceil(width / cellW);
  const rows = Math.ceil(height / cellH);
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const coverage = buildCoverage(
    word,
    family,
    width,
    height,
    cols,
    rows,
    cellW,
    cellH
  );
  const inside = new Uint8Array(coverage.length);
  for (const [i, value] of coverage.entries()) {
    inside[i] = value > CORE_THRESHOLD ? 1 : 0;
  }
  const distance = distanceField(inside, cols, rows, cellH / cellW);

  const tileW = Math.ceil(cellW * dpr) + 2;
  const tileH = Math.ceil(cellH * dpr);
  return {
    atlas: buildAtlas(family, fontPx, tileW, tileH, dpr, colors),
    cellH,
    cellW,
    dpr,
    glyph: new Uint8Array(cols * rows),
    grid: { cols, coverage, distance, rows },
    tileH,
    tileW,
    tone: new Uint8Array(cols * rows),
  };
};

const drawFrame = (canvas: HTMLCanvasElement, layout: Layout, time: number) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const { grid, glyph, tone, atlas, tileW, tileH, cellW, cellH, dpr } = layout;
  shade(grid, time, { glyph, tone });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const stepX = cellW * dpr;
  const stepY = cellH * dpr;
  const offsetX = (tileW - stepX) / 2;
  for (let r = 0; r < grid.rows; r += 1) {
    const y = Math.round(r * stepY);
    for (let c = 0; c < grid.cols; c += 1) {
      const i = r * grid.cols + c;
      const g = glyph[i] ?? BLANK_GLYPH;
      const t = tone[i] ?? Tone.Empty;
      if (g !== BLANK_GLYPH && t !== Tone.Empty) {
        const atlasRow = toneRows.indexOf(t as ToneValue);
        ctx.drawImage(
          atlas,
          g * tileW,
          atlasRow * tileH,
          tileW,
          tileH,
          Math.round(c * stepX - offsetX),
          y,
          tileW,
          tileH
        );
      }
    }
  }
};

/**
 * Full-width animated ASCII wordmark. The word is rasterised once per resize
 * into a coverage + distance field over a monospace character grid; each frame
 * drifts two octaves of value noise over it and stamps glyphs from a
 * pre-rendered atlas. Pauses offscreen, renders one still frame under
 * prefers-reduced-motion, and shows plain text when JS is unavailable.
 */
export const AsciiWordmark = ({
  word = "RENTANLLM",
  colors,
  speed = 1,
  fps = 30,
  aspectRatio = 4,
  className,
}: AsciiWordmarkProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const core = colors?.core ?? DEFAULT_ASCII_COLORS.core;
  const halo = colors?.halo ?? DEFAULT_ASCII_COLORS.halo;
  const haloBright = colors?.haloBright ?? DEFAULT_ASCII_COLORS.haloBright;
  const field = colors?.field ?? DEFAULT_ASCII_COLORS.field;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!(container && canvas)) {
      return;
    }
    const palette: AsciiWordmarkColors = { core, field, halo, haloBright };
    const frameInterval = 1000 / Math.max(1, fps);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let layout: Layout | null = null;
    let disposed = false;
    let visible = false;
    let rafId = 0;
    let lastTick = 0;
    let lastDraw = 0;
    let elapsed = 0;

    const paint = () => {
      if (layout) {
        drawFrame(
          canvas,
          layout,
          reducedMotion.matches ? STATIC_TIME : elapsed * speed
        );
      }
    };

    const tick = (now: number) => {
      rafId = 0;
      if (disposed || !visible || reducedMotion.matches) {
        return;
      }
      if (lastTick !== 0) {
        elapsed += Math.min(now - lastTick, MAX_FRAME_GAP_MS) / 1000;
      }
      lastTick = now;
      if (now - lastDraw >= frameInterval) {
        lastDraw = now;
        paint();
      }
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (rafId === 0 && visible && !reducedMotion.matches && !disposed) {
        lastTick = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    const stop = () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const relayout = () => {
      layout = buildLayout(canvas, word, palette);
      if (layout) {
        container.dataset.ready = "true";
      }
      paint();
    };

    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(relayout);
    });

    const intersection = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          start();
        } else {
          stop();
        }
      },
      { rootMargin: "120px" }
    );

    const onMotionChange = () => {
      if (reducedMotion.matches) {
        stop();
        paint();
      } else {
        start();
      }
    };

    const boot = async () => {
      const family = getComputedStyle(canvas).fontFamily;
      try {
        await document.fonts.load(`16px ${family}`, word);
      } catch {
        // fall through with whatever font is available
      }
      if (disposed) {
        return;
      }
      relayout();
      resizeObserver.observe(container);
      intersection.observe(container);
      reducedMotion.addEventListener("change", onMotionChange);
    };

    boot().catch(() => {
      // canvas stays hidden; the static fallback text remains visible
    });

    return () => {
      disposed = true;
      stop();
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      intersection.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [word, core, halo, haloBright, field, speed, fps]);

  return (
    <div
      aria-label={word}
      className={`group relative aspect-(--wordmark-aspect) w-full overflow-hidden ${className ?? ""}`}
      ref={containerRef}
      role="img"
      style={
        {
          "--wordmark-aspect": String(aspectRatio),
          "--wordmark-core": core,
        } as CSSProperties
      }
    >
      <p
        aria-hidden="true"
        className="text-wordmark tracking-wordmark absolute inset-0 flex items-center justify-center leading-none text-(--wordmark-core) group-data-[ready=true]:invisible"
      >
        {word}
      </p>
      <canvas
        aria-hidden="true"
        className="absolute inset-0 size-full opacity-0 transition-opacity duration-700 group-data-[ready=true]:opacity-100"
        ref={canvasRef}
      />
    </div>
  );
};
