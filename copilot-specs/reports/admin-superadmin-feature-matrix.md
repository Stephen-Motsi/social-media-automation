# Admin and Super Admin Feature and Permission Matrix

## Roles

| Capability | USER | ADMIN | SUPER_ADMIN |
|---|---:|---:|---:|
| Sign in and manage own profile/social handles | Read/write own | Read/write own | Read/write own |
| Browse and subscribe to adverts | Yes | Yes | Yes |
| Create and save adverts | No | Yes | Yes |
| Publish, schedule, or send adverts | No | Yes, within staff operations | Yes, platform-wide |
| Manage channels and connected social accounts | No | Yes | Yes |
| Manage audience and approvals | No | Yes | Yes |
| View application users and role/status | No | Read-only admin view | Read/write role management |
| Manage admin accounts and promotion/demotion | No | No | Yes |
| View audit/security logs | No | Operational logs where authorized | Platform-wide logs |
| Configure global provider settings | No | No | Yes |

## Feature matrix

| User feature or data | Existing route/API | Data model | Admin access | Super Admin access | Privacy boundary |
|---|---|---|---|---|---|
| Profile and account status | `/me/profile` | `User`, `Account`, `UserSession` | Operational view without passwords or tokens | Platform-wide account oversight | Own profile private; admins see no credentials or private password hash |
| Saved social handles | `/me/profile`, profile actions | `UserSocial` | Handle format and delivery troubleshooting | Platform-wide oversight only as needed | Not publish account credentials; keep handles appropriately scoped |
| WhatsApp subscription status | `/me`, `/subscribe` | `Subscriber`, `Subscription` | Audience, approval, campaign delivery status | Platform-wide delivery oversight | Phone numbers must remain masked or operationally restricted |
| Advert subscriptions | `/me`, widget/server actions | `AdvertSubscription`, `Post` | Subscription counts, platform distribution | Aggregated/platform-wide totals | Do not expose individual ownership unnecessarily |
| Adverts and platform variants | `/`, `/create`, `/admin/adverts` | `Post`, `PostTarget`, `MediaAsset`, `SocialAccount` | Create, edit drafts, preview, list, schedule, publish under staff policy | Same plus platform oversight/configuration | Asset download limited to staff/admin authorization and owner rules |
| AI generation | `/create` server action | `MediaAsset` source/prompt/moderation; generated asset fields | Generate and retry own staff adverts | Generate plus provider quota/config oversight | API keys stay server-side; provider errors may not expose secrets |
| Social publishing | `/posts`, `/channels`, worker | `SocialAccount`, `Channel`, `PostTarget`, `Post` | Manage configured accounts and scheduled jobs | Same plus platform-wide configuration and health | Tokens encrypted and never returned to UI/API |
| Delivery history | `/me`, approvals, admin overview | `Delivery`, `Campaign`, `SocialDelivery`, `PostTarget` | Operational statuses and failures | Platform-wide failure summaries | Individual recipient identity restricted |
| Sessions | `/me`, `/admin/super-admin` | `UserSession` | Do not expose tokens | Admin sessions/last seen; revoke as authorized | Session IDs and cookies remain private |
| Activity/audit log | `/admin/logs` | `ActivityLog` | Staff-visible operational records where permitted | Super Admin security-wide view and export | Preserve actor/target context without token/client-secret data |
| Notifications | `/admin/notifications` | `Notification` | Own staff notifications and operational alerts | Platform-wide oversight | No cross-user private notification leakage |

## Existing but not newly modeled capabilities
- Billing/plans/usage pricing: not a complete user feature and excluded from this implementation.
- Connected third-party account OAuth: existing connection routes exist, but live credentials and account permissions remain unverified.
- Campaign analytics: not implemented as a reliable ordinary-user or admin analytics dataset.
- Live AI provider: OpenAI integration exists in code, but configuration and provider availability are unverified.
