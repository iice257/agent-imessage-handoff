---
name: imessage-handoff
description: Start or stop iMessage handoff for the current opencode session. Use when the user invokes iMessage Handoff, mentions $imessage-handoff, says "start handoff", "go handoff", "stop handoff", or asks to continue the current session from iMessage.
---

# iMessage Handoff

Use this skill when the user invokes iMessage Handoff, mentions `$imessage-handoff`, says "start handoff", "go handoff", "stop handoff", asks for iMessage handoff status/doctor/config, or asks to continue the current session from iMessage.

This skill is a thin interface over the skill-owned `handoff-cli.js`. Run scripts with Node, resolving paths relative to this `SKILL.md`. Do not duplicate handoff business logic here.

## Start

If invoked without additional instructions, start handoff for the current session:

```bash
node scripts/handoff-cli.js start --json
```

The CLI finds the current session id automatically (the plugin records it). Read the JSON output. Reply with `localMessage` exactly and nothing else. If the command fails because setup is incomplete, run:

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

## Handling incoming iMessage replies

While handoff is active, replies arrive as injected user messages that begin with a blockquote display block followed by `User message to answer:`. Treat the text after `User message to answer:` exactly as if the user typed it locally.

- If an iMessage reply says "stop handoff" (or clearly asks to end handoff), run the Stop command above and confirm.
- If work may take more than a few minutes, send brief progress updates by running:

```bash
node scripts/send-update.js --message="One or two sentence update"
```

Use progress updates sparingly; they only reassure the user during longer tasks.

## iMessage output formatting

Replies are delivered to a phone as plain text. Never send markdown tables, headers, code fences, or links through handoff — they render as raw symbols. Structure with short lines, dashes, and blank lines. Keep replies compact; long code belongs in files, not in the message.

## Status and Doctor

- For status: run `node scripts/handoff-cli.js status --json`, summarize current state and `nextAction`.
- For doctor: run `node scripts/handoff-cli.js doctor --json`, summarize failed and warning checks.

## Config

- Show config: `node scripts/handoff-cli.js config get --json`
- Set a value (for example a self-hosted relay): `node scripts/handoff-cli.js config set apiBaseUrl https://<your-worker-url> --json`
- Reset the install token: `node scripts/handoff-cli.js config reset-token --json`

Summaries must use redacted CLI output only.
