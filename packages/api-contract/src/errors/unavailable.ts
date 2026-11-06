import { Schema } from "effect";

import { taggedErrorClass } from "./tagged-error";

/** 503: A dependency (e.g. World ID) is not configured or not reachable right now. */
export class Unavailable extends taggedErrorClass<Unavailable>()(
  "Unavailable",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}
