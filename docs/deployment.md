# Deploying InvestSeek

InvestSeek is built for one investor. This guide covers running it on your own machine with Docker (recommended), on
Vercel, the private site mode, every setting, and the health checks and logs you can monitor.

- [Which host to choose](#which-host-to-choose)
- [Docker](#docker)
- [HTTPS with Caddy](#https-with-caddy)
- [Vercel](#vercel)
- [Private site mode](#private-site-mode)
- [Settings](#settings)
- [Startup checks](#startup-checks)
- [Health endpoints](#health-endpoints)
- [Logs](#logs)
- [Security headers](#security-headers)
- [Yahoo canary](#yahoo-canary)

## Which host to choose

**Docker on an always-on machine** (a home server, a NAS or a small VPS) is the best fit for one person. A single
long-lived Node.js process keeps everything that makes the app fast and safe in memory:

- the market data caches (quotes, bars, summaries, news), so pages load from warm caches;
- one Yahoo session cookie and crumb, fetched once instead of on every cold start;
- the rate limits and the daily AI budget, which are exact because there is only one copy of them.

**Vercel** works too, with caveats: every serverless instance has its own caches, limits and AI budget (see
[Vercel](#vercel)).

The app keeps no server-side data. Watchlist, positions, notes and preferences live in the browser, so the server or
container can be rebuilt at any time; the only file to back up is `.env.local`.

## Docker

Requirements: Docker Engine with Compose v2.24 or newer. The image is built from source on your machine. The build
downloads the IBM Plex fonts from Google Fonts (through `next/font`), so it needs network access; running the image
does not.

```bash
git clone https://github.com/DestRoyOvO/invest-app.git
cd invest-app
cp .env.example .env.local      # fill in the settings you need, see below
docker compose up -d --build    # http://127.0.0.1:3000
```

What `docker-compose.yml` sets up:

- The `app` service builds the multi-stage `Dockerfile` (Node 22 on Alpine). The final image contains only Next.js's
  standalone server, its static assets and `public/`, runs as the unprivileged `node` user with `NODE_ENV=production`,
  and listens on port 3000.
- Settings come from `.env.local`, the same file `npm run dev` uses. No setting is baked into the image: `.dockerignore`
  keeps every `.env*` file out of the build.
- The port is published on `127.0.0.1` only. To reach the app from other devices, use the [Caddy profile](#https-with-caddy)
  or change the mapping in `docker-compose.yml` (and then set `TRUST_PROXY=0`, see below).
- The image has a `HEALTHCHECK` that calls `/api/health` with Node every 30 seconds. It checks liveness only, so a Yahoo
  outage never marks the container unhealthy or gets it restarted.
- `restart: unless-stopped` brings the app back after a crash or a reboot.

Useful commands:

```bash
docker compose logs -f app                             # follow the JSON logs
docker compose ps                                      # shows "healthy" once the health check passes
git pull && docker compose up -d --build               # update to the latest version
GIT_SHA=$(git rev-parse HEAD) docker compose build     # show the commit in /api/health
```

Without Compose:

```bash
docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t investseek .
docker run -d --name investseek --restart unless-stopped --env-file .env.local -p 127.0.0.1:3000:3000 investseek
```

### Without Docker

`npm ci && npm run build && npm start` runs the same server on port 3000; put it behind a TLS reverse proxy and set
`TRUST_PROXY=1`. The build also writes the standalone server that the image uses. To run that one directly, copy
`public/` to `.next/standalone/public` and `.next/static` to `.next/standalone/.next/static`, then run
`node .next/standalone/server.js` with `PORT` and `HOSTNAME` set.

### Plain HTTP on a local network

In production the session cookie is `Secure` (and named `__Host-is_session`), so browsers only keep it over HTTPS or on
`localhost`. Everything that needs a sign-in (unlocking AI, and the whole site in private mode) therefore needs HTTPS
when you open the app from another device. Options: the [Caddy profile](#https-with-caddy) with a real domain, a tunnel
such as Tailscale with HTTPS certificates, or an SSH port forward so the browser talks to `localhost`.

## HTTPS with Caddy

The optional `caddy` service (Compose profile `https`) puts the app behind [Caddy](https://caddyserver.com), which
obtains and renews a certificate automatically and redirects http to https.

1. Point a DNS record for your domain at the machine, and make ports 80 and 443 reachable from the internet (Caddy
   needs them for the certificate).
2. In `.env.local`, set `SITE_URL=https://your.domain`. For a deployment on a public address, also turn on
   [private mode](#private-site-mode): `SITE_ACCESS=private` with `ACCESS_PASSWORD` and `SESSION_SECRET`.
3. Start both services:

   ```bash
   SITE_DOMAIN=your.domain docker compose --profile https up -d --build
   ```

   You can also put `SITE_DOMAIN=your.domain` in a `.env` file next to `docker-compose.yml`, which Compose reads.

Compose sets `TRUST_PROXY=1` for the app, so rate limits use the visitor's address that Caddy appends to
`X-Forwarded-For`. That is safe because the app's own port is published on `127.0.0.1` only: nobody else can reach the
app directly and forge the header. If you publish the app's port on your network without a proxy, set `TRUST_PROXY=0`
in the shell or in that `.env` file.

Caddy keeps its certificates in the `caddy-data` volume. AI notes stream through Caddy without buffering.

## Vercel

Import the repository and set at least `DEEPSEEK_API_KEY`, `ACCESS_PASSWORD` and `SESSION_SECRET` (and
`SITE_ACCESS=private` if the deployment should not be public). Vercel ignores the standalone output and sets the client
address itself, so `TRUST_PROXY` is not needed. `/api/health` reports `VERCEL_GIT_COMMIT_SHA` as the commit.

Things that behave differently from a single process:

- **Limits and the AI budget are per instance.** Each serverless instance keeps its own rate limits and daily AI budget
  in memory, and a new or recycled instance starts from zero. `AI_DAILY_LIMIT=200` is therefore not a hard daily cap
  on Vercel. Keep your DeepSeek prepaid balance small: it is the real cap on spending.
- **Cold starts.** A new instance has empty caches and repeats Yahoo's cookie and crumb handshake before its first
  quote, so the first page after a quiet period is slower.
- **Long AI answers need Fluid compute.** The AI routes allow up to 130 seconds (`maxDuration`). That needs Fluid
  compute, the default for new projects; without it the Hobby plan stops functions after 60 seconds and long notes are
  cut off.
- **Cloud IP ranges.** Yahoo throttles some cloud networks. Check a preview deployment before relying on it.

Private mode works on Vercel too: `proxy.ts` runs in front of every page and API route.

## Private site mode

By default (`SITE_ACCESS=public`) anyone who can reach the server can use the market pages and data; only the AI
features need the password. With `SITE_ACCESS=private` the whole site needs it. This is recommended for a personal
deployment on a public address: it keeps your watchlist page and the market API (which calls Yahoo for every uncached
request) out of strangers' reach, and keeps search engines away.

It needs `ACCESS_PASSWORD` and a `SESSION_SECRET` of 32 or more characters; a production server refuses to start
without them. In private mode:

- Every page and API route checks the signed session cookie first, in `proxy.ts`. A page request without a valid
  session is redirected to `/unlock`, which asks for the access password and then returns to the page that was asked
  for. An API request gets `401` with `{"error":{"code":"unauthorized",...}}`.
- These stay open: `/api/health` (for monitors and the Docker health check), `/api/auth/*` (sign-in), `/unlock`, the
  framework's static assets, icons and the web manifest.
- Every response carries `X-Robots-Tag: noindex, nofollow`.
- Successful API responses use `Cache-Control: private, max-age=0` instead of the shared CDN cache, so no shared cache
  can hand your data to an anonymous visitor.
- A session lasts 30 days. Changing `ACCESS_PASSWORD` or `SESSION_SECRET` signs every browser out.

The same session also unlocks the AI features, so one sign-in covers both. If a session expires while a tab stays open,
data requests fail until the page is reloaded and sends you to `/unlock`.

Sign-in attempts are limited in every mode: 5 per client and 30 for the whole server in 15 minutes, right or wrong. In
private mode these limits also decide when a browser without a session can open the site:

- Browsers that are already signed in are never affected.
- Without a trusted proxy, every visitor shares one per-client limit, so five wrong passwords from anyone delay a new
  sign-in for up to 15 minutes. Behind Caddy or nginx, set `TRUST_PROXY=1` (Compose does) so that each client has its
  own limit; then only the server-wide limit, 30 attempts from several addresses, can delay you.
- Wrong passwords are logged as `auth.sign_in_failed` and rejected attempts as `auth.rate_limited`, with the client
  address (or `direct` without a trusted proxy) and never the password, so an attack shows in `docker compose logs`.

## Settings

All settings are environment variables, read and validated in one place (`lib/server/env.ts`). Put them in
`.env.local` for `npm run dev`, `npm start` and Docker Compose, or in your host's settings. Blank values mean "use the
default". An invalid value falls back to the default and is reported at startup (see [Startup checks](#startup-checks)).

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | none | DeepSeek API key. Without it the AI features report "not configured"; everything else works. |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Model id. Must look like a model id (letters, digits, `.`, `_`, `:`, `-`). |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL. Must be https; plain http is accepted only for `localhost`, `127.x.x.x` and `[::1]`, so tests can use a local mock server. No credentials, query or fragment. |
| `AI_DAILY_LIMIT` | `200` | AI requests per UTC day for one server process. Whole number from 1 to 9999999. |
| `ACCESS_PASSWORD` | none | Unlocks the AI features, and the whole site in private mode. Without it AI is open in development (on localhost only) and disabled in production. Use 12 to 256 characters. |
| `SESSION_SECRET` | none | Signs the session cookie. Required with `ACCESS_PASSWORD`; 32 or more random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `SITE_ACCESS` | `public` | `public` or `private`, see [Private site mode](#private-site-mode). An unreadable value counts as `private`. |
| `TRUST_PROXY` | off | `1` behind a reverse proxy you control that appends the client address to `X-Forwarded-For` (nginx, Caddy). Rate limits then use the right-most address. Leave it off otherwise: forwarded headers are ignored and all clients share one rate-limit bucket. Not needed on Vercel. Accepts 1/0, true/false, yes/no, on/off. |
| `SITE_URL` | none | Public address of the deployment, e.g. `https://invest.example.com`. Only the origin is kept. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `MARKET_DATA_SOURCE` | `yahoo` | Where market data comes from. `fixtures` and `record` are reserved for the replay mode of the end-to-end tests and are not available yet; the server reports them at startup and uses Yahoo. |

Set by the platform or the build, not in `.env.local`:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` under `npm start`, in the Docker image and on Vercel. |
| `PORT`, `HOSTNAME` | Where the standalone server listens. The image sets `3000` and `0.0.0.0`. |
| `GIT_SHA` | Docker build argument, shown as `commit` by `/api/health`. |
| `VERCEL`, `VERCEL_GIT_COMMIT_SHA` | Set by Vercel: client address headers are trusted, and the commit is shown by `/api/health`. |

Every variable in `lib/server/env.ts` must be listed in `.env.example`; a unit test checks it.

## Startup checks

When a server process starts (`npm start`, the Docker image, a Vercel instance, `npm run dev`), `instrumentation.ts`
validates the settings and writes one line that describes the configuration without any secret:

```json
{"ts":"2026-11-07T20:27:05.755Z","level":"info","event":"startup","version":"0.2.0","nodeEnv":"production","commit":null,"authMode":"password","signIn":"ready","aiConfigured":true,"model":"deepseek-chat","aiEndpoint":"default","aiDailyLimit":200,"proxyTrust":"x-forwarded-for","siteAccess":"private","siteUrl":"https://invest.example.com","dataSource":"yahoo","logLevel":"info"}
```

Each problem gets its own `config.issue` line. A production server **refuses to start** (it logs why and exits with
code 1) when:

- `ACCESS_PASSWORD` is set without a `SESSION_SECRET` of 32 or more characters, or is longer than the 256 characters
  the sign-in form accepts, because nobody could sign in;
- `SITE_ACCESS=private` lacks `ACCESS_PASSWORD` or a valid `SESSION_SECRET`, because nobody could open the site;
- `SITE_ACCESS` has a value other than `public` or `private`.

Everything else is a warning and the server starts: an `ACCESS_PASSWORD` shorter than 12 characters, a `SESSION_SECRET`
without a password, `DEEPSEEK_API_KEY` without `ACCESS_PASSWORD` in production (AI stays off), and invalid values that
fall back to their defaults. In development every problem is only logged, so you can fix it while the server runs.
`next build` skips the checks, so CI can build without production secrets.

After upgrading to this version, a production browser signs in once more: the session cookie is now named
`__Host-is_session`, which browsers only accept with `Secure`, `Path=/` and no `Domain`, so a page on another
subdomain cannot plant or overwrite it.

## Health endpoints

`GET /api/health` is the liveness check. It answers `200` while the server runs and never calls Yahoo:

```json
{"ok":true,"time":"2026-11-07T20:23:37.614Z","aiConfigured":false,"version":"0.2.0","commit":"0123456789abcdef0123456789abcdef01234567","uptimeSeconds":7,"dataSource":"yahoo"}
```

`GET /api/health?ready=1` is the readiness check. It adds statistics about the app's own recent Yahoo calls:

```json
{"ok":true,"...":"...","upstream":{"pending":0,"lastSuccessAt":"2026-11-07T20:27:06.929Z","lastFailureAt":null,"consecutiveFailures":0,"failingSince":null,"ready":true}}
```

It answers `503` with `"ok":false` after sustained upstream failure: 5 or more failed Yahoo calls in a row, failing for
at least 2 minutes, the latest within the last 15 minutes. Yahoo's own answers about unknown symbols do not count as
failures. Readiness recovers with the next successful call. It reflects calls the app makes for its visitors, so a
quiet server with no recent calls reports ready.

Use liveness for container health checks and readiness for uptime monitors (for example Uptime Kuma or a hosted
monitor). Both stay open in private mode.

## Logs

The server writes one JSON object per line: `ts`, `level`, `event`, then the event's fields. `debug` and `info` go to
stdout, `warn` and `error` to stderr. `LOG_LEVEL` sets the threshold. Passwords, secrets, cookies, API keys, prompts and
chat messages are never written: the logger redacts such fields by name and masks anything that looks like an API key.

| Event | Level | Meaning |
|---|---|---|
| `startup` | info | Configuration summary at startup. |
| `config.issue` | warn or error | A setting problem found at startup. |
| `yahoo.stale_served` | warn | A quote refresh failed and quotes up to an hour old were served, marked stale. |
| `http.upstream_error` | error | A market data route failed and answered 502. |
| `market.news_unavailable`, `stock.summary_unavailable`, `stock.news_unavailable`, `news.searches_failed` | warn | Part of a page could not be loaded; the rest was served. |
| `article.fetch_failed` | warn | A news article could not be read for an AI analysis. |
| `ai.usage` | info | Tokens used by one AI answer (prompt, cached prompt, completion) and its duration. |
| `ai.request_failed` | error | DeepSeek rejected a request. `status` 401 means a bad key, 402 an empty balance. |
| `ai.deadline_exceeded`, `ai.stream_failed`, `ai.incomplete`, `ai.start_failed` | error | An AI answer could not be completed. |
| `auth.sign_in_unavailable` | error | A sign-in was attempted while `SESSION_SECRET` is missing or too short. |
| `auth.sign_in_failed` | warn | A wrong password. `client` is the address the rate limits use (`direct` without a trusted proxy). |
| `auth.rate_limited` | warn | A sign-in over the per-client (`scope: "client"`) or server-wide (`scope: "server"`) limit. At most one line a minute per scope; `suppressed` counts the attempts left out since the previous line. |

With Docker, `docker compose logs app | grep '"event":"ai.usage"'` or `jq` filters the lines.

## Security headers

- **Content-Security-Policy.** In production `proxy.ts` gives every page a policy with a fresh nonce
  (`script-src 'self' 'nonce-...' 'strict-dynamic'`). Next.js puts the nonce on every script it renders, so no inline
  script needs to be allowed. Styles keep `'unsafe-inline'` for style attributes. API responses get
  `default-src 'none'; frame-ancestors 'none'`. The dev server sends no policy, because fast refresh needs `eval`.
- **Strict-Transport-Security** in production, **Cross-Origin-Opener-Policy: same-origin**, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy` and a `Permissions-Policy` that turns off camera,
  microphone, geolocation and payment.
- The session cookie is `HttpOnly`, `SameSite=Lax` and, in production, `Secure` with the `__Host-` prefix.

## Yahoo canary

Market data comes from Yahoo Finance through the unofficial `yahoo-finance2` library, which breaks now and then when
Yahoo changes its API. Pull-request CI never calls Yahoo. Instead, `.github/workflows/canary.yml` runs
`scripts/smoke-yahoo.ts` on weekdays during the US session: it calls the app's real getters for AAPL, ^GSPC, SPY and
BTC-USD and checks a finite price, at least 200 daily bars over a year, a market cap, a company profile and search
results. After a failure it retries once, then opens (or comments on) a single issue titled "Yahoo data contract
broken". Run it yourself with:

```bash
npx tsx --conditions=react-server scripts/smoke-yahoo.ts
```

Dependabot opens a separate weekly pull request for `yahoo-finance2` updates, so library fixes arrive quickly.
