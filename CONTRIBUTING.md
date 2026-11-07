# Contributing to InvestSeek

Thanks for helping. InvestSeek is a terminal-style market workstation for one individual investor, built with Next.js
16 (App Router), React 19, TypeScript in strict mode, Tailwind CSS v4, SWR, zod and Vitest. Market data comes from
Yahoo Finance through `yahoo-finance2`; AI notes come from DeepSeek.

## Setup

Requirements: Node.js 22 (see `.nvmrc`; 20.9 or newer works) and npm.

```bash
git clone https://github.com/DestRoyOvO/invest-app.git
cd invest-app
npm ci
cp .env.example .env.local   # optional: DEEPSEEK_API_KEY for the AI features
npm run dev                  # http://127.0.0.1:3000
```

Everything except the AI features works without any setting. `docs/deployment.md` describes every setting, Docker and
the private site mode.

## Checks

```bash
npm run check   # lint, typecheck and unit tests, the same as CI
npm run build   # production build (also writes the standalone server used by the Docker image)
```

CI runs both on every pull request, plus `npm audit` for production dependencies. When the `Dockerfile`, the lockfile or
`next.config.ts` change, a second workflow builds the image and waits for its health check.

Tests use Vitest and live next to the code as `*.test.ts`. Every new pure function gets tests. Server modules import
`server-only`, so their tests start with `vi.mock("server-only", () => ({}))`. Tests never call Yahoo or DeepSeek: spy on
the shared `yf` client or mock the OpenAI SDK, as the existing tests do. The live Yahoo contract is covered by a
separate canary that you can run by hand:

```bash
npx tsx --conditions=react-server scripts/smoke-yahoo.ts
```

## Re-running the evaluation and the research

The signal panel publishes its own track record, so the committed results must match the code.

- Change the signal model or its inputs: re-run `npm run evaluate`. It downloads about three years of daily bars for the
  78 stocks of the heatmap universe (one Yahoo request per stock) and rewrites `docs/evaluation.md` and
  `lib/signal-evaluation.json`. Commit both with the change.
- Change the factor research (`scripts/research-factors.ts`, see `docs/roadmap-v0.3.md`): run it with `npx tsx` and
  commit `lib/factor-research.json` and `docs/factor-research.md`.

Results are research, not trading advice, and the docs say so.

## Conventions

**Types.** `types/api.ts` is the contract between client and server. Numbers stay raw (formatting happens in the
browser), missing values are `null`, fields named `*Percent` are in percent units, and ratios are decimals (0.25 is
25%).

**Text and languages.** Every UI string goes through `lib/i18n`, in English and Chinese. `zh` is typed against `en`, so
a missing key fails the typecheck. Feature strings live in their own namespace (`lib/i18n/<feature>.ts`, declared with
`defineMessages`) mounted in `lib/i18n/messages.ts`. Copy is plain and short, describes rather than prescribes, uses no
em dashes, and never gives investment advice.

**Colors.** Red and green (`--up` and `--down`) mean price direction only: prices, returns and P&L. They follow the
user's convention (green up, or red up in the Chinese convention). Never use them for model readings, factor
percentiles or risk; use the neutral and accent tokens there.

**Server code.**

- Server modules start with `import "server-only"`.
- Environment variables are read only through `lib/server/env.ts`. A new setting goes into its schema, `.env.example`
  and `docs/deployment.md`; a test checks that the schema and `.env.example` agree.
- Logs go through `log(level, event, fields)` from `lib/server/log.ts`: one JSON line, a dotted event name and
  identifiers or counts as fields. Never log prompts, passwords, cookies or keys.
- Every Yahoo call goes through `upstream(() => yf.method(args, ..., callOptions()))` inside `cached()`, so it shares the
  timeout, the pending-call cap, the readiness statistics and the cache.
- Public API routes call `limitPublicRequest` first, and `chargePublicRequest` for every uncached upstream call beyond
  the first (see `lib/server/charging.ts` and `/api/sparklines`).

**Browser storage.** Local data uses `createLocalStore` from `lib/local-store.ts` with keys named
`investseek:<name>:v1`.

**Commits and pull requests.** Use conventional commit messages (`feat(stock): ...`, `fix(server): ...`). The pull
request template lists what to check before asking for review.

## Reporting problems

Bugs, wrong data and ideas go through the issue forms. Security problems go through private vulnerability reporting,
as described in [SECURITY.md](SECURITY.md).
