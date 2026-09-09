# Contributing

ScrapeShield is a small reliability and observability project around a Bright Data Scraper Studio collector. Contributions should preserve the product boundary: ScrapeShield validates and observes structured output; Bright Data performs collection and external scraper repair.

## Setup

Requirements:

- Node.js 18 or newer.
- npm.
- Bright Data CLI authentication only when testing trusted live execution.

```bash
npm ci
```

## Tests and checks

Run the complete local checks before opening a change:

```bash
npm test
npm run test:browser
node --check server.js
node --check public/app.js
git diff --check
```

Tests should use temporary or in-memory fixtures for persistence behavior. Do not write test data into `data/healing-history.json`.

## Evidence and product boundaries

Changes should keep evidence boundaries explicit:

- Do not infer website or root causes without evidence.
- Do not claim ScrapeShield performs Bright Data Self-Healing.
- Do not allow demo fixtures to appear as live history.
- Do not make Live selection execute the collector implicitly.
- Do not add scraping, crawling, browser automation, proxy, anti-bot, selector-engine, or Scrapling behavior.

Derived incidents and field reliability should remain deterministic and should not be persisted separately unless the data model is intentionally reviewed.

## Pull requests

Keep changes focused and explain:

- The user or engineering problem.
- The files changed.
- Evidence and tests added.
- Backward-compatibility considerations.
- Any change to live execution or history behavior.

Do not commit generated files, credentials, local `.env` files, or production history mutations. Use a descriptive commit message and do not combine unrelated UI, backend, and infrastructure work in one change.
