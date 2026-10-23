import type { Platform } from "@prisma/client";

type IconProps = { className?: string };

function FacebookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M14.2 8.4h2.3V5.2h-2.8c-3 0-4.2 1.9-4.2 4.4v1.7H7.5v3.2h2v6.3h3.4v-6.3h2.6l.5-3.2h-3.1V10c0-1 .4-1.6 1.3-1.6z" />
    </svg>
  );
}

function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.9" cy="7.1" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 4a8 8 0 0 0-6.9 12.1L4 20l4-1.1A8 8 0 1 0 12 4z" />
      <path d="M9.3 9.2c.2 2.3 2.4 4.6 5.4 5.5l1-1.2-1.6-.9-.8.7c-1-.4-1.9-1.3-2.4-2.3l.7-.8-.8-1.7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.8 3.5h3l-6.6 7.5 7.8 9.5h-6.1l-4.8-5.9-5.5 5.9H2.6l7.1-8L2.2 3.5h6.2l4.3 5.4 5.1-5.4zm-1.1 15.3h1.7L7.4 5.1H5.6l11.1 13.7z" />
    </svg>
  );
}

function TikTokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M16.6 3c.3 2.2 1.6 3.6 3.9 3.8v2.6c-1.4.1-2.6-.3-3.9-1.1v5.6c0 3.6-2.6 6.1-6 6.1-3.3 0-5.9-2.6-5.6-6 .3-3 2.9-5.2 6.2-4.9v2.8c-1.6-.3-3.2.6-3.4 2.2-.2 1.6 1 2.9 2.6 2.9 1.5 0 2.6-1.1 2.6-3.1V3h3.6z" />
    </svg>
  );
}

export const platforms: Record<
  Platform,
  { name: string; accountNoun: [string, string]; blend: string; glow: string; Icon: (p: IconProps) => React.ReactElement }
> = {
  FACEBOOK: {
    name: "Facebook",
    accountNoun: ["Page", "Pages"],
    blend: "blend-facebook",
    glow: "var(--fb-1)",
    Icon: FacebookIcon,
  },
  INSTAGRAM: {
    name: "Instagram",
    accountNoun: ["account", "accounts"],
    blend: "blend-instagram",
    glow: "var(--ig-2)",
    Icon: InstagramIcon,
  },
  WHATSAPP: {
    name: "WhatsApp",
    accountNoun: ["number", "numbers"],
    blend: "blend-whatsapp",
    glow: "var(--wa-1)",
    Icon: WhatsAppIcon,
  },
  X: {
    name: "X",
    accountNoun: ["account", "accounts"],
    blend: "blend-x",
    glow: "#536471",
    Icon: XIcon,
  },
  TIKTOK: {
    name: "TikTok",
    accountNoun: ["account", "accounts"],
    blend: "blend-tiktok",
    glow: "#fe2c55",
    Icon: TikTokIcon,
  },
};

export { platformOrder } from "@/lib/policy/rules";

export function PlatformBadge({ platform, size = "sm" }: { platform: Platform; size?: "sm" | "lg" }) {
  const p = platforms[platform];
  const box = size === "lg" ? "size-12 rounded-2xl" : "size-7 rounded-lg";
  const icon = size === "lg" ? "size-6" : "size-4";
  return (
    <span className={`${p.blend} ${box} inline-flex shrink-0 items-center justify-center text-white shadow-sm`}>
      <p.Icon className={icon} />
      <span className="sr-only">{p.name}</span>
    </span>
  );
}
