import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { InvalidRequest } from "../errors/invalid-request";
import { Unauthorized } from "../errors/unauthorized";
import { Authentication } from "../middleware/authentication";
import {
  NonceRequestSchema,
  NonceResponseSchema,
  SessionResponseSchema,
  UserSchema,
  VerifyRequestSchema,
} from "../schemas";

/**
 * Sign-In With Ethereum (EIP-4361):
 * 1. POST /auth/nonce with the wallet address.
 * 2. The wallet signs a SIWE message carrying that nonce (domain = the API's SIWE_DOMAIN).
 * 3. POST /auth/verify with the message and signature. Sets the session cookie and
 *    creates the user on first sign-in.
 */
export class AuthGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("nonce", "/nonce", {
      error: InvalidRequest,
      payload: NonceRequestSchema,
      success: NonceResponseSchema,
    }),
    HttpApiEndpoint.post("verify", "/verify", {
      error: [Unauthorized, InvalidRequest],
      payload: VerifyRequestSchema,
      success: SessionResponseSchema,
    }),
    HttpApiEndpoint.post("logout", "/logout", {
      success: HttpApiSchema.NoContent,
    }),
    HttpApiEndpoint.get("me", "/me", { success: UserSchema }).middleware(
      Authentication
    )
  )
  .prefix("/auth") {}
