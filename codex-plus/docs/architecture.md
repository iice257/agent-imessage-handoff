# Handoff Plus Architecture

Handoff Plus keeps business logic in the repo and leaves the Codex skill as a thin CLI wrapper.

## Local Source Of Truth

The canonical local record is `.state/plus/events.jsonl`. Derived views such as status, transcript, dashboard timelines, and recovery candidates are rebuilt from events.

## Safety

Secrets are redacted before events are written. Runtime profiles default to `confirm-send` except simulator/test profiles, which use `dry-run`. Recovery candidates are generated locally and require explicit approval before any send path can be used.

## Relay Boundary

The existing Cloudflare relay API remains the compatibility boundary:

- `POST /threads/:threadId`
- `POST /threads/:threadId/status`
- `GET /threads/:threadId/events`
- `POST /threads/:threadId/replies/:replyId/claim`
- `POST /threads/:threadId/stop`

The local CLI wraps and observes this API rather than replacing the Worker.
