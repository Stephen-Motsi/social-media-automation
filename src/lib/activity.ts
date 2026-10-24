// Plain-language names for the events in ActivityLog (shown on the admin Logs page).
export const activityLabels: Record<string, string> = {
  SIGN_UP: "Created an account",
  SIGN_IN: "Signed in",
  SIGN_OUT: "Signed out",
  EMAIL_VERIFIED: "Email verified by Google (password removed)",
  SESSION_REVOKED: "Signed out a device",
  SESSIONS_REVOKED: "Signed out of devices",
  PROFILE_UPDATED: "Updated profile",
  SUBSCRIBE: "Subscribed",
  UNSUBSCRIBE: "Unsubscribed",
  WHATSAPP_ADDED: "Added a WhatsApp number",
  WHATSAPP_LINKED: "Confirmed WhatsApp",
  WHATSAPP_REMOVED: "Removed WhatsApp",
  ROLE_CHANGE: "Role changed",
  ADVERT_PUBLISHED: "Published an advert",
  POST_SCHEDULED: "Scheduled a post",
  HANDLE_SET: "Set an account handle",
  ACCOUNT_CONNECTED: "Connected an account",
  CONNECT_FAILED: "Couldn't connect an account",
  ACCOUNT_DISCONNECTED: "Disconnected an account",
};

export const activityLabel = (action: string) => activityLabels[action] ?? action.replace(/_/g, " ").toLowerCase();

// One line for an event's details, e.g. "platform: X · handle: @mango"
export function activityDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 300);
}

// "Chrome on macOS" from a user agent
export function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
