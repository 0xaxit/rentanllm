import { Note } from "../primitives";
import { SignInButton } from "./sign-in-button";

/** Shown in place of a protected page when there is no session. */
export const SignedOut = ({ title, body }: { title: string; body: string }) => (
  <section
    aria-labelledby="signed-out-title"
    className="border-soot flex flex-col items-start gap-4 border bg-black p-5.5"
  >
    <p className="text-label tracking-label text-amber">SIGN IN</p>
    <h2 className="text-title text-enamel leading-6.5" id="signed-out-title">
      {title}
    </h2>
    <p className="text-body text-cement max-w-130 leading-5.75">{body}</p>
    <SignInButton variant="light" />
    <Note>sign-in with ethereum · one signature, no transaction, no gas</Note>
  </section>
);
