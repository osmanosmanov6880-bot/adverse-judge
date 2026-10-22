# ADVERSE JUDGE · CINEMA

**Working development repository** for **ADVERSE JUDGE 0.30.0** and its **CINEMA 1.1 interactive film**. Russian-language guide: [README_RU.md](README_RU.md).

## Run locally

Requires Node.js **22.13+**. No external npm packages are required for the core.

```bash
npm start
```

Open **http://localhost:3000**. The interactive film is integrated into the JUDGE app and can prepare a draft case after explicit user consent. The case is **not** automatically approved.

## Tests

```bash
npm test
node --test cinema/tests/engine.test.js
```

## Repository layout

- `server/`: core API, event history, accounts, campaign workflow, cinema import bridge.
- `public/`: application interface.
- `cinema/src/`: interactive story engine, scene data, client UI, sound.
- `cinema/assets/`: optimized illustrative `.webp` frames.
- `cinema/docs/`: narrative, storyboard, art direction and key-frame prompts.
- `tests/`: API, security, migration and domain tests with synthetic DB fixtures.
- `integrations/`: partner handoff SDK and receiver example.
- `scripts/`: local QA and backup/health utilities.

## Important limitations

This is a **local pilot**, not a production SaaS deployment. The seven external advertising sites have **not** been connected, cloud identity/SMTP is not configured, and production hardening is incomplete.

Never commit `.env`, production SQLite data, credentials, personal data or access tokens. Before a public deployment run a security review and configure HTTPS, identity, backups and rate-limiting infrastructure.

No software license is granted by default; project owner can add one after deciding the licensing model.
