/** Serialisable state of the e-mail OTP login form. */
export interface LoginState {
  step: "email" | "code";
  /** What was typed, so the inputs keep their text. */
  email: string;
  /** Same-origin path to go to after signing in (already sanitised). */
  next: string;
  error?: string;
  /** Field the error belongs to. */
  errorField?: "email" | "otp";
  info?: string;
}

export const initialLoginState = (email = "", next = "/account"): LoginState => ({
  step: "email",
  email,
  next,
});
