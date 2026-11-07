# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**, or go to
<https://github.com/DestRoyOvO/invest-app/security/advisories/new>. Do not open a public issue for a security problem.

Helpful details:

- what an attacker can do, and what they need first (a session, network position, a configuration);
- steps or a proof of concept against a local `npm run dev` or Docker instance;
- the version (the `version` and `commit` fields of `/api/health`, or the git commit).

This is a personal project maintained in spare time. You can expect an acknowledgement within a week, and a fix or a
plan soon after for confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## Supported versions

Only the latest version on the `main` branch receives security fixes.

## Scope

In scope: the application code in this repository, its API routes, the session and access control, the AI request
pipeline, the article fetcher and the deployment files (`Dockerfile`, `docker-compose.yml`).

Out of scope: problems in Yahoo Finance or DeepSeek themselves, attacks that need control of the host or of the
deployment's environment variables, and missing rate limiting on a deployment whose reverse proxy is misconfigured
(see `TRUST_PROXY` in `docs/deployment.md`).

## Running it safely

- Use a long `ACCESS_PASSWORD` (12 or more characters) and a random `SESSION_SECRET` of 32 or more characters.
- On a public address, serve the app over HTTPS and turn on `SITE_ACCESS=private`.
- Keep the DeepSeek prepaid balance small. The daily AI limit is enforced per server process, and the balance is the
  hard cap on spending.
- Never commit `.env.local` or paste keys into issues or logs you share.
