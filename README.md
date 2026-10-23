# PureTask Lite

A personal day planner with a voice AI assistant. Tasks live in a calendar
tree (Years → Months → Weeks → Days) with nested sub-notes, coloured
statuses and priorities, and drag and drop. Instead of typing, you can tap the
microphone and say *"Add gym on Monday and Wednesday, high priority"*: the
assistant changes the plan and answers out loud.

I built it as my own daily tool, and this repository is public as a portfolio
piece. It is a single-user app behind a password; there is no public demo.

---

## Highlights

- **Voice assistant that changes real data safely.** One request makes one
  AI call, which returns a spoken reply plus a table of operations (create,
  update, delete). The server checks every operation and saves them all in
  one database transaction, so a request is applied completely or not at
  all. Deleting a task that has sub-notes always waits for your confirmation.
- **Planner that feels native on phone and desktop.**
  - Spring-animated, lazily rendered calendar tree with guide lines.
  - Sub-notes up to three levels deep, inline rename (double-click or
    double-tap), and status/priority pickers.
  - Drag and drop anywhere: mouse grip, or long-press on touch.
  - Priority sorting, light/dark theme and reduced-motion support.
- **Built for a public URL.**
  - Password login with a signed, HTTP-only session cookie.
  - Login rate limiting stored in Postgres, with exponential lockout.
  - Row Level Security on every table, and all secrets server-side only.
- **Tested.** TypeScript strict mode, input validation on every API route,
  and 138 unit tests covering calendar math, the rate limiter, the AI plan
  validation, drag-and-drop moves and more.

## How the voice assistant works

1. **Record.** The browser records your request (up to 2 minutes).
2. **Transcribe.** Whisper on Groq turns it into text. It gets a short
   vocabulary hint (your status names and current task titles) so names are
   spelled right.
3. **Build the context.** The server adds today's date, the last 20
   messages, and a compact list of your tasks. The list always holds last,
   this and next week in full; months you mention, like "June", are added
   automatically.
4. **One AI call.** `gpt-oss-120b` on Groq answers in a fixed JSON shape
   (strict structured output): `reply`, `operations`, and an optional
   `lookup` for tasks it can't see, the only case that needs a second call.
5. **Validate.** Dates, task references, label names and the depth limit
   are checked. Anything invalid is dropped and reported in the reply.
6. **Save.** Everything goes into one transaction.
7. **Reply.** The answer is shown, read aloud by the browser's speech
   synthesis, and the calendar refreshes.

## Tech stack

| Area | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 4, Motion (spring animations), zustand |
| Data | Postgres (Supabase), Drizzle ORM and migrations, postgres-js |
| AI | Groq: Whisper large-v3 (speech-to-text), gpt-oss-120b (structured JSON) |
| Speech output | Browser `speechSynthesis` (free, on-device) |
| Validation and tests | zod, Vitest |
| Hosting | Vercel, with a daily cron job |

## Engineering decisions

- **One structured AI call instead of a tool-calling loop.** An earlier
  version let the model call tools step by step. On Groq's free tier
  (about 8K tokens per minute) a multi-task request ran out of budget
  midway. One JSON answer with temporary references (a sub-note can point to
  a parent created in the same answer) needs roughly a third of the tokens,
  and makes all-or-nothing saving possible.
- **Confirmation is enforced by the server, not the model.** Held deletes are
  confirmed by your next "yes" or "no" without calling the AI again.
- **Serverless-friendly database access.** The app connects through
  Supabase's transaction pooler with `prepare: false`. The browser never
  talks to the database directly.
- **Defence in depth.** The Next.js proxy (formerly called "middleware")
  checks every request, and each route handler verifies the session again.

## Contents

1. [Deploy your own copy](#deploy-to-vercel-step-by-step)
2. [Run it locally](#run-it-locally)
3. [Environment variables](#environment-variables)
4. [Scripts](#scripts)
5. [Using the app](#using-the-app)
6. [How it works](#how-it-works)
7. [Troubleshooting](#troubleshooting)
8. [License](#license)

---

## Deploy to Vercel (step by step)

You need free accounts on **GitHub**, **Vercel** and **Groq**. Supabase is
created for you through Vercel. Allow about 15 minutes.

### 1. Get your own copy of the code

**Fork** this repository on GitHub (top right). Or clone it and push it to a
new repository of your own:

```bash
git clone https://github.com/Folse27/PureTaskLite.git
cd PureTaskLite
gh repo create my-planner --private --source=. --remote=origin --push
```

### 2. Prepare your secrets

- **APP_PASSWORD** — the password you'll type to log in. Make it long (a
  passphrase is ideal); the site is on a public URL.
- **SESSION_SECRET** — a random string of at least 32 characters. Generate one:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```

### 3. Get a free Groq API key

1. Go to **[console.groq.com](https://console.groq.com)** and sign in.
2. Open **API Keys → Create API Key**, give it a name, and copy the key
   (it starts with `gsk_` and is shown only once).

### 4. Import the repo into Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)** → **Import Git Repository**.
   If your repository isn't listed, click **Adjust GitHub App Permissions**
   and grant access to it.
2. Framework preset: **Next.js** (detected automatically). Leave build and
   output settings as they are — Vercel automatically runs the `vercel-build`
   script, which applies database migrations and then builds.
3. Open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `APP_PASSWORD` | your password from step 2 |
   | `SESSION_SECRET` | your random string from step 2 |
   | `GROQ_API_KEY` | your key from step 3 |
   | `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` |
   | `GROQ_STT_MODEL` | `whisper-large-v3` |
   | `CRON_SECRET` | another random string (generate it like `SESSION_SECRET`) |

4. Click **Deploy**. This first build succeeds but logs
   `DATABASE_URL is not set — skipping migrations`, because there is no
   database yet. That's expected.

### 5. Add Supabase Postgres from the Vercel Marketplace

1. In your Vercel project, open the **Storage** tab → **Create Database**
   (or **Browse Marketplace**) → **Supabase** → **Continue**.
2. Pick the **Free** plan and a region. Choose the one closest to you — e.g.
   **Frankfurt (eu-central-1)** for Europe.
3. Connect it to this project for **all environments** (Production, Preview,
   Development).

Vercel now adds Supabase environment variables to the project, including
`POSTGRES_URL` (the pooled connection string), `POSTGRES_URL_NON_POOLING`,
and several `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` keys.

> **About the Supabase keys the integration adds:** the app never uses
> supabase-js and never references those variables, so Next.js doesn't ship them
> to the browser. Every table also has Row Level Security switched on with
> **no policies**, so even the public anon key can't read or write anything
> through Supabase's API. You may delete those extra variables if you prefer.

**Tip:** put the app's functions next to the database. In Vercel go to
**Settings → Functions → Function Region** and pick the matching region
(Frankfurt is `fra1`).

### 6. Set `DATABASE_URL`

The app must connect through Supabase's **transaction pooler** (port
**6543**), which is what serverless functions need.

1. In Vercel, go to **Settings → Environment Variables** and reveal
   `POSTGRES_URL`. Check that it contains `pooler.supabase.com:6543`.
2. Add a new variable **`DATABASE_URL`** with that same value, for all
   environments.

Alternatively, copy it from Supabase: **Supabase dashboard → your project →
Connect → Connection string → Transaction pooler**. Replace `[YOUR-PASSWORD]`
with the database password (you can reset it under **Project Settings →
Database**).

> If `DATABASE_URL` isn't set, the app falls back to `POSTGRES_URL`. Setting it
> explicitly is still recommended.

### 7. Redeploy (this runs the migrations)

**Deployments** → the latest deployment → **⋯** → **Redeploy**.

The build log should show:

```
Applying migrations…
✓ Database is up to date.
```

Every later deploy runs migrations again; already-applied migrations are
skipped.

<details>
<summary>Prefer running migrations by hand?</summary>

From your computer, with `DATABASE_URL` set in `.env.local` (see
[Run it locally](#run-it-locally)):

```bash
npm run db:migrate
```

You can pull the project's variables with `npx vercel link` and
`npx vercel env pull .env.local`. Variables that Vercel marks as *Sensitive*
come back empty, so paste `DATABASE_URL` in by hand if needed.
</details>

### 8. Log in

Open `https://<your-project>.vercel.app`, enter your `APP_PASSWORD`, and
you're in. The default statuses (To do, In progress, Done) and priorities
(Urgent, High, Normal, Low) are created on first use.

**On your phone:** open the site in Safari (iOS) or Chrome (Android) and use
**Share → Add to Home Screen** for a full-screen, app-like experience. The
first time you tap the microphone, allow microphone access.

### Keep the free Supabase project awake

Supabase pauses free projects after about a week without activity. The app
includes a daily Vercel Cron job (`vercel.json`) that calls
`/api/cron/keepalive` at 06:00 UTC and makes one tiny database write. Vercel
sends your `CRON_SECRET` with the call, and the endpoint rejects anything
without it.

- Make sure `CRON_SECRET` is set (step 4), then redeploy.
- You can see the job and its runs under **Settings → Cron Jobs** in Vercel.
  **Run** there triggers it manually.
- If the project gets paused anyway, open the Supabase dashboard and click
  **Restore project**.

### Using Neon instead of Supabase

The code only needs a Postgres connection string, so Neon works too: add
**Neon** from **Storage → Create Database**, then set `DATABASE_URL` to Neon's
**pooled** connection string (its host contains `-pooler`) and redeploy. The
Row Level Security statements are harmless on Neon.

---

## Run it locally

Requirements: **Node.js 20.9+** and a Postgres database.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate
npm run dev                  # http://localhost:3000
```

For `DATABASE_URL`, either:

- **Use a Supabase database.** Paste the transaction-pooler string. A second
  free Supabase project for development keeps test data out of your real plan.
- **Use a local Postgres**, e.g. with Docker:

  ```bash
  docker run --name puretask-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:17
  # DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
  ```

  SSL is turned off automatically for `localhost`.

The voice assistant needs `GROQ_API_KEY`; everything else works without it.
Browsers only allow microphone access on `https://` or `http://localhost`, so to
test voice on a phone, use the deployed site.

Before committing, run everything CI-style:

```bash
npm run check   # lint + typecheck + unit tests
```

---

## Environment variables

All of them are server-only; none are sent to the browser.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase **transaction pooler** connection string (port 6543). Falls back to `POSTGRES_URL`. |
| `APP_PASSWORD` | yes | Login password. |
| `SESSION_SECRET` | yes | ≥ 32 random characters. Signs the session cookie and keys the stored IP hashes. Changing it signs you out everywhere. |
| `GROQ_API_KEY` | for voice | Groq API key from [console.groq.com](https://console.groq.com/keys). |
| `GROQ_CHAT_MODEL` | no | Chat model. Default `openai/gpt-oss-120b`. Best with a model that supports strict structured outputs (the `openai/gpt-oss-*` models do); others fall back to JSON mode. |
| `GROQ_STT_MODEL` | no | Speech-to-text model. Default `whisper-large-v3`, which is more accurate than `whisper-large-v3-turbo` and has the same free-tier limits. |
| `GROQ_STT_LANGUAGE` | no | Language you speak, as an ISO code (`en`, `de`, …). Default `en`. `auto` lets Whisper guess, which often misfires on short phrases. |
| `CRON_SECRET` | recommended | Random string. Authorizes the daily keep-alive job (see below). Without it the job is disabled. |

Groq retires models from time to time. When a model ID stops working, the
server logs say so — see [Troubleshooting](#troubleshooting).

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run vercel-build` | Migrations, then `next build` (Vercel runs this automatically) |
| `npm run db:migrate` | Apply pending migrations from `./drizzle` |
| `npm run db:generate` | Create a new migration after changing `src/lib/db/schema.ts` |
| `npm run db:studio` | Browse the database with Drizzle Studio |
| `npm run lint` · `npm run typecheck` · `npm test` | Quality checks |
| `npm run check` | All three of the above |

---

## Using the app

**Calendar tree.** Years from 2024 to next year + 1 are listed, and **+ Add
year** extends the list. Weeks always run Monday–Sunday, labelled like
`12.10.2026-18.10.2026`. A week is listed under the month where its Monday
falls, and always shows all seven days. Days are labelled like
`MON 12.10.2026`. Today and the current week are highlighted, and collapsed
weeks/days show how many tasks they contain. "Today" is based on the
Europe/Berlin timezone. The app remembers which nodes you had open.

**Today button.** Opens the current year, month, week and day, scrolls to the
week and briefly highlights it.

**Tasks.**
- **Add:** use **+ Add task** under a day. Press Enter to add, and keep typing
  for the next one.
- **Sub-notes:** **⋯ → Add sub-note**, up to three levels below a task. Once
  a task has sub-notes, an **+ Add sub-note** button also appears at the end
  of them. **+ Add task** under a day always adds a top-level task to that day.
- **Rename:** double-click the title (double-tap on touch). Enter saves, Esc
  cancels, clicking away saves.
- **Status and priority:** tap a colored pill to change it. Choosing a
  priority sorts the task among its siblings once: Urgent at the top, Low and
  no priority at the bottom. Nothing stays locked, so you can drag it
  elsewhere afterwards. Priorities set by the voice assistant sort the same
  way.
- **⋯ menu:** add details, move up/down, move to another day, or delete.
  Deleting a task also deletes its sub-notes, and the confirmation says so.
- **Drag:** move a task, together with its sub-notes, anywhere.
  - On a computer, drag the grip that appears on hover. On a phone,
    long-press the task (about half a second), then drag.
  - Drop on the upper or lower part of a task to place it before or after
    it, on the middle to make it a sub-note, or on a day's row to move it to
    that day.
  - Near the top or bottom of the screen the page scrolls. Esc cancels.
  - Drops that would nest too deep, or into the task's own sub-notes, aren't
    offered.
- Changes appear instantly and are rolled back with a message if saving fails.

**Keyboard.**
- Tab into the tree, then use ↑/↓ to move.
- → expands a node or steps into it; ← collapses it or goes to the parent.
- Home/End jump to the first/last node. Enter/Space toggles a calendar node.
- On a task, Enter or F2 renames it and Delete removes it.

**Settings (gear).** Add, rename, recolor (preset palette or a custom color),
reorder and delete statuses and priorities. If you delete one that tasks still
use, you choose what those tasks get instead. Settings also has the theme
(System/Light/Dark) and Sign out. The moon/sun button in the header switches
the theme quickly.

**Voice assistant.**
- Tap the microphone, speak, then tap again. Your words, the reply (also
  spoken aloud) and the changes it made appear in the panel.
- Tap a change to jump to that task. You can also type a request.
- Examples:
  - "Add dentist next Friday, high priority"
  - "What's on this week?"
  - "Move that one to tomorrow"
  - "Mark the report as done"
  - "Delete everything on Sunday" — tasks are deleted right away, except a
    task that has sub-notes: then it asks first. Say "yes" (or tap
    **Delete**) to confirm, "no" (or **Keep**) to cancel.
- The conversation lasts for the browser tab, so follow-ups work.
- **New chat** starts over, and the speaker button mutes the spoken replies.

---

## How it works

```
src/
  proxy.ts                 Auth gate for every page and API route (Next 16's "middleware")
  app/                     Pages (/, /login) and route handlers under /api
  components/              UI: calendar tree, tasks, settings sheet, assistant dock
  client/                  Client stores (zustand), hooks, voice recording/speech
  lib/
    dates.ts               All calendar math (date-fns + @date-fns/tz), unit-tested
    depth.ts               Sub-note depth rule, shared by UI and server
    auth/                  Session tokens, password check, rate-limit policy
    db/                    Drizzle schema (RLS enabled) and postgres-js client
    server/                Task/label services and HTTP helpers
    ai/                    Groq client, task list for the model, JSON plan validation, saving
drizzle/                   SQL migrations
scripts/migrate.ts         Migration runner (works through the transaction pooler)
```

**Database access.** All data goes through server route handlers using Drizzle
and postgres-js with `prepare: false`, which Supabase's transaction pooler
needs. The browser never talks to Supabase. Every table has Row Level Security
enabled with no policies. The app connects as the table owner, which bypasses
RLS, so Supabase's public API can't see any data.

**Authentication.**
- `/api/auth/login` compares SHA-256 digests of the passwords with
  `crypto.timingSafeEqual`, and every failure gets the same `Wrong password`
  message.
- On success it sets an HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax`
  cookie that lasts one year.
- `src/proxy.ts` rejects any request without a valid session: pages redirect
  to `/login`, API calls get 401. Each route handler checks the session again
  as a second layer.

**Login rate limiting** is stored in Postgres, because serverless instances
don't share memory.
- Clients are identified by `x-real-ip` / `x-forwarded-for`. Only a keyed hash
  of the IP is stored.
- 5 failures within 15 minutes lock that IP out. Repeat lockouts back off:
  15 min → 30 min → 1 h → … capped at 24 h. A successful login resets it.
- More than 50 failures across all IPs within an hour pause login for everyone
  for 15 minutes.
- Locked requests get HTTP 429 with `Retry-After`, and the login page shows a
  countdown.
- Rows older than 24 hours are pruned on each login request.
- The policy lives in `src/lib/auth/rate-limit.ts` and is unit-tested.

**Voice assistant.**
- **Recording:** `MediaRecorder` records WebM/Opus on Chrome and Android, and
  MP4/AAC on iOS Safari.
- **Transcription:** the audio goes to `/api/transcribe`, which forwards it to
  Groq Whisper. If that fails, the next attempt uses the browser's built-in
  speech recognition (Web Speech API).
- **One request, one answer:** `/api/assistant` makes a single Groq call. The
  model gets:
  - today's date, weekday, time zone and calendar;
  - your status and priority names;
  - a compact **task list**. It always includes every task, sub-notes too,
    from last week, this week and next week. Up to 150 lines in total, it adds
    top-level tasks from other dates, nearest to today first, without their
    sub-notes. Each task has a 6-character handle.
- **The answer is JSON** (strict structured output): a spoken `reply` plus an
  `operations` table of creates, updates and deletes. New tasks can be
  referenced by sub-notes in the same table through temporary refs.
- **Applying it:** the server validates every operation (dates, handles,
  label names, the sub-note depth limit) and applies them all in **one
  database transaction**, so either everything is saved or nothing is. If
  something can't be done, the spoken reply says exactly what.
- **Lookups:** if you mention a task that isn't in the list, the model asks
  for a lookup, and only then is a second call made.
- **Deleting:** tasks without sub-notes are deleted immediately, any number of
  them. A task that has sub-notes is held back, and the server asks right away,
  with **Delete** / **Keep** buttons. Your "yes" or "no" is handled by the
  server without calling the AI. The AI itself never asks for confirmation.
- The code lives in `src/lib/ai/`: `snapshot.ts` builds the task list,
  `plan.ts` defines the JSON format and validates it, and `store.ts` applies
  it to the database. All three are unit-tested.
- **Spoken replies:** the browser's built-in `speechSynthesis`, with a
  natural English voice picked when one is available. On iOS, speech is
  unlocked on your first tap.

---

## Troubleshooting

**"Can't reach the database" after logging in**
- Check that `DATABASE_URL` is the transaction pooler string (port **6543**)
  with the right password.
- Redeploy so the migrations run, and check the build log.

**`prepared statement … does not exist` / `already exists`**
- The URL probably points to the session pooler or the direct connection. Use
  the transaction pooler (port 6543).

**Assistant says "The AI model needs updating"**
- Groq retired the model. The Vercel function logs show a message like:
  `[groq] Model "…" is not available on Groq … Update the GROQ_CHAT_MODEL environment variable…`
- Pick a current model ID at
  [console.groq.com/docs/models](https://console.groq.com/docs/models) and
  update `GROQ_CHAT_MODEL` (or `GROQ_STT_MODEL`), then redeploy.

**Assistant says it's busy**
- The Groq free tier allows about 8,000 tokens per minute for the chat model
  (see **console.groq.com → Settings → Limits**). A request uses one model call
  of roughly 2–4K tokens, so a few requests per minute fit.
- The server already waits and retries automatically, within a 50-second time
  budget per request.
  Nothing is half-saved: changes are applied all at once, or not at all.
- The Vercel function logs show Groq's exact message (`[groq] Rate limited …`),
  including which limit was hit.

**Microphone blocked**
- iOS: **Settings → Apps → Safari → Microphone**, or the **aA** menu →
  **Website Settings**.
- Chrome: the site-settings icon in the address bar.
- You can always type requests in the assistant panel instead.

**No spoken reply**
- Check the device volume and that the speaker button in the assistant panel
  isn't muted.

**Site says "Can't reach the database" after a quiet week**
- The free Supabase project was paused. Restore it in the Supabase dashboard,
  then check that `CRON_SECRET` is set so the keep-alive job runs.

**Locked out of the login page**
- Wait for the countdown. If you need to clear it right away, run this in the
  Supabase **SQL Editor**:
  ```sql
  delete from login_lockouts; delete from login_attempts;
  ```

**Changed `APP_PASSWORD` but old sessions still work**
- Sessions are signed with `SESSION_SECRET`, not the password. Change
  `SESSION_SECRET` to sign out every device.

---

## License

[MIT](LICENSE): you may use, change and share this code, including
commercially, as long as the copyright notice is kept.
