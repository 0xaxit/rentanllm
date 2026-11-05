/**
 * The palette from app/globals.css, for places that cannot read CSS variables:
 * WebGL shader uniforms, the web app manifest, the viewport theme colour and
 * ConnectKit's theme object. Keep in sync with the @theme block.
 */
export const palette = {
  aluminum: "#cccccc",
  amber: "#ffa133",
  ash: "#8e8e8e",
  black: "#141414",
  carbon: "#222222",
  cement: "#c0c0c0",
  clay: "#6c6c58",
  dark: "#444444",
  ember: "#7a4a17",
  enamel: "#eeeeee",
  flux: "#c8be50",
  foam: "#bccabb",
  mud: "#8a8a6f",
  paper: "#f3f3f0",
  paperShade: "#e6e6e1",
  pit: "#1a1a1a",
  pumpkin: "#e47b1a",
  soot: "#333333",
  transparent: "#00000000",
} as const;
