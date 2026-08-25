---
name: imessage-handoff
description: Start or stop iMessage handoff for the current Codex thread. Use when the user invokes iMessage Handoff, mentions $imessage-handoff, says "start handoff", "go handoff", "stop handoff", or asks to continue the current thread from iMessage.
---

# iMessage Handoff

Use this skill when the user invokes iMessage Handoff, mentions `$imessage-handoff`, says "start handoff", "go handoff", "stop handoff", asks for iMessage handoff status/doctor/repair/recovery, or asks to continue the current thread from iMessage.

This skill is a thin interface over the repository-owned `handoff` CLI. Run `scripts/handoff-cli.js` with Node, resolving it relative to this `SKILL.md`. Do not duplicate handoff business logic in this file.

## Start

If invoked without additional instructions, start handoff for the current thread:

```bash
node scripts/handoff-cli.js start --json
```

Read the JSON output. Reply with `localMessage` exactly and nothing else. If the command fails because setup is incomplete, run:

```bash
node scripts/handoff-cli.js doctor --json
```

Then briefly tell the user the failing check and the next action. Never print tokens, auth headers, raw config secrets, or full internal debug output.

## Stop

When the user asks to stop handoff:

```bash
node scripts/handoff-cli.js stop --json
```

Tell the user:

```text
iMessage Handoff is stopped.
```

## Status, Doctor, Repair, Recovery

- For status: run `node scripts/handoff-cli.js status --json`, summarize current state and `nextAction`.
- For doctor: run `node scripts/handoff-cli.js doctor --json`, summarize failed and warning checks.
- For repair: run `node scripts/handoff-cli.js repair --json`; only safe automatic repairs run by default.
- For recovery: run `node scripts/handoff-cli.js recover --json`, show candidate prompts for approval. Do not send recovery messages unless the user explicitly asks and the CLI confirms send mode.

## Config

Use the CLI for configuration:

- Show config: `node scripts/handoff-cli.js config get --json`
- Set a value: `node scripts/handoff-cli.js config set key value --json`
- List profiles: `node scripts/handoff-cli.js config profiles --json`
- Use profile: `node scripts/handoff-cli.js config use profile --json`
- Upgrade legacy state: `node scripts/handoff-cli.js upgrade --json`

Summaries must use redacted CLI output only.

## Testing

For local simulation and diagnostics:

```bash
node scripts/handoff-cli.js simulate inbound "what did I miss?" --json
node scripts/handoff-cli.js simulate failure webhook_timeout --json
node scripts/handoff-cli.js logs --json
node scripts/handoff-cli.js transcript --json
```
