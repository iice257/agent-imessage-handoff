# Handoff CLI Command Reference

`handoff` is the local reliability CLI behind the Codex iMessage Handoff skill. Every command supports `--json` for stable machine-readable output.

## Core

```bash
handoff init
handoff start
handoff stop
handoff status
handoff doctor
handoff repair
handoff logs
handoff transcript
handoff recover
```

`start` registers the current `CODEX_THREAD_ID`. `stop` disables the current or last active thread. `recover` generates missed-reply candidates and never sends without explicit confirmation.

## Simulation

```bash
handoff simulate inbound "what did I miss?"
handoff simulate failure webhook_timeout
handoff simulate failure codex_disconnect
```

Simulator commands append normal events to the local JSONL log and do not call Sendblue.

## Config

```bash
handoff config get
handoff config set apiBaseUrl https://example.test
handoff config set token ih_xxx
handoff config profiles
handoff config use dry-run
handoff upgrade
```

Profiles are `personal`, `test`, `production`, and `dry-run`. Runtime modes are `dry-run`, `confirm-send`, and `auto-send`.
