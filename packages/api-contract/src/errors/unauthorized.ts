import { Schema } from "effect";

import { taggedErrorClass } from "./tagged-error";

/** 401: The request has no valid session or credential. */
export class Unauthorized extends taggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}
