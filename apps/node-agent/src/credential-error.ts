import { Data } from "effect";

export class CredentialError extends Data.TaggedError("CredentialError")<{
  readonly message: string;
}> {}
