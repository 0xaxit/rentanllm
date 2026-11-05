import { Schema } from "effect";

import { taggedErrorClass } from "./tagged-error";

/** 404: The resource does not exist or is not visible to the caller. */
export class NotFound extends taggedErrorClass<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 }
) {}
