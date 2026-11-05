/** 24px pixel icons from the Paper tab bars. They paint with currentColor. */

const PATHS = {
  bookings:
    "M0 0h24v2h-24zM0 2h2v2h-2zM16 2h2v2h-2zM22 2h2v2h-2zM0 4h2v2h-2zM4 4h10v2h-10zM22 4h2v2h-2zM14 6h2v2h-2zM0 8h2v2h-2zM4 8h6v2h-6zM18 8h2v2h-2zM22 8h2v2h-2zM0 10h2v2h-2zM16 10h2v2h-2zM22 10h2v2h-2zM14 12h2v2h-2zM0 14h2v2h-2zM4 14h8v2h-8zM22 14h2v2h-2zM0 16h2v2h-2zM16 16h2v2h-2zM22 16h2v2h-2zM0 18h24v2h-24z",
  browse:
    "M0 0h24v2h-24zM0 4h6v2h-6zM8 4h12v2h-12zM0 8h6v2h-6zM8 8h16v2h-16zM0 12h6v2h-6zM8 12h8v2h-8zM0 16h6v2h-6zM8 16h14v2h-14zM0 20h6v2h-6zM8 20h10v2h-10z",
  earnings:
    "M10 0h4v2h-4zM6 2h12v2h-12zM4 4h4v2h-4zM10 4h4v2h-4zM4 6h4v2h-4zM10 6h4v2h-4zM6 8h10v2h-10zM10 10h4v2h-4zM16 10h4v2h-4zM10 12h4v2h-4zM16 12h4v2h-4zM4 14h14v2h-14zM10 16h4v2h-4z",
  keys: "M2 2h8v2h-8zM0 4h4v2h-4zM8 4h4v2h-4zM0 6h2v2h-2zM10 6h14v2h-14zM0 8h2v2h-2zM10 8h14v2h-14zM0 10h4v2h-4zM8 10h4v2h-4zM18 10h2v2h-2zM22 10h2v2h-2zM2 12h8v2h-8zM18 12h2v2h-2zM22 12h2v2h-2z",
  node: "M0 0h24v2h-24zM0 2h2v2h-2zM22 2h2v2h-2zM0 4h2v2h-2zM4 4h4v2h-4zM18 4h2v2h-2zM22 4h2v2h-2zM0 6h2v2h-2zM22 6h2v2h-2zM0 8h24v2h-24zM0 12h24v2h-24zM0 14h2v2h-2zM22 14h2v2h-2zM0 16h2v2h-2zM4 16h4v2h-4zM18 16h2v2h-2zM22 16h2v2h-2zM0 18h2v2h-2zM22 18h2v2h-2zM0 20h24v2h-24z",
  settings:
    "M8 0h8v2h-8zM0 2h4v2h-4zM6 2h12v2h-12zM20 2h4v2h-4zM0 4h8v2h-8zM16 4h8v2h-8zM2 6h4v2h-4zM18 6h4v2h-4zM2 8h4v2h-4zM10 8h4v2h-4zM18 8h4v2h-4zM0 10h4v2h-4zM8 10h8v2h-8zM20 10h4v2h-4zM0 12h4v2h-4zM8 12h8v2h-8zM20 12h4v2h-4zM2 14h4v2h-4zM10 14h4v2h-4zM18 14h4v2h-4zM2 16h4v2h-4zM18 16h4v2h-4zM0 18h8v2h-8zM16 18h8v2h-8zM0 20h4v2h-4zM6 20h12v2h-12zM20 20h4v2h-4zM8 22h8v2h-8z",
  soundOff:
    "M0 8h4v8h-4zM4 6h2v12h-2zM6 4h2v16h-2zM8 2h2v20h-2zM14 8h2v2h-2zM16 10h2v2h-2zM18 12h2v2h-2zM20 14h2v2h-2zM20 8h2v2h-2zM18 10h2v2h-2zM16 12h2v2h-2zM14 14h2v2h-2z",
  soundOn:
    "M0 8h4v8h-4zM4 6h2v12h-2zM6 4h2v16h-2zM8 2h2v20h-2zM12 10h2v4h-2zM14 4h2v2h-2zM16 6h2v12h-2zM14 18h2v2h-2zM18 2h2v2h-2zM20 4h2v16h-2zM18 20h2v2h-2z",
  tonight:
    "M8 0h8v2h-8zM4 2h6v2h-6zM2 4h4v2h-4zM2 6h4v2h-4zM0 8h4v2h-4zM0 10h4v2h-4zM0 12h4v2h-4zM16 12h2v2h-2zM0 14h4v2h-4zM14 14h4v2h-4zM2 16h4v2h-4zM12 16h4v2h-4zM2 18h14v2h-14zM4 20h10v2h-10z",
  wallet:
    "M0 2h20v2h-20zM0 4h2v2h-2zM20 4h2v2h-2zM0 6h2v2h-2zM22 6h2v2h-2zM0 8h2v2h-2zM12 8h12v2h-12zM0 10h2v2h-2zM12 10h2v2h-2zM20 10h4v2h-4zM0 12h2v2h-2zM12 12h2v2h-2zM18 12h6v2h-6zM0 14h2v2h-2zM12 14h12v2h-12zM0 16h2v2h-2zM22 16h2v2h-2zM0 18h24v2h-24z",
} as const;

export type IconName = keyof typeof PATHS;

export const PixelIcon = ({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) => (
  <svg
    aria-hidden="true"
    className={className ?? "size-6 shrink-0"}
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d={PATHS[name]} />
  </svg>
);
