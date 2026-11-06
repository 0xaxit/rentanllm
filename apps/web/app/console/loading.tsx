import { AppMain } from "@/components/app-shell/page-header";

const ROWS = ["first", "second", "third"] as const;

/**
 * Shown the moment a console tab is clicked, while the server fetches the
 * owner's data, so navigation responds at once instead of holding the old page.
 */
const ConsoleLoading = () => (
  <AppMain>
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-5.5 pt-11"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <div className="bg-soot h-11 w-40 motion-safe:animate-pulse" />
      <div className="bg-soot h-48 w-full max-w-[56rem] motion-safe:animate-pulse" />
      <div className="border-soot flex flex-col border">
        {ROWS.map((row) => (
          <div
            className="border-soot flex h-[5.5rem] items-center border-b px-7 last:border-b-0"
            key={row}
          >
            <div className="bg-soot h-4 w-44 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  </AppMain>
);

export default ConsoleLoading;
