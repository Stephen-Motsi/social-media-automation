// How an admin got someone's consent when adding them (stored on the subscriber).
// Kept free of server-only imports so client components can use it.
export const CONSENT_METHODS = [
  "Signed up in person (form or in store)",
  "Existing customer who agreed to WhatsApp offers",
  "Asked us by phone or WhatsApp to be added",
  "Other",
] as const;
