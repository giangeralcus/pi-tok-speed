# pi-tok-speed

Live tokens/sec + spend tracker for the [pi coding agent](https://github.com/badlogic/pi-mono) footer.

## What you get

```
While streaming:   ⚡ ~54 tok/s · avg 57 · $0.0123 · ↓~1.2k tok
Message finalized: ⚡ 58 tok/s · avg 57 · $0.0123 · 256 tok
Turn ended:        ⚡ avg 57 tok/s (glm 51 · dsv4 69) · $0.0123 · 12 msg
```

- **Live estimate** while the model is writing (chars/4 over text + thinking + toolcall deltas, throttled 250ms)
- **Exact reading** per message from real usage counts over the decode window (first delta → finalize, TTFT excluded)
- **Session average**: total exact output tokens ÷ total exact decode seconds, plus cumulative session cost and tokens
- **Per-model breakdown** when multiple models are used in one session — turn-end summary shows each model's avg tok/s, model-change toasts show that model's own session stats, and the stats log gets a `perModel` object
- **Price rate announcements** on model change (in/out per M tokens, cache read) — plus that model's own session stats (messages, avg tok/s, spend)
- **Session end summary** appended to `~/.pi/agent/tok-speed-stats.jsonl` (model, messages, in/out tokens, cost, avg tok/s, decode seconds, price rates, per-model breakdown). Next session start shows the previous summary as a toast.
- **`/tokspeed`** command to toggle the indicator on/off
- pi's default footer (usage + cost) stays untouched — this adds a status line

## Install

```bash
pi install git:github.com/giangeralcus/pi-tok-speed
```

Then reload (`/reload`) or restart pi.

## Debug

Set `TOKSPEED_DEBUG=1` before launching pi → writes timings to `/tmp/tok-speed.log`.

## Benchmark context

Measured with [token-sec-calc](https://github.com/TechPreacher/token-sec-calc) against the opencode-go gateway (patched to send `x-opencode-session` + `x-opencode-client` headers):

| Model | tok/s | TTFT p50 |
|---|---|---|
| glm-5.3-flash | ~52 | 1.8s |
| deepseek-v4-flash | ~69 | 3.1s |

## License

MIT
