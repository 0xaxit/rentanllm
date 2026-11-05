import type { ApiError } from "@/lib/api/errors";

import { Note } from "./primitives";
import { SignedOut } from "./wallet/signed-out";

/** Renders a failed page load: the sign-in prompt for 401, a notice otherwise. */
export const ApiErrorState = ({
  error,
  signedOut,
}: {
  error: ApiError;
  signedOut: { readonly title: string; readonly body: string };
}) => {
  if (error.kind === "Unauthorized") {
    return <SignedOut body={signedOut.body} title={signedOut.title} />;
  }
  return (
    <section
      className="border-pumpkin flex flex-col gap-2 border bg-black p-5.5"
      role="alert"
    >
      <p className="text-label tracking-label text-pumpkin">
        {error.kind === "NotFound" ? "NOT FOUND" : "COULDN'T LOAD"}
      </p>
      <p className="text-body text-enamel leading-5.75">{error.message}</p>
      <Note>pull to refresh, or try again in a moment</Note>
    </section>
  );
};
