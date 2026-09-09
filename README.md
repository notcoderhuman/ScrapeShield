# ScrapeShield

> Reliability and observability for structured data collectors.

ScrapeShield monitors and verifies structured product data collected by a Bright Data Scraper Studio collector. It validates each result, identifies field-level failures, detects structured-output drift, records live run history, derives incidents and recurrence, verifies recovery, and ranks field reliability. Bright Data performs the collection and its external scraper self-healing; ScrapeShield observes and verifies the resulting data.

## What ScrapeShield does

ScrapeShield provides a small reliability layer around an existing collector:

- Classifies runs as `HEALTHY`, `DEGRADED`, or `FAILED`.
- Validates required fields and records field-level diagnostics.
- Detects structured-output drift such as field removal, type changes, shape changes, and usability changes.
- Persists append-only history for explicit live collector runs.
- Derives evidence-based incidents, recovery, and recurrence from run history.
- Verifies recovery only when affected fields are later observed usable.
- Calculates field reliability from explicit live field observations.
- Provides read-only fixtures for healthy, degraded, and failed states.
- Keeps demo fixture state separate from persisted live telemetry.

## What ScrapeShield does not do

ScrapeShield is not a scraper, crawler, browser automation tool, proxy system, anti-bot system, selector engine, or Scrapling integration. It does not infer unsupported root causes such as selector changes, website redesigns, anti-bot behavior, or API changes. It does not perform Bright Data Self-Healing. Bright Data owns collection and external collector repair.

## Architecture

```text
Bright Data collector
  → structured product output
  → ScrapeShield validation
  → field diagnostics
  → structured-output drift detection
  → append-only live run history
  → derived incidents and recurrence
  → recovery verification
  → field reliability ranking
  → observability dashboard
```

![ScrapeShield Architecture](docs/scrapeshield-architecture.png)

The implementation is deliberately small: an Express server (`server.js`), a static HTML/CSS/JavaScript dashboard (`public/`), and JSON-backed local data (`data/`). There is no frontend build step or frontend framework.

## Core reliability model

The monitored product contract currently contains five required fields:

| Field | Validation rule |
| --- | --- |
| `product_name` | Non-empty string |
| `price` | Usable scalar or object with a usable `value` |
| `description` | Non-empty string |
| `rating` | Number or non-empty string |
| `primary_image_url` | Non-empty string |

A run is `HEALTHY` when every required field is usable. A run is `DEGRADED` when the collector returns a product but one or more required fields are unusable. A run is `FAILED` when the collector execution does not produce a usable product result.

Field observations distinguish evidence such as `healthy`, `missing`, `null`, `empty`, `invalid`, and `unexpected-type`. A collector failure with no field observations does not become evidence that every field failed.

## Incidents and recovery

Incidents are derived from live run evidence; they are not stored as a separate history record.

```text
OPEN
  → affected field evidence persists
  → RECOVERED when affected fields are observed usable
```

A later occurrence after recovery becomes a separate `RECURRING` incident. Multi-field incidents retain all affected fields. Failed runs without field observations do not create field-specific incidents.

Recovery is evidence-based. A healthy overall status does not prove that a particular field recovered unless that field is explicitly observed usable in the later run. External Bright Data repair is shown only as workflow context and is never claimed as completed by ScrapeShield.

## Field reliability

Field reliability is derived from explicit live field observations:

```text
usable explicit field observations
---------------------------------- × 100
all explicit field observations
```

Failed runs without field observations, absent field entries, legacy recovery events, and demo fixtures do not contribute. Reliability is suppressed until a field has at least three observations. Sparse fields display `Insufficient live evidence` while retaining their observed and degraded counts. Results are deterministically ranked by sufficient evidence, lowest reliability, highest degraded count, and field name.

## Demo modes

The default route is a safe landing state:

```text
/                       → healthy demo landing; no Bright Data invocation
```

The read-only fixtures are:

| Mode | URL | Behavior |
| --- | --- | --- |
| Healthy | `/?demo=healthy` | Fully valid fixture product |
| Degraded | `/?demo=degraded` | Fixture product with an unusable price |
| Failed | `/?demo=failed` | Simulated collector failure |

Demo modes never invoke the collector, never create live run history, never create recovery history, and never use persisted live telemetry as fixture evidence. Demo field reliability remains insufficient rather than presenting fabricated historical percentages.

## Live mode

Selecting `LIVE` is non-executing. The operator must click **Run live collector**. That explicit action invokes the Bright Data-backed `/api/dashboard` route, validates the returned product, and appends the resulting run to `data/healing-history.json`.

Live history is append-only. Live mode is intended for trusted/local operation; see [Security and deployment](#security-and-deployment).

## Dashboard

The dashboard exposes current health, fields at risk, field diagnostics, structured-output drift, incidents, field reliability, run history, trend, field history, recovery history, and the incident timeline. The repository currently includes the architecture diagram above but no dedicated dashboard screenshot asset. A polished screenshot is a remaining presentation improvement if the project is published for portfolio review.

## Requirements

- Node.js 18 or newer.
- npm.
- Bright Data CLI (`bdata`) installed and authenticated for live mode only.

Demo mode requires only Node.js and the repository files.

## Installation

```bash
git clone <repository-url>
cd ScrapeShield
npm ci
```

Use the repository URL for the copy you are reviewing; this README intentionally does not invent one.

## Bright Data configuration

For live mode, install and authenticate the Bright Data CLI so `bdata` is available on `PATH`. ScrapeShield invokes the configured collector with the configured product URL. The collector ID can be overridden through the environment; credentials remain in the Bright Data CLI's local credential store and are not committed to this repository.

Current configuration defaults are defined in `server.js`:

| Setting | Environment variable | Default |
| --- | --- | --- |
| HTTP port | `PORT` | `3000` |
| Bright Data collector | `BRIGHT_DATA_COLLECTOR_ID` | Project collector ID in `server.js` |
| Product URL | Not configurable through environment | Project product URL in `server.js` |
| History file | Not configurable through environment | `data/healing-history.json` |

Example:

```bash
PORT=4000 BRIGHT_DATA_COLLECTOR_ID=c_yourcollector npm start
```

On Windows PowerShell:

```powershell
$env:PORT = "4000"
$env:BRIGHT_DATA_COLLECTOR_ID = "c_yourcollector"
npm start
```

## Running the app

```bash
npm start
```

Open <http://localhost:3000>.

For a deterministic fixture view, open:

```text
http://localhost:3000/?demo=degraded
```

## Running tests

```bash
npm test
npm run test:browser
node --check server.js
node --check public/app.js
```

`npm test` runs backend, derivation, history, incident, field reliability, API, and isolation tests. `npm run test:browser` runs lightweight VM-based dashboard contract and rendering tests against the actual frontend script. These are not Playwright or full-browser E2E tests. The syntax checks validate the server and frontend JavaScript independently.

The tests use temporary history fixtures where persistence behavior is required. They must not write test data into `data/healing-history.json`.

## API overview

The dashboard endpoint is:

```text
GET /api/dashboard
GET /api/dashboard?demo=healthy|degraded|failed
```

Important response fields:

| Field | Meaning |
| --- | --- |
| `status` | Current `healthy`, `degraded`, or `failed` state |
| `product` | Latest structured product payload, when available |
| `missingFields` | Required fields currently unusable |
| `fieldDiagnostics` | Current field observations and reasons |
| `drift` | Structured-output changes detected for the current run |
| `recoveryEvent` | Recovery event associated with the current live run, when any |
| `runHistory` | Persisted live runs; empty for demo fixtures |
| `latestRun` | Latest persisted live run, when any |
| `runHistorySummary` | Derived counts, streaks, and per-field degradation/recovery counts |
| `incidents` | Derived incident lifecycle and recurrence records |
| `fieldReliability` | Derived per-field reliability entries from explicit live observations |
| `demo` | Demo mode identifier when serving a fixture |
| `collectorId` | Configured collector identifier |
| `checkedAt` | Response check timestamp |

The API preserves legacy history compatibility and does not persist derived incidents or field reliability separately.

## Data and history model

`data/healing-history.json` contains append-only live run history and legacy recovery events. `normalizeHistory()` preserves event-only legacy files and supplies an empty run list when no run-level evidence exists. Derived incidents and field reliability are calculated from available run evidence at response time.

`data/demo-product.json` is a local healthy fixture. Demo requests are read-only and must leave production history unchanged.

## Security and deployment

ScrapeShield is currently designed as a local operator console. The live collector trigger is not authenticated, so the application should not be exposed directly to an untrusted network without additional access controls.

Supply configuration through environment variables or the Bright Data CLI's local credential mechanism rather than committing secrets. Do not commit `.env` files, credentials, or collector authentication material. The live route can trigger a real collector run and mutate local history; use it only from a trusted operator environment.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Limitations

- Live execution currently assumes trusted/local use and has no authenticated remote operator access.
- Legacy event-only history cannot reconstruct historical field reliability.
- Field reliability requires sufficient explicit live observations.
- ScrapeShield does not infer website or root causes.
- The current browser tests are VM-based contract tests, not full browser automation.
- The project does not currently provide a hosted service, account system, or autonomous repair system.

## Project status

ScrapeShield is a portfolio / hackathon-ready reliability and observability project. It demonstrates backend integration, structured validation, drift detection, append-only history, incident handling, recovery verification, field reliability analysis, safe demo design, and defensive testing. It is not presented as a production-hosted or remotely authenticated SaaS product.

## License

Released under the MIT License. See [LICENSE](LICENSE).

## Team

| Member | Contributions |
| --- | --- |
| _Ayush Vij_ | Bright Data collector setup, backend, field validation, and recovery logic |
| _Namandeep Singh Taunk_ | Dashboard UI, demo modes, and documentation |

## AI-assisted development disclosure

This project was developed with AI assistance. AI tools supported code review, debugging, documentation, and implementation support under human direction and review. The Bright Data collector was created and configured by the team. Demo data is explicitly labeled fixture data and is isolated from live recovery history.
