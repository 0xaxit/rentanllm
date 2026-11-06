import { Schema } from "effect";

import { taggedErrorClass } from "./tagged-error";

/** 409: The request conflicts with the resource's current state. */
export class Conflict extends taggedErrorClass<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}
