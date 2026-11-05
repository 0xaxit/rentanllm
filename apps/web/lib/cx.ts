/** Join truthy class names. */
export const cx = (
  ...parts: readonly (string | false | null | undefined)[]
): string => parts.filter(Boolean).join(" ");

/** 0x41a4…7bd2 -> "0x41a…7bd". */
export const shortAddress = (address: string | null | undefined): string =>
  address ? `${address.slice(0, 5)}…${address.slice(-3)}` : "—";

/** First 8 characters of a UUID, for compact ids on passes and rows. */
export const shortId = (id: string): string => id.slice(0, 8);
