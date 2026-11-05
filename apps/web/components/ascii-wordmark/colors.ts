export interface AsciiWordmarkColors {
  /** dense characters inside the letters */
  readonly core: string;
  /** "+" halo hugging the letters */
  readonly halo: string;
  /** brighter "*" peaks inside the halo */
  readonly haloBright: string;
  /** faint "-" / "." background field */
  readonly field: string;
}

/** Amber letters, dim olive halo, near-black field — from the footer artboard. */
export const DEFAULT_ASCII_COLORS: AsciiWordmarkColors = {
  core: "#ffa133",
  field: "#2e2e2b",
  halo: "#45453c",
  haloBright: "#6c6c58",
};
