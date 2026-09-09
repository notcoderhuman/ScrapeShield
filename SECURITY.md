# Security Policy

## Deployment boundary

ScrapeShield is currently designed as a local operator console. The live collector trigger is not authenticated and can invoke a real Bright Data collector run and append local history. Do not expose the application directly to an untrusted network without adding access controls, rate limiting, and an explicit remote-operator security model.

Demo routes are read-only and do not modify production history.

## Credentials and configuration

Do not commit Bright Data credentials, `.env` files, API tokens, or local CLI authentication material. Configure the collector ID and port through environment variables where supported. Bright Data credentials should remain in the Bright Data CLI's local credential store.

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Contact the repository maintainers privately with:

- A concise description of the issue.
- Affected route or file.
- Reproduction steps.
- Impact assessment.
- Any proposed mitigation.

Allow maintainers reasonable time to investigate before public disclosure. This project is currently a portfolio/hackathon repository and does not promise a formal response-time SLA.
