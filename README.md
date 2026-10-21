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

## Tech stack

- **Next.js 15** (App Router, TypeScript, Server Actions) + **Tailwind CSS 4**
- **Auth.js (NextAuth v5)** with email/password credentials, JWT sessions
- **PostgreSQL** + **Prisma** ORM
- **Redis** + **BullMQ** for scheduled publishing jobs
- **Meta Graph API** (Facebook Pages API, Instagram Content Publishing API, WhatsApp Cloud API)

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
    (dashboard)/          Signed-in area: Overview, Posts, Accounts
    api/auth/             Auth.js route handlers
    api/webhooks/meta/    Meta webhook (verification + signed event intake)
  lib/
    db.ts                 Prisma client
    crypto.ts             Token encryption
    queue.ts              BullMQ queue + schedulePost()
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

## Meta app setup

1. Create a **Business** app at [developers.facebook.com/apps](https://developers.facebook.com/apps).
2. Add these products: **Facebook Login for Business**, **Instagram** (Graph API), **WhatsApp**, **Webhooks**.
3. Permissions you'll need (request Advanced Access through App Review before going live):
   - Facebook: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
   - Instagram: `instagram_basic`, `instagram_content_publish`
   - WhatsApp: `whatsapp_business_messaging`, `whatsapp_business_management`
4. The Instagram account must be a **Business or Creator** account linked to a Facebook Page.
5. For WhatsApp, the dashboard gives you a test phone number ID and temporary token for development. Use a **System User** token for production.
6. Webhooks: callback URL `<APP_URL>/api/webhooks/meta`, verify token `META_WEBHOOK_VERIFY_TOKEN`. Subscribe to `page`, `instagram` and `whatsapp_business_account` fields as needed.

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

1. **Connect accounts (OAuth).** Add a "Connect with Facebook" flow on `/accounts` using Facebook Login for Business. Exchange for a long-lived user token, list the user's Pages (`/me/accounts`) and their linked IG accounts (`?fields=instagram_business_account`), and save each as a `SocialAccount` with `encrypt(token)`. For WhatsApp, add a form or env-based setup for the phone number ID and system user token.
2. **Post composer** on `/posts`: content, media upload, target accounts and schedule time. Create `Post` + `PostTarget` rows, then call `schedulePost(post.id, scheduledAt)` from `src/lib/queue.ts`.
3. **Media storage.** Instagram and Facebook need public image URLs. Add an S3, R2 or Cloudinary upload and save the URLs in `Post.mediaUrls`.
4. **WhatsApp audiences.** Add a contacts/recipients model, template management, and use `sendTemplate` for recipients outside the 24h window.
5. **Webhook processing.** Handle stored `WebhookEvent`s, e.g. WhatsApp delivery statuses and inbound messages, and comments.
6. **Token refresh.** Refresh or alert before `tokenExpiresAt`. Page tokens derived from long-lived user tokens don't expire, but user tokens do.
7. **Admin UI for users**, to replace the CLI with an admin-only page.
8. **Tests** (e.g. Vitest for `lib/`, Playwright for login and the posting flow).
9. **Deployment.** The web app runs on Vercel or any Node host. The worker needs a long-running process (Railway, Render, Fly.io, a VM) plus managed Postgres and Redis. Vercel also gives preview deployments for every PR.

## Useful links

- Facebook Pages API: https://developers.facebook.com/docs/pages-api
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Meta webhooks: https://developers.facebook.com/docs/graph-api/webhooks
- Auth.js: https://authjs.dev
- BullMQ: https://docs.bullmq.io
