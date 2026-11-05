"use client";

import {
  Dithering,
  GrainGradient,
  ImageDithering,
  PaperTexture,
} from "@paper-design/shaders-react";

import { palette } from "@/lib/tokens";

import { useReducedMotion } from "./use-reduced-motion";

/*
 * Paper shader slots from the design file. Each one sits on top of a CSS
 * fallback painted by its parent, so if WebGL is unavailable the layout still
 * reads correctly. Animation stops under prefers-reduced-motion.
 */

const fill = "absolute inset-0 size-full";

/** Dusk band on the landing page: warped 4x4 ordered dither, carbon ink. */
export const DuskDither = ({ className }: { className?: string }) => {
  const reduced = useReducedMotion();
  return (
    <Dithering
      aria-hidden="true"
      className={className ?? fill}
      colorBack={palette.transparent}
      colorFront={palette.carbon}
      frame={318_872}
      scale={0.6}
      shape="warp"
      size={2}
      speed={reduced ? 0 : 0.35}
      type="4x4"
    />
  );
};

/** Earnings tile on the owner console: amber grain rising from a corner. */
export const EarningsGrain = () => {
  const reduced = useReducedMotion();
  return (
    <GrainGradient
      aria-hidden="true"
      className={fill}
      colorBack={palette.carbon}
      colors={[palette.carbon, palette.ember, palette.amber]}
      frame={64_193}
      intensity={0.5}
      noise={0.25}
      shape="corners"
      softness={0.5}
      speed={reduced ? 0 : 0.3}
    />
  );
};

/** Boarding-pass barcode: a coarse 8x8 dither over printed bars. */
export const BarcodeDither = () => {
  const reduced = useReducedMotion();
  return (
    <Dithering
      aria-hidden="true"
      className={fill}
      colorBack={palette.transparent}
      colorFront={palette.carbon}
      frame={12_000}
      scale={1.4}
      shape="wave"
      size={3}
      speed={reduced ? 0 : 0.15}
      type="8x8"
    />
  );
};

/** Receipt paper: fibres, folds and a little crumple, still. */
export const ReceiptPaper = () => (
  <PaperTexture
    aria-hidden="true"
    className={fill}
    colorBack={palette.paperShade}
    colorPaper={palette.paper}
    colorShadow={palette.cement}
    crumples={0.2}
    drops={0.15}
    fiber={0.35}
    fit="cover"
    folds={0.35}
    roughness={0.3}
    seed={4}
    speed={0}
    wrinkles={0.4}
  />
);

/**
 * A grayscale illustration rendered as a 4x4 ordered dither in amber on
 * carbon, like the dusk band. Static: image dithering has no animation.
 */
export const IllustrationDither = ({ src }: { src: string }) => (
  <ImageDithering
    aria-hidden="true"
    className={fill}
    colorBack={palette.carbon}
    colorFront={palette.amber}
    colorHighlight={palette.amber}
    colorSteps={2}
    fit="contain"
    image={src}
    size={2}
    type="4x4"
  />
);
