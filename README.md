# UK Property Search Agent

A Vercel-ready property search agent built with Next.js, Vercel Functions, Vercel Cron Jobs, and cloud Redis.

The app lets each user log in, configure a property search, run it immediately with OpenAI web search, store their latest top-10 results, and send updates to their own Telegram chat.

## Architecture

- `app/page.tsx` - the web dashboard.
- `app/api/auth/login/route.ts` - creates accounts and logs users in with Redis-backed sessions.
- `app/api/property-agent/credentials/route.ts` - saves user OpenAI and Telegram credentials independently from starting a search.
- `app/api/property-agent/set-search/route.ts` - validates and saves a user-scoped search, runs it immediately, and sends the first notification.
- `app/api/property-agent/status/route.ts` - reads the signed-in user's persisted agent state and latest results.
- `app/api/property-agent/cancel/route.ts` - marks the signed-in user's agent as stopped.
- `app/api/cron/property-agent/route.ts` - Vercel Cron entry point that checks all running user agents and runs the ones that are due.
- `lib/` - Auth/session helpers, Redis client adapters, OpenAI search runner, scheduling, notifications, and shared types.

## Why this rewrite works on Vercel

The previous FastAPI service used an in-memory background loop. That does not map well to serverless hosting, where function instances are short lived.

This version persists the agent config, run state, latest results, and next scheduled run in Redis. Vercel Cron invokes a regular route handler, and the route decides whether a run is due.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Required environment variables

Set these in `.env.local` for local development and in your Vercel project settings for production.

```bash
DEFAULT_OPENAI_MODEL=gpt-5

REDIS_URL=

# Or use Upstash-compatible Redis REST credentials:
KV_REST_API_URL=
KV_REST_API_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

For Redis Cloud, open your database's **Redis SDK clients** connection option, choose Node.js, and use the connection string as `REDIS_URL`. It usually looks like `redis://default:<password>@<host>:<port>` or `rediss://default:<password>@<host>:<port>` when TLS is enabled.

OpenAI API credentials are entered in the dashboard for each user. The app stores each user's secret key with their agent config and does not use a shared project-level OpenAI key.

Telegram credentials are entered in the dashboard for each user. These environment variables are optional fallbacks for older saved configs:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_API_BASE_URL=https://api.telegram.org
```

## Vercel deployment

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. Confirm the project uses the Next.js framework preset and the repository root as the Root Directory.
4. Leave Output Directory unset/auto-detected. The committed `vercel.json` also sets `outputDirectory` to `null` so Vercel uses the Next.js output instead of looking for `public/`.
5. Add `REDIS_URL` from Redis Cloud, or add a Redis integration from Vercel Marketplace.
6. Add the environment variables above.
7. Set `CRON_SECRET` to a random value with at least 16 characters.
8. Deploy.
9. In GitHub, open the repository's **Settings > Secrets and variables > Actions** page and add these repository secrets:
   - `PROPERTY_AGENT_CRON_URL`: `https://your-app.vercel.app/api/cron/property-agent`
   - `CRON_SECRET`: the same value you set in Vercel.
10. Keep GitHub Actions enabled. The committed scheduler workflow will wake the app regularly on Vercel Hobby.

The `vercel.json` cron is intentionally kept to once per day so Vercel Hobby deployments pass:

```json
{
  "crons": [
    {
      "path": "/api/cron/property-agent",
      "schedule": "0 8 * * *"
    }
  ]
}
```

Frequent checks come from `.github/workflows/property-agent-scheduler.yml`, which calls `/api/cron/property-agent` every 5 minutes. The cron route does not run every user's search every time it is called. It checks persisted `next_run_at` values in Redis and only runs agents that are due, so Hourly, Daily, Weekly, and Monthly settings are controlled by the app. GitHub scheduled workflows can occasionally be delayed, so runs happen on the next scheduler wake after an agent is due.

## API

- `GET /api/health`
- `POST /api/auth/login` with `{ "mode": "login" | "create", "username": "...", "password": "..." }`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/property-agent/credentials`
- `POST /api/property-agent/set-search`
- `GET /api/property-agent/status`
- `POST /api/property-agent/cancel`
- `GET /api/cron/property-agent`

The property agent endpoints require `Authorization: Bearer <session_token>`.

The legacy Redis key/value routes are still available for simple compatibility:

- `POST /api/kv/{key}` with `{ "value": "..." }`
- `GET /api/kv/{key}`
- `POST /api/kv/bulk` with `{ "values": { "key": "value" } }`
