# Social Media Automation

A web app for scheduling and publishing content to **Meta platforms**: **Facebook Pages**, **Instagram** (Business/Creator accounts), and **WhatsApp** (Cloud API). It has one dashboard and a background worker that publishes at the scheduled time.

> **Status:** scaffold. Sign-in, the database schema, Meta API clients, the webhook endpoint and the publish worker are in place. The "connect account" OAuth flow and the post composer still need to be built. See [Next steps](#next-steps).

---

## Key decisions

| Decision | Detail |
| --- | --- |
| **Sign-in only, no sign-up** | There is no registration page. Users are created by an admin with a CLI script (see [Managing users](#managing-users)). The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` via the seed. |
| **Meta platforms only (for now)** | Facebook, Instagram and WhatsApp all go through the Meta Graph API, sharing one client (`src/lib/meta/graph.ts`). Other networks can be added later as new `Platform` enum values and clients. |
| **WhatsApp is messaging, not a feed** | "Publishing" to WhatsApp means sending a message to recipients. Free-form text only works within 24h of the recipient's last message; otherwise a pre-approved **template** is required (`sendTemplate`). |
| **Instagram needs media** | The Instagram API cannot post text-only. Images must be at a **public URL** that Meta can fetch. |
| **Tokens encrypted at rest** | Meta access tokens are stored with AES-256-GCM (`src/lib/crypto.ts`). |
| **AI images go through platform checks** | Images are generated with OpenAI's GPT image API. Every prompt, image and caption is checked against each platform's rules before it can be saved or published (see [Image generation & platform checks](#image-generation--platform-checks)). |

## Tech stack

- **Next.js 15** (App Router, TypeScript, Server Actions) + **Tailwind CSS 4**
- **Auth.js (NextAuth v5)** with email/password credentials, JWT sessions
- **PostgreSQL** + **Prisma** ORM
- **Redis** + **BullMQ** for scheduled publishing jobs
- **Meta Graph API** (Facebook Pages API, Instagram Content Publishing API, WhatsApp Cloud API)
- **OpenAI** GPT image generation + `omni-moderation-latest` content moderation

## Project structure

```
.devcontainer/            Codespaces / dev container (app + Postgres + Redis)
prisma/
  schema.prisma           Data model: User, SocialAccount, Post, PostTarget, WebhookEvent
  migrations/             SQL migrations (commit new ones)
  seed.ts                 Creates the first admin user
scripts/create-user.ts    Admin CLI to add users (replaces sign-up)
src/
  auth.ts / auth.config.ts  Auth.js setup (credentials provider)
  middleware.ts           Protects every page except /login, /api/auth, /api/webhooks
  app/
    login/                Sign-in page + server action
    (dashboard)/          Signed-in area: Overview, Create, Posts, Accounts
      create/             AI image + caption composer with per-platform checks
    api/auth/             Auth.js route handlers
    api/webhooks/meta/    Meta webhook (verification + signed event intake)
    api/media/[id]/       Public image URLs Meta downloads from (blocked images return 404)
  lib/
    db.ts                 Prisma client
    crypto.ts             Token encryption
    queue.ts              BullMQ queue + schedulePost()
    media.ts              Image format/size detection, public URLs, loading
    ai/openai.ts          Image generation + moderation calls
    policy/
      rules.ts            Per-platform limits, content policy, restricted topics (edit here)
      review.ts           Runs the checks and returns a verdict per platform
    meta/
      graph.ts            Shared Graph API fetch wrapper
      facebook.ts         Page posts (text, photo)
      instagram.ts        Image publish (container -> publish)
      whatsapp.ts         Text + template messages
      webhook.ts          X-Hub-Signature-256 verification
  worker/index.ts         Worker that publishes posts to each target
```

### Data model in short

- **SocialAccount** is one connected Facebook Page, Instagram account or WhatsApp phone number, with an encrypted token.
- **Post** holds the content, media URLs, status and schedule time.
- **PostTarget** links one post to one account (and, for WhatsApp, a recipient). Each target succeeds or fails on its own, so a failure on one platform doesn't block the others.
- **WebhookEvent** stores raw Meta webhook payloads for later processing.
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

| | Instagram | Facebook | WhatsApp |
| --- | --- | --- | --- |
| Image required | Yes | No | No (sent as text for now) |
| Formats | JPEG | JPEG, PNG, GIF, WebP | JPEG, PNG |
| Max size | 8 MB | 4 MB | 5 MB |
| Aspect ratio | 4:5 to 1.91:1 | Any | Any |
| Text | 2,200 chars, 30 hashtags, 20 mentions | 63,206 chars | 4,096 chars, required |
| Sexual content, hate, threats, graphic violence | Block | Block | Block |
| Harassment, violence, illegal activity | Warn | Warn | Warn; illegal activity blocks |
| Restricted goods | Warn | Warn | Block |

These values come from Meta's developer docs and policies (links at the top of `rules.ts`). **They are a product starting point, not legal advice.** Have them reviewed, and re-check them when Meta updates its docs.

### Setup

Set `OPENAI_API_KEY` in `.env`. GPT image models require a [verified OpenAI organization](https://platform.openai.com/settings/organization/general). Moderation calls are free; image generation is billed per image (quality is set by `OPENAI_IMAGE_QUALITY`). Without a key, the Create page shows a clear error and generates nothing.

For local testing without a key, point `OPENAI_BASE_URL` at a mock server that implements `POST /images/generations` and `POST /moderations`.

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

There is no sign-up. To add someone:

```bash
npm run user:create -- jane@company.com 'a-strong-password' "Jane Doe"
npm run user:create -- ops@company.com 'another-password' "Ops" --admin
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

The **Accounts** page connects real Pages, Instagram accounts and WhatsApp numbers. Only admins can connect or disconnect. Tokens are stored encrypted (`SocialAccount.accessTokenEncrypted`).

### 1. Create the app
1. At [developers.facebook.com/apps](https://developers.facebook.com/apps), choose **Create app**, then the **Other → Business** type (or the "Manage everything on your Page" and "Connect with customers through WhatsApp" use cases). Connect it to your Business portfolio.
2. **App settings → Basic:** copy the **App ID** and **App secret** into `.env` as `META_APP_ID` and `META_APP_SECRET`. Set the Privacy Policy URL and app domain (`social.yet-kenya.com`).

### 2. Facebook Login (Pages + Instagram)
1. Add the **Facebook Login for Business** product.
2. In its **Settings**, add the redirect URI shown on the Accounts page, e.g. `https://social.yet-kenya.com/api/meta/callback`, under **Valid OAuth Redirect URIs**. It must match exactly, and it must be HTTPS.
3. Permissions requested: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Optionally create a Login configuration with these and set `META_LOGIN_CONFIG_ID`.
4. Instagram must be a **professional (Business or Creator) account linked to a Facebook Page**. It's connected through that Page.
5. Then go to Accounts → **Connect with Facebook**, sign in, and select the Pages to share.

**Development mode:** without App Review, only people with a role on the Meta app (admin, developer or tester) can connect, and only Pages they manage. That's enough to connect your own accounts. To let other businesses connect, submit those permissions for **App Review** (Advanced Access) and complete **Business Verification**.

### 3. WhatsApp
1. Add the **WhatsApp** product. Under **API Setup**, note the **Phone number ID** and **WhatsApp Business Account ID**. Add and verify your real business number to replace the test number.
2. For a permanent token, go to **Business settings → System users**, create a system user, assign it the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on API Setup expires in 24 hours.
3. On Accounts, enter the phone number ID and token. The app checks them with Meta before saving. Alternatively, set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` in `.env` and use "Connect the number from server settings", so the token never goes through a browser.

### 4. Webhooks (optional for now)
Callback URL `https://social.yet-kenya.com/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN` from `.env`. Subscribe to `page`, `instagram` and `whatsapp_business_account` fields as needed.

### How connection works (for developers)
- `GET /api/meta/connect` (admin): sets a CSRF `state` cookie and redirects to Facebook's OAuth dialog (`src/lib/meta/oauth.ts`).
- `GET /api/meta/callback`: verifies `state`, exchanges the code for a long-lived user token, lists `/me/accounts` with linked `instagram_business_account`, and upserts one `SocialAccount` per Page and per Instagram account. Page tokens obtained this way don't expire; Instagram uses its Page's token.
- All Graph calls send `appsecret_proof`, so you can enable **Require App Secret** in the Meta app.
- Testing without Meta: set `META_GRAPH_BASE_URL` and `META_DIALOG_BASE_URL` to a mock server.

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

CI (`.github/workflows/ci.yml`) runs typecheck and build on every push and PR.

---

## Next steps

Suggested order:

1. ~~Connect accounts~~ Done: see [Meta app setup](#meta-app-setup-connecting-real-accounts).
2. **Finish the composer** on `/create`: add target accounts and a schedule time to the draft (create `PostTarget` rows, then call `schedulePost(post.id, scheduledAt)` from `src/lib/queue.ts`), plus image upload (`MediaAsset` with `source: UPLOADED`, run through the same review).
3. **Media storage.** Images are stored in Postgres and served from `/api/media/<id>`. Move them to S3, R2 or Cloudinary before real traffic.
4. **WhatsApp audiences.** Add a contacts/recipients model, template management, and use `sendTemplate` for recipients outside the 24h window.
5. **Webhook processing.** Handle stored `WebhookEvent`s, e.g. WhatsApp delivery statuses and inbound messages, and comments.
6. **Token refresh.** Refresh or alert before `tokenExpiresAt`. Page tokens derived from long-lived user tokens don't expire, but user tokens do.
7. **Admin UI for users**, to replace the CLI with an admin-only page. Consider an admin override or approval step for posts with warnings.
8. **Tests** (e.g. Vitest for `lib/`, Playwright for login and the posting flow).
9. **Deployment.** The web app runs on Vercel or any Node host. The worker needs a long-running process (Railway, Render, Fly.io, a VM) plus managed Postgres and Redis. Vercel also gives preview deployments for every PR.

## Useful links

- Facebook Pages API: https://developers.facebook.com/docs/pages-api
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Meta webhooks: https://developers.facebook.com/docs/graph-api/webhooks
- Auth.js: https://authjs.dev
- BullMQ: https://docs.bullmq.io
