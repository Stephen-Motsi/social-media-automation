# Social Media Automation

A web app for scheduling and publishing content to **Meta platforms**: **Facebook Pages**, **Instagram** (Business/Creator accounts), and **WhatsApp** (Cloud API). It has one dashboard and a background worker that publishes at the scheduled time.

> **Status:** working, tested against mock platform APIs; not yet run against live platform accounts.
> In place: sign-in, AI image + caption creation with per-platform checks, a public **subscribe** page with an **Audience** of subscribers, automatic matching of adverts to subscribers with admin **Approvals** before WhatsApp delivery, **Channels** (one container per platform with account connection, post/story choice and recurring schedules), and a worker that publishes to Facebook, Instagram, WhatsApp, X and TikTok. See [Next steps](#next-steps).

---

## Key decisions

| Decision | Detail |
| --- | --- |
| **Three roles** | **Users** sign in with Google or Facebook (an account is created on first sign-in) and subscribe to adverts. **Admins** run adverts, channels, the audience and users. The **super admin** also promotes and demotes admins (`/admin/roles`). Staff sign in with email and password (no public sign-up; the first super admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` via the seed). See [Accounts, roles and sessions](#accounts-roles-and-sessions). |
| **Admins define adverts; users subscribe per platform** | An advert has a title, what it's about, topics, target platforms (the channels' real handles), an AI image and a caption. Listed adverts appear on the public home page and users' dashboards; users subscribe to an advert on specific platforms, and that decides what's sent to whom. |
| **Subscribers are the audience (user side)** | The public home page is `/subscribe` (signed-out visitors to `/` land there). People subscribe to adverts on WhatsApp about topics they choose, with no account or password, or an admin adds them. Adverts are matched to them automatically; **an admin approves every send**. WhatsApp is the only channel that can deliver to an individual; the other platforms only allow public posts (Channels). |
| **Subscriptions are approved automatically** | Each subscription runs through checks based on WhatsApp's policies (`src/lib/policy/subscriptions.ts`). Passing ones are accepted with no admin action; only flagged ones wait on Approvals. |
| **Five platforms** | Facebook, Instagram and WhatsApp go through the Meta Graph API (`src/lib/meta/`). X (`src/lib/x.ts`) and TikTok (`src/lib/tiktok.ts`) have their own OAuth and posting clients. Adding a platform means a new `Platform` enum value, a client, rules in `rules.ts`, and a connect route. |
| **Meta, X and TikTok containers** | The Channels page has one parent container per provider (`ChannelGroup.kind` is unique): **Meta** (holding any of Facebook, Instagram, WhatsApp), **X** and **TikTok**. Each has Settings (connect/disconnect only) and one social container per platform (`Channel`, unique per platform) with format, advert and schedule. |
| **Handles decide which real account is used** | Admins enter the handle for each platform (Page username, @handle, WhatsApp number). Connecting only links the account the platform reports for that handle, and posts only go to accounts matching it (`src/lib/handles.ts`). A handle alone can't grant posting rights: the account owner still signs in and approves. |
| **Only what each API supports** | Stories exist only on Facebook and Instagram. WhatsApp's Business API can't post **Status**, and the X and TikTok APIs can't post stories, so those options are shown disabled with the reason (`formatSupport` in `rules.ts`). |
| **WhatsApp is messaging, not a feed** | "Publishing" to WhatsApp means sending a message to recipients. Free-form text only works within 24h of the recipient's last message; otherwise a pre-approved **template** is required (`sendTemplate`). |
| **Instagram needs media** | The Instagram API cannot post text-only. Images must be at a **public URL** that Meta can fetch. |
| **Tokens encrypted at rest** | All platform access and refresh tokens are stored with AES-256-GCM (`src/lib/crypto.ts`). X and TikTok tokens are refreshed automatically before they expire (`src/lib/tokens.ts`). |
| **AI images go through platform checks** | Images are generated with OpenAI's GPT image API. Every prompt, image and caption is checked against each platform's rules before it can be saved or published (see [Image generation & platform checks](#image-generation--platform-checks)). |

## Tech stack

- **Next.js 15** (App Router, TypeScript, Server Actions) + **Tailwind CSS 4**
- **Auth.js (NextAuth v5)**: Google and Facebook for users, email/password for staff; signed cookies backed by a database session record checked on every request
- **PostgreSQL** + **Prisma** ORM
- **Redis** + **BullMQ** for scheduled publishing jobs
- **Meta Graph API** (Facebook Pages API, Instagram Content Publishing API, WhatsApp Cloud API)
- **X API v2** (OAuth 2.0 + PKCE, posts, media upload) and **TikTok** Login Kit + Content Posting API (photo posts)
- **OpenAI** GPT image generation + `omni-moderation-latest` content moderation

## Project structure

```
.devcontainer/            Codespaces / dev container (app + Postgres + Redis)
prisma/
  schema.prisma           Data model: User, SocialAccount, ChannelGroup, Channel, Post, PostTarget, MediaAsset, WebhookEvent
  migrations/             SQL migrations (commit new ones)
  seed.ts                 Creates the first admin user
scripts/
  create-user.ts          Create a password account (--admin / --super for staff)
  dev/mock-oauth.mjs      Stand-in Google/Facebook-style login provider for testing
  set-env.sh              Save values into .env without showing them (e.g. app secrets)
  check-meta.ts           `npm run meta:check`: verify Meta settings with Meta
src/
  auth.ts / auth.config.ts  Auth.js: providers, database-backed session checks, sign-in records
  middleware.ts           Sends signed-out people to /login (except public pages); roles are checked on the server
  app/
    page.tsx              PUBLIC home page: listed adverts and sign-in
    login/                Sign-in: Google/Facebook for users, email + password for staff
    me/                   USER dashboard: subscribe per advert/platform, WhatsApp link, feed, sessions
    (dashboard)/          Staff area: admin/ (overview, adverts, users, roles), Create, Channels, Audience, Approvals, Posts
      create/             AI image + caption composer with per-platform checks (saves adverts as drafts)
      channels/           Meta / X / TikTok containers: settings (connect/disconnect) + social containers
      audience/           Subscribers, topics, WhatsApp template, subscribe link
      approvals/          Proposed sends waiting for approval + history
    subscribe/            PUBLIC: subscribe form and /subscribe/manage/<token> (change topics, unsubscribe)
    api/auth/             Auth.js route handlers
    api/webhooks/meta/    Meta webhook (verification + signed event intake)
    api/media/[id]/       Public image URLs platforms download from (blocked images return 404)
    api/meta|x|tiktok/    OAuth "connect" + "callback" routes per platform
  lib/
    db.ts                 Prisma client
    session.ts            pageViewer / requireStaff / requireSuperAdmin, activity log
    adverts.ts            Listing adverts, their platforms/handles, posting an advert to its platforms
    crypto.ts             Token encryption
    queue.ts              BullMQ queue + schedulePost()
    schedule.ts           Next-run calculation (once/daily/weekly/monthly, timezone-aware)
    channels.ts           runChannel() and runDueChannels(): turn a channel's advert into a post
    tokens.ts             Access token lookup with X/TikTok refresh
    handles.ts            Container groups, handle cleanup/matching, profile links
    audience.ts           Phone/town cleanup, confirmation codes, matching adverts to subscribers, proposing campaigns
    consent.ts            Consent options for admin-added people (safe for client components)
    campaigns.ts          Sending approved campaigns over WhatsApp; STOP and delivery-status webhooks
    oauth-state.ts        CSRF state + PKCE cookies for OAuth flows
    x.ts / tiktok.ts      X and TikTok clients
    media.ts              Image format/size detection, public URLs, loading
    ai/openai.ts          Image generation + moderation calls
    policy/
      rules.ts            Per-platform limits, content policy, restricted topics (edit here)
      review.ts           Runs the checks and returns a verdict per platform
      subscriptions.ts    Automatic subscription approval rules (WhatsApp policy) and decisions
    meta/
      graph.ts            Shared Graph API fetch wrapper
      facebook.ts         Page posts (text, photo) and photo stories
      instagram.ts        Image posts and stories (container -> publish)
      oauth.ts            Facebook Login: token exchange, Pages + linked Instagram accounts
      whatsapp.ts         Text + template messages
      webhook.ts          X-Hub-Signature-256 verification
  worker/index.ts         Worker: runs due schedules every 30s and publishes each post per target
```

### Data model in short

- **SocialAccount** is one connected Facebook Page, Instagram account, WhatsApp number, X account or TikTok account, with encrypted tokens and the real `handle`/`profileUrl` the platform reported.
- **ChannelGroup** is a parent container (`META`, `X`, `TIKTOK`) holding its platforms' social containers.
- **Channel** is one platform's social container: the expected `handle`, post format (`POST`/`STORY`), the advert (a draft `Post`), the schedule (`frequency`, `runAt`, `timeOfDay`, `weekdays`, `dayOfMonth`, `timezone`), `enabled`/`nextRunAt`, the last run's result, and WhatsApp recipients/template.
- **Post** holds the content, media URLs, status and schedule time.
- **PostTarget** links one post to one account, with its `format` (and, for WhatsApp, a recipient). Each target succeeds or fails on its own, so a failure on one platform doesn't block the others. Posts created by a schedule have `channelId` set.
- **WebhookEvent** stores raw Meta webhook payloads; WhatsApp STOP replies and delivery statuses are processed.
- **Interest** is a topic subscribers choose and adverts are tagged with (`Post.interests`, plus optional `Post.targetLocations`).
- **Subscriber** is a person who opted in: name, WhatsApp number, town, topics, consent record (text, time, IP, `source`: self sign-up or admin with how consent was collected), `confirmCode`/`confirmedAt` (number ownership), status (`PENDING` → `ACTIVE`, or `NEEDS_REVIEW` / `REJECTED` / `UNSUBSCRIBED`), the automatic `checks` and who decided (`decidedBy`: `auto` or an admin), and a secret `manageToken` for their own manage link.
- **Campaign** is one proposed send of an advert to its matched subscribers (`PENDING_APPROVAL` → `APPROVED` → `SENDING` → `SENT`, or `REJECTED`/`FAILED`). **Delivery** is one message to one subscriber, with its WhatsApp message ID and status (`SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`).
- **Setting** holds small admin settings, e.g. the WhatsApp template for audience adverts.
- **MediaAsset** stores an image (generated or uploaded), its moderation result, and a `blocked` flag.

---

## Development environment (remote, recommended)

This repo is set up to be developed **entirely in the cloud with GitHub Codespaces**, so nothing needs to be installed locally. This also works with Claude Code remote sessions.

1. On GitHub, click **Code → Codespaces → Create codespace on main**.
2. The dev container starts the app container, **Postgres** and **Redis**, then runs `.devcontainer/setup.sh`, which:
   - creates `.env` from `.env.example`, with DB/Redis URLs, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` and `AUTH_URL` filled in for the Codespace,
   - installs dependencies, applies migrations, and seeds the admin user.
3. Start the app:
   ```bash
   npm run dev       # web app on port 3000
   npm run worker    # in a second terminal: the publish worker
   ```
4. **Previewing:** Codespaces forwards port **3000** and opens it in a preview tab. The URL has the form `https://<codespace-name>-3000.app.github.dev`. You can also open it from the **Ports** tab. The port is private by default, so only people signed in to GitHub with access to the Codespace can see it.
5. Sign in with `admin@example.com` / `change-me-please`. **Change these in `.env` before sharing the preview.**

Other useful ports: `npm run db:studio` opens Prisma Studio (a database browser) on port 5555.

> **Meta webhooks in Codespaces:** Meta must reach your webhook URL without a GitHub login. To test webhooks, set port 3000 to **Public** in the Ports tab, temporarily, and use `https://<codespace>-3000.app.github.dev/api/webhooks/meta` as the callback URL.

## Image generation & platform checks

The **Create** page (`/create`) generates an image from a description with OpenAI, takes a caption, and shows for each platform whether the post can go out: **Ready to post**, **Check before posting** (warnings), or **Can't post** (blocked).

### Pipeline

1. **Daily limit.** Each user can generate `IMAGE_DAILY_LIMIT` images per 24 hours (default 20) to control cost.
2. **Prompt screening.** The prompt goes through OpenAI moderation first. If any platform would block it, nothing is generated. This uses the strictest rule across platforms.
3. **Generation.** Uses `OPENAI_IMAGE_MODEL` (default `gpt-image-1`) with `moderation: "auto"` (OpenAI's stricter filter; don't lower it) and JPEG output, because Instagram only accepts JPEG. Refusals from OpenAI are shown to the user.
4. **Image + caption review**, per platform (`src/lib/policy/review.ts`):
   - **Technical:** file format, file size, aspect ratio, minimum width, caption length, hashtag and @mention counts, and required image/text.
   - **Content:** OpenAI moderation on the image and caption together. Each category is mapped to block or warn per platform in `moderationPolicy`. Scores near the limit become warnings.
   - **Restricted topics:** keyword rules for regulated goods and claims (alcohol, tobacco/vaping, weapons, drugs, gambling/betting, prescription drugs, adult products, risky financial claims). Facebook and Instagram **warn**; WhatsApp **blocks**, per its Commerce Policy.
5. **Saving** re-runs the review on the server and refuses a post blocked on every platform. Results are stored in `Post.checks`.
6. **Publishing:** the worker re-runs the review per platform right before sending. Any blocker marks that platform's target as `FAILED` with the reason, while other platforms still publish.

**Fail-closed rules.** If moderation can't run (no key, API down), content is blocked, not let through. Images blocked on every platform get `blocked = true`, and `/api/media/<id>` returns 404 for them, so they never get a public URL.

### Current platform limits (`src/lib/policy/rules.ts`)

| | Instagram | Facebook | WhatsApp | X | TikTok |
| --- | --- | --- | --- | --- | --- |
| Image required | Yes | No | No (sent as text for now) | No | Yes (photo post) |
| Formats | JPEG | JPEG, PNG, GIF, WebP | JPEG, PNG | JPEG, PNG, GIF, WebP | JPEG, WebP |
| Max size | 8 MB | 4 MB | 5 MB | 5 MB | 20 MB |
| Aspect ratio | 4:5 to 1.91:1 | Any | Any | Any | Any |
| Text | 2,200 chars, 30 hashtags, 20 mentions | 63,206 chars | 4,096 chars, required | 280 (links count 23, emoji 2) | 4,000 chars |
| Stories | Yes (JPEG, 9:16 advised, no caption) | Yes (JPEG/PNG, 9:16 advised) | No Status via API | No | No |
| Sexual content, hate, threats, graphic violence | Block | Block | Block | Block | Block |
| Harassment, violence, illegal activity | Warn | Warn | Warn; illegal activity blocks | Warn | Warn; illegal activity blocks |
| Restricted goods | Warn | Warn | Block | Warn | Block |

These values come from each platform's developer docs and policies (links at the top of `rules.ts`). **They are a product starting point, not legal advice.** Have them reviewed, and re-check them when Meta updates its docs.

### Setup

Set `OPENAI_API_KEY` in `.env`. GPT image models require a [verified OpenAI organization](https://platform.openai.com/settings/organization/general). Moderation calls are free; image generation is billed per image (quality is set by `OPENAI_IMAGE_QUALITY`). Without a key, the Create page shows a clear error and generates nothing.

For local testing without a key, point `OPENAI_BASE_URL` at a mock server that implements `POST /images/generations` and `POST /moderations`.

## Accounts, roles and sessions

| Role | Signs in with | Lands on | Can |
| --- | --- | --- | --- |
| User | Google or Facebook | `/me` | Browse listed adverts, subscribe per platform, link and confirm a WhatsApp number, see what was sent/posted, manage their sessions |
| Admin | Email + password, or a user promoted by the super admin (keeps their social sign-in) | `/admin` | Everything on the admin side, plus **Users** (`/admin/users`): each user's sign-in methods, sessions, subscriptions and activity, and "Sign out everywhere" |
| Super admin | Email + password | `/admin` | Everything, plus **Roles** (`/admin/roles`): promote users to admin and demote admins. Can't change their own role |

The public home page (`/`) lists the adverts and links to sign-in; `/subscribe` remains for people who want offers by topic on WhatsApp without an account.

**How sessions are secured** (`src/auth.ts`, `src/lib/session.ts`):
- Every sign-in creates a **`UserSession`** row (provider, IP, browser, created, last seen, expiry 30 days) and an **`ActivityLog`** `SIGN_IN` entry. The signed, encrypted cookie only carries that session's ID.
- **Every server-side read of the session checks the database**: the session must exist, be unrevoked and unexpired, and the user not disabled. `lastSeenAt` is updated as they use the site (at most once a minute). The **role is read fresh each time**, so promotions and demotions apply on the person's next click, without signing in again.
- **Access is decided on the server.** Middleware only separates signed-in from signed-out people. Every staff page calls `pageViewer("staff")` (or `"super"`), and every staff action calls `requireStaff()` / `requireSuperAdmin()`. User actions (`src/app/me/actions.ts`) only touch rows belonging to the signed-in user's ID from the checked session, never IDs sent by the browser.
- Users can **sign out other devices** from `/me`; admins can sign a user out everywhere. A revoked device lands on "Your session ended" at its next request. Tampered cookies are rejected.
- **No account takeover by email:** a social sign-in whose email matches a staff (password) account is refused ("sign in with your password"). Social accounts are linked by provider and provider account ID (`Account`).
- After sign-in, return paths are limited to this site (no open redirects).

**Setup:** add `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Google Cloud → OAuth client, redirect URI `https://social.yet-kenya.com/api/auth/callback/google`) and/or `AUTH_FACEBOOK_ID` / `AUTH_FACEBOOK_SECRET` (your Meta app → Facebook Login, redirect URI `https://social.yet-kenya.com/api/auth/callback/facebook`, permissions `email`, `public_profile`). The buttons appear when the keys are set.

**Testing social login without real keys:** run `node scripts/dev/mock-oauth.mjs` and set `MOCK_OAUTH_URL="http://localhost:4040"` in `.env` (development only; ignored in production). A "Continue with Test login" button appears, with a consent screen for test identities (including one using the staff email, which must be refused). It exercises the same flow as Google/Facebook: state, PKCE, token exchange, userinfo, account creation and session records.

## Adverts and what users receive

1. **Admin defines the advert** on **Create**: title, what it's about (shown to users), topics (for topic subscribers), target platforms (only platforms with a container and handle on Channels), AI image, caption. Saving runs every platform check and goes to **Adverts** (`/admin/adverts`).
2. **List** it (optionally "List & post now"). Listed adverts appear on `/` and in users' dashboards with the real handles they're on.
3. **Users subscribe per platform** on `/me` (`AdvertSubscription`). WhatsApp requires a linked, confirmed number: the user enters it, then sends `JOIN <code>` from that phone (a code sent from another number links nothing). The same automatic approval checks as other subscribers apply.
4. **What's sent to whom:**
   - **WhatsApp:** users subscribed to that advert on WhatsApp (plus topic subscribers) are matched automatically, and the send waits on **Approvals**. After approval it goes to their own numbers.
   - **Facebook, Instagram, X, TikTok** (which don't allow messaging individuals): the advert is posted on the business's handle ("List & post now", "Post to platforms now", or a Channels schedule). Subscribers see it in their feed with a link.
5. Each user's **"What you've received"** feed shows their WhatsApp deliveries and the posts of the adverts they subscribed to on each platform.

## Audience, subscribers and approvals

**The user side.** `/subscribe` is the public home page (signed-out visitors to `/` are sent there; staff sign in at `/login`).
1. People enter their name, WhatsApp number (Kenyan `07…`/`01…` numbers become `2547…`/`2541…`), an optional town and the topics they want, and tick the consent box. The consent text, time and IP are stored.
2. **Confirm on WhatsApp:** the next screen shows `JOIN <code>` and a button that opens WhatsApp to the business number (the Meta container's WhatsApp handle) with that message filled in. Sending it from the number that signed up proves they own it; a code sent from a different number is refused. Unconfirmed sign-ups are removed after 7 days.
3. Once confirmed and approved, they get a WhatsApp reply with their **manage link** (`/subscribe/manage/<token>`) to change topics or unsubscribe. Messaging **MANAGE** any time sends the link again; **STOP** (or UNSUBSCRIBE, CANCEL, END, QUIT) unsubscribes. These replies are free-form messages, allowed because the person messaged first.

Entering a number that's already subscribed changes nothing and reveals nothing: the page tells the owner to message MANAGE from that phone. Spam protection: a hidden trap field, and a per-IP limit (10 sign-ups an hour, with more than 3 flagged for review).

**Automatic approval** (`src/lib/policy/subscriptions.ts`, listed on the Audience page). Every subscription, self sign-up or admin-added, is checked:

| Check | Based on | If it fails |
| --- | --- | --- |
| Opt-in consent recorded | WhatsApp Business Messaging Policy: opt-in required | Rejected |
| Valid phone number | Messages only reach real numbers | Rejected |
| Country WhatsApp Business can message (not Cuba, Iran, North Korea, Syria; extend with `BLOCKED_COUNTRY_CODES`; optionally restrict with `ALLOWED_COUNTRY_CODES`) | Meta sanctions rules | Rejected (or review outside allowed countries) |
| Number ownership: self sign-ups send JOIN; admin-added people rely on the admin's consent record | Opt-in must come from the number's owner | Waits for confirmation |
| Name passes the content check (OpenAI moderation; links/only digits flagged) | No abusive entries | Admin review |
| Not one of many sign-ups from the same network in an hour | Spam protection | Admin review |
| Not re-added by an admin after they unsubscribed | Opt-outs must be honoured | Admin review |

All pass → **accepted automatically** (`decidedBy: "auto"`), and they're immediately matched to existing adverts. Any review → **Approvals → Subscriptions to review** (Approve, Reject or Check again). Any fail → rejected automatically, with the reason shown to the person.

**The admin side.**
- **Audience** (`/audience`): totals (subscribed, joined this week, waiting to confirm, needs review, unsubscribed); **Add people**, either one person or many at once (one per line: `Name, phone, town, Topic; Topic`), each with how consent was collected and a confirmation that they agreed, then run through the same automatic checks; the automatic approval rules; the subscribe link to share; **topics** (add/remove, with subscriber counts; 6 starter topics come from the seed); the **WhatsApp template** setting; and the subscriber list with search and filters by topic and status. Admins can unsubscribe someone, or delete their data on request. Re-subscribing needs the person's own consent.
- **Create:** when saving an advert, tick the topics it's for and, optionally, towns. Saving immediately matches subscribers and proposes a send.
- **Approvals** (`/approvals`, with a count badge in the nav): **Subscriptions to review** (flagged by the checks), then advert sends. Each send proposal shows the advert, who it reaches (count, by topic, by town, sample names), why it was proposed, and its WhatsApp check. **Approve & send** or **Reject** is the only manual step. History shows each send's results.

**What's automatic.**
- **Matching:** active subscribers with any of the advert's topics, in its towns if set (case-insensitive), who haven't already received or been queued for it.
- **Proposals:** a campaign is proposed when an advert with topics is saved, when someone subscribes or changes topics, and every ~10 minutes by the worker (safety net). New matches top up a proposal that's still waiting. Rejected adverts are never proposed again.
- **Sending** (worker, after approval): checks the advert against WhatsApp's rules again; sends through the WhatsApp number connected in the **Meta container** (matching its handle); skips people who unsubscribed or got an advert within `AUDIENCE_MIN_HOURS_BETWEEN_MESSAGES` (default 24). Skipped and failed people are proposed again later.
- **Receipts:** WhatsApp `delivered` / `read` / `failed` statuses update each delivery (requires the webhook below).

**WhatsApp setup for audience adverts.**
1. In WhatsApp Manager, create a **Marketing** template, e.g. `audience_offer`: **Header** Image (optional; the advert's image is used), **Body** `Hi {{1}}, {{2}}` ({{1}} = first name, {{2}} = advert text), **Footer** "Reply STOP to unsubscribe". Wait for Meta to approve it.
2. Enter the template name and language on the Audience page.
3. Make sure the Meta container has WhatsApp with its number as the handle, and the number is connected.
4. Subscribe the Meta webhook to `whatsapp_business_account` → `messages` (callback `https://social.yet-kenya.com/api/webhooks/meta`), so STOP replies and receipts arrive.

Meta limits how many marketing messages each person receives, and may hold some back. Those show as `failed` with Meta's reason.

## Channels and scheduling

The **Channels** page (`/channels`) is where adverts get posted automatically.

- **Add new** (top right) opens a dropdown of containers that don't exist yet: **Meta**, **X**, **TikTok**. Choosing **Meta** lists Facebook, Instagram and WhatsApp to tick. Each chosen platform needs its **handle**:
  - Facebook: Page username or link, e.g. `facebook.com/mangomarketke` (a Page name or ID also works)
  - Instagram, X, TikTok: `@handle` or a profile link
  - WhatsApp: the business number, e.g. `+254 700 000 000`

  Handles are cleaned up (links, `@`, case, spaces), so pasting a profile URL is fine.
- **Edit** (on each container) changes handles and, for Meta, which platforms are included. Removing a platform deletes its social container and disconnects its accounts. Changing a handle disconnects accounts that no longer match. **Delete** removes the whole container.
- **Settings** is only for connecting and disconnecting the real accounts. It shows each handle (linked to the real profile) and what's connected:
  - **Meta:** one **Connect Facebook & Instagram** sign-in. Facebook lists the Pages the admin shares; only the Page matching the Facebook handle and the Instagram account matching the Instagram handle are linked. If the named Page/account wasn't shared, the page says so and lists what was shared. WhatsApp connects with a phone number ID and token, and is refused if it's a different number from the handle.
  - **X / TikTok:** the platform's sign-in and consent screen. Signing in as a different account than the handle is refused, naming both. (TikTok needs the `user.info.profile` scope to confirm the username.)
- **Each social container** (one per platform inside the parent) holds:
  - **Post as:** Post or Story (Facebook, Instagram); Message (WhatsApp; Status isn't available); Post (X, TikTok).
  - **Advert:** a draft saved from the Create page.
  - **Schedule:** Once (date and time), Daily, Weekly (chosen days) or Monthly (chosen date; shorter months use their last day), at a time in `APP_TIMEZONE` (default `Africa/Nairobi`).
  - **WhatsApp only:** recipients (one per line, international format) and an approved template name and language.
  - **Schedule on**, **Save** and **Post now**. Post now saves the form first.
- **Turning a schedule on requires** an advert, a connected account matching the handle, WhatsApp recipients where relevant, and a passing check for that platform **and format**. Otherwise it's saved switched off, with the reason.
- **Each run** copies the advert into a new post targeting the connected accounts that match the handle, and the worker publishes it after re-running the checks. The result (or the platform's error) shows on the social container and under Posts.
- **The scheduler** is in the worker (`runDueChannels`, every `SCHEDULER_TICK_MS`, default 30s). Each run is claimed atomically, so multiple workers don't double-post. If the worker was down, a missed run posts once, then continues from the next future time. **Nothing posts unless `npm run worker` is running.**

Platform behaviour to know:
- **X rejects a post identical to a recent one.** A repeating schedule with the same advert will fail from the second run with X's "duplicate content" error.
- **TikTok:** until TikTok audits the app, posts are visible only to the account owner (`SELF_ONLY`). Photo URLs must be on a domain verified in the TikTok developer portal (`social.yet-kenya.com`).
- **WhatsApp** only delivers free-form messages within 24 hours of the recipient's last message; scheduled messages should use an approved template.

## Shared preview (Cloudflare tunnel)

The app is also served from the project owner's Mac at **https://social.yet-kenya.com**, so the developer and stakeholders can open it from anywhere. This is useful when working through Claude Code Remote Control on that machine.

- Hostname `social.yet-kenya.com` is an ingress rule on the existing `alphabank` Cloudflare tunnel (`~/.cloudflared/config.yml` on the host Mac). It forwards to `http://localhost:3100`.
- On the host, run the app on that port: `docker compose up -d` (Postgres and Redis restart automatically), then `npm run dev:tunnel`, plus `npm run worker` if needed.
- `.env` on the host must have `AUTH_URL="https://social.yet-kenya.com"` and `ALLOWED_DEV_ORIGINS="social.yet-kenya.com"`. Without the second one, Next.js blocks hot reload from the tunnel domain.
- Meta webhook callback URL for this environment: `https://social.yet-kenya.com/api/webhooks/meta`.
- The URL is public. Keep a strong admin password, and put Cloudflare Access in front of it, with a bypass for `/api/webhooks/meta` so Meta can still reach the webhook.

## Local setup (alternative)

Requires Node 22+ and Docker.

```bash
cp .env.example .env            # then fill AUTH_SECRET and TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d            # Postgres + Redis
npm install
npx prisma migrate deploy
npm run db:seed                 # creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                     # http://localhost:3000
npm run worker                  # second terminal
```

## Managing users

Users create their own accounts by signing in with Google or Facebook. Staff are promoted by the super admin on `/admin/roles`, or created with a password from the command line:

```bash
npm run user:create -- jane@company.com 'a-strong-password' "Jane Doe"
npm run user:create -- ops@company.com 'another-password' "Ops" --admin
npm run user:create -- owner@company.com 'a-third-password' "Owner" --super
```

A future improvement is an admin-only "Users" page in the dashboard that does the same thing.

## Environment variables

See [`.env.example`](.env.example) for the full list with comments. The main ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis connections |
| `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST` | Auth.js session signing and the public base URL |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin user (seed) |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key for encrypting Meta tokens |
| `META_APP_ID`, `META_APP_SECRET` | Meta app credentials (the secret also verifies webhook signatures) |
| `META_GRAPH_API_VERSION` | Graph API version, e.g. `v23.0`. Check the [changelog](https://developers.facebook.com/docs/graph-api/changelog) and update it as needed |
| `META_WEBHOOK_VERIFY_TOKEN` | Must match the token set in the Meta webhook config |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API |

## Meta app setup (connecting real accounts)

Accounts are connected from each container's **Settings** on the Channels page. Only admins can connect or disconnect. In the Meta container, one Facebook sign-in links the Page and Instagram account matching the container's handles. Run `npm run meta:check` to verify the app ID and secret with Meta.

### 1. Create the app
1. At [developers.facebook.com/apps](https://developers.facebook.com/apps), choose **Create app**, then the **Other → Business** type (or the "Manage everything on your Page" and "Connect with customers through WhatsApp" use cases). Connect it to your Business portfolio.
2. **App settings → Basic:** copy the **App ID** and **App secret** into `.env` as `META_APP_ID` and `META_APP_SECRET`. Set the Privacy Policy URL and app domain (`social.yet-kenya.com`).

### 2. Facebook Login (Pages + Instagram)
1. Add the **Facebook Login for Business** product.
2. In its **Settings**, add the redirect URI shown in the Meta container's Settings (Channels page), e.g. `https://social.yet-kenya.com/api/meta/callback`, under **Valid OAuth Redirect URIs**. It must match exactly, and it must be HTTPS.
3. Permissions requested: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Optionally create a Login configuration with these and set `META_LOGIN_CONFIG_ID`.
4. Instagram must be a **professional (Business or Creator) account linked to a Facebook Page**. It's connected through that Page.
5. Then on Channels, choose **Add new → Meta**, tick the platforms, enter their handles, and press **Connect Facebook & Instagram** in the container's Settings. Sign in and select the Page to share.

**Development mode:** without App Review, only people with a role on the Meta app (admin, developer or tester) can connect, and only Pages they manage. That's enough to connect your own accounts. To let other businesses connect, submit those permissions for **App Review** (Advanced Access) and complete **Business Verification**.

### 3. WhatsApp
1. Add the **WhatsApp** product. Under **API Setup**, note the **Phone number ID** and **WhatsApp Business Account ID**. Add and verify your real business number to replace the test number.
2. For a permanent token, go to **Business settings → System users**, create a system user, assign it the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on API Setup expires in 24 hours.
3. In the Meta container's Settings (with WhatsApp ticked and its number as the handle), enter the phone number ID and token. The app checks them with Meta before saving. Alternatively, set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` in `.env` and use "Add number from server settings", so the token never goes through a browser.

### 4. Webhooks (optional for now)
Callback URL `https://social.yet-kenya.com/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN` from `.env`. Subscribe to `page`, `instagram` and `whatsapp_business_account` fields as needed.

### How connection works (for developers)
- `GET /api/meta/connect` (admin): sets a CSRF `state` cookie and redirects to Facebook's OAuth dialog (`src/lib/meta/oauth.ts`).
- `GET /api/meta/callback`: verifies `state`, exchanges the code for a long-lived user token, lists `/me/accounts` with linked `instagram_business_account`, and upserts a `SocialAccount` for the Page matching the Facebook handle and the linked Instagram account matching the Instagram handle. Page tokens obtained this way don't expire; Instagram uses its Page's token.
- All Graph calls send `appsecret_proof`, so you can enable **Require App Secret** in the Meta app.
- Testing without Meta: set `META_GRAPH_BASE_URL` and `META_DIALOG_BASE_URL` to a mock server.

## X app setup
1. In the [X developer portal](https://developer.x.com), create a project and app on a plan that allows posting.
2. Under **User authentication settings**, enable OAuth 2.0 with type **Web App (confidential client)**, permissions **Read and write**, callback URL `https://social.yet-kenya.com/api/x/callback`, and website `https://social.yet-kenya.com`.
3. Put the OAuth 2.0 **Client ID** and **Client Secret** in `.env` as `X_CLIENT_ID` and `X_CLIENT_SECRET` (`bash scripts/set-env.sh X_CLIENT_ID X_CLIENT_SECRET`).
4. Scopes requested: `tweet.read tweet.write users.read media.write offline.access`. Access tokens last about 2 hours and are refreshed automatically.

## TikTok app setup
1. In the [TikTok developer portal](https://developers.tiktok.com), create an app and add **Login Kit** and **Content Posting API** (with Direct Post).
2. Set the redirect URI `https://social.yet-kenya.com/api/tiktok/callback`, and verify the domain/URL prefix `https://social.yet-kenya.com/api/media/` so TikTok can pull photos.
3. Put the **Client key** and **Client secret** in `.env` as `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
4. Scopes requested: `user.info.basic,user.info.profile,video.publish` (`user.info.profile` returns the username used to confirm the right account). Until TikTok audits the app, posts are private (`SELF_ONLY`). After approval, set `TIKTOK_PRIVACY_LEVEL` (e.g. `PUBLIC_TO_EVERYONE`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run worker` | Publish worker (BullMQ) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Create + apply a new migration after editing `schema.prisma` |
| `npm run db:deploy` | Apply existing migrations |
| `npm run db:seed` | Create the admin user |
| `npm run db:studio` | Prisma Studio |
| `npm run user:create` | Add a user (see above) |
| `npm run meta:check` | Check Meta app and WhatsApp settings with Meta |
| `npm test` | Policy rule, schedule, handle, audience and subscription-approval tests |
| `bash scripts/set-env.sh NAME…` | Save `.env` values without showing them |

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every push and PR.

**After any schema change** (`npm run db:migrate`), restart `npm run dev` and `npm run worker`. A running process keeps the old Prisma client and fails on new tables or enum values.

---

## Next steps

Suggested order:

1. ~~Connect accounts~~ Done: see [Meta app setup](#meta-app-setup-connecting-real-accounts).
2. ~~Scheduling~~ Done: see [Channels and scheduling](#channels-and-scheduling). ~~Audience~~ Done: see [Audience, subscribers and approvals](#audience-subscribers-and-approvals).
3. **Connect live accounts and do a first real post on each platform.** Everything is tested against mock APIs only; real APIs may differ in details (especially X media upload and TikTok photo posting).
4. **Image upload** on `/create` (`MediaAsset` with `source: UPLOADED`, run through the same review), and **9:16 images for stories** (GPT image sizes are 1:1, 3:2 and 2:3).
5. **Advert rotation** per channel, so repeating schedules don't post identical content (required for X).
6. **Instagram publishing limit** check (`content_publishing_limit`) before posting.
7. **Media storage.** Images are stored in Postgres and served from `/api/media/<id>`. Move them to S3, R2 or Cloudinary before real traffic.
8. **Audience extras:** CSV file upload (today: paste lines), per-subscriber message history, opt-in via WhatsApp click-to-chat ads, and an approval step for scheduled Channel posts if wanted.
9. **Webhook processing.** Handle stored `WebhookEvent`s, e.g. WhatsApp delivery statuses and inbound messages, and comments.
10. **Token health.** Alert when a refresh fails (X/TikTok) so an admin can reconnect.
11. **Admin UI for users**, to replace the CLI with an admin-only page. Consider an admin override or approval step for posts with warnings.
12. **Automated end-to-end tests** (Playwright with mock platform APIs) in CI.
13. **Deployment.** The web app runs on Vercel or any Node host. The worker needs a long-running process (Railway, Render, Fly.io, a VM) plus managed Postgres and Redis. Vercel also gives preview deployments for every PR.

## Useful links

- Facebook Pages API: https://developers.facebook.com/docs/pages-api
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- X API: https://docs.x.com/x-api
- TikTok Content Posting API: https://developers.tiktok.com/doc/content-posting-api-get-started
- Meta webhooks: https://developers.facebook.com/docs/graph-api/webhooks
- Auth.js: https://authjs.dev
- BullMQ: https://docs.bullmq.io
