/** Serialisable state of the contact form (`useActionState`). */

export type ContactFormField = "name" | "email" | "phone" | "orderRef" | "message";

export interface ContactFormState {
  status: "idle" | "invalid" | "rate_limited" | "error" | "sent";
  /** What was submitted, so the inputs keep their text after an error. */
  values: Record<ContactFormField, string>;
  fieldErrors?: Partial<Record<ContactFormField, string>>;
  message?: string;
}

export const EMPTY_CONTACT_VALUES: ContactFormState["values"] = {
  name: "",
  email: "",
  phone: "",
  orderRef: "",
  message: "",
};

export const INITIAL_CONTACT_STATE: ContactFormState = {
  status: "idle",
  values: EMPTY_CONTACT_VALUES,
};
