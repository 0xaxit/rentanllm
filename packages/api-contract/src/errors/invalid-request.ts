import { Schema } from "effect";

import { taggedErrorClass } from "./tagged-error";

/** 422: The request is well-formed but its values are not acceptable. */
export class InvalidRequest extends taggedErrorClass<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 422 }
) {}
