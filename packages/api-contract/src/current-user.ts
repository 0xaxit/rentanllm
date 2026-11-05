import { Context } from "effect";

import type { User } from "./schemas";

/** The signed-in user, provided to handlers by the `Authentication` middleware. */
export class CurrentUser extends Context.Service<CurrentUser, User>()(
  "@rentanllm/api-contract/CurrentUser"
) {}
