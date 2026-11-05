import { Data } from "effect";

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
}> {}
