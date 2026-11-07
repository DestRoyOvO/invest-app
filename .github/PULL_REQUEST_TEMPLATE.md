## What and why

<!-- What changes for the person using the app, and why. Link the issue if there is one. -->

## How it was checked

- [ ] `npm run check` (lint, typecheck, unit tests) passes
- [ ] `npm run build` passes
- [ ] New pure functions have tests beside them (`*.test.ts`)
- [ ] UI changes: checked in both themes, both languages and at phone width; screenshots below

## Conventions

- [ ] UI text goes through `lib/i18n`, in English and Chinese, plain and short, with no investment advice
- [ ] Red and green (`--up` / `--down`) are used only for prices, returns and P&L
- [ ] New environment variables are in `lib/server/env.ts`, `.env.example` and `docs/deployment.md`
- [ ] Model or evaluation changes: `npm run evaluate` was re-run and the results are committed

## Screenshots

<!-- Before and after, if the change is visible. -->
