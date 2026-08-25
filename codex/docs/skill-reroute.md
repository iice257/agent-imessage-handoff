# Skill Reroute Notes

The installed `imessage-handoff` skill should call:

```bash
node scripts/handoff-cli.js <command> --json
```

The wrapper resolves the repository `bin/handoff.mjs` when available and falls back to a `handoff` executable on `PATH`. Set `HANDOFF_CLI` to an absolute `bin/handoff.mjs` path for a local personal checkout.

The skill must not duplicate state, recovery, diagnostic, or Sendblue logic. It should summarize redacted CLI output and show only product-facing messages.
