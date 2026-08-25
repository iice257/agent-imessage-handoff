# OpenCode iMessage Handoff

Continue an [opencode](https://opencode.ai) session from iMessage or SMS. Send instructions from your phone, get answers back as texts, and keep the agent working while you are away from your desk.

This is an opencode port of the Codex iMessage Handoff architecture. The original Codex skill is [gragland/codex-imessage-handoff](https://github.com/gragland/codex-imessage-handoff); this port replaces the Codex Stop hook with an opencode plugin and the `$skill` invocation with an opencode skill.

## How It Works

1. Say "start handoff" in an opencode session. The skill registers the session with the relay and prints a pairing code.
2. Text the pairing code to the Sendblue number within 15 minutes. The relay links your phone to the session.
3. The plugin listens for the session to go idle, then publishes the assistant's answer to the relay, which forwards it to your phone over iMessage (SMS fallback).
4. The plugin holds a WebSocket to the relay while it waits. When you text a reply, the plugin claims it and injects it into the same opencode session as if you had typed it locally.
5. Local keyboard input always wins: typing in opencode disables handoff for that session.
6. Long tasks send short progress updates through the relay.

## Install

Copy the skill and the plugin into your opencode config:

```
imessage-handoff/  ->  ~/.config/opencode/skill/imessage-handoff/
plugin/imessage-handoff.js  ->  ~/.config/opencode/plugins/imessage-handoff.js
```

On Windows that is `C:\Users\<you>\.config\opencode\...`. Restart opencode so the plugin loads, open a session, and say:

```
start handoff
```

Requirements: Node 22+ on the PATH (native WebSocket), and a reachable relay (below).

## Relay

The skill defaults to a hosted relay. For production use, self-host your own:

1. Clone [iice257/codex-imessage-handoff](https://github.com/iice257/codex-imessage-handoff) and use its `relay/` folder (a Cloudflare Worker + D1 + Durable Object).
2. Follow `relay/README.md` there: create the D1 database, apply migrations before deploying (the hosted instance is currently broken for exactly this reason), set the Sendblue secrets, and deploy.
3. In the Sendblue dashboard, set the inbound webhook to `https://<your-worker>/webhooks/sendblue` plus a signing secret, and put the same secret in the worker.
4. Point the skill at it:

```
node ~/.config/opencode/skill/imessage-handoff/scripts/handoff-cli.js config set apiBaseUrl https://<your-worker>.workers.dev
```

Sendblue free tier works: you text the pairing code first, so your number is a verified contact.

## Commands

Local, inside opencode:

- `start handoff` / `$imessage-handoff` - enable for the current session
- `stop handoff` - disable
- `handoff status` / `handoff doctor` - diagnostics

From iMessage:

- Plain text becomes the next prompt in the session.
- "stop handoff" ends the handoff.

CLI directly:

```
node scripts/handoff-cli.js start|stop|status|doctor|config --json
node scripts/send-update.js --message="progress update"
```

## iMessage Formatting

Answers are delivered as plain text. The plugin and skill instruct the model to avoid markdown tables, headers, and code fences in handoff replies, and to structure with short lines, dashes, and blank lines instead.

## Security Model

Same as the original: the relay stores only routing metadata (thread state, pairing state, phone bindings) and never persists message content. Inbound messages are held briefly in memory until claimed, then scrubbed. Keep `~/.config/opencode/skill/imessage-handoff/.state/config.json` private; it contains the token linked to your phone number. Reset it with `handoff-cli.js config reset-token` if it leaks.

## Repo Layout

- `imessage-handoff/` - the opencode skill (SKILL.md + local CLI scripts)
- `plugin/imessage-handoff.js` - the opencode plugin (idle hook, relay WebSocket, reply injection)

## Credits

- Original Codex skill and relay: [gragland/codex-imessage-handoff](https://github.com/gragland/codex-imessage-handoff)
- Reliability layer and relay fixes: [iice257/codex-handoff-plus](https://github.com/iice257/codex-handoff-plus)
- opencode port: this repo
