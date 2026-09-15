# pi-tok-speed

Live **tokens/sec** indicator for [pi](https://pi.dev) coding agent's footer, via a status line — the default footer (usage + cost) stays untouched.

- **While the model is writing:** `⚡ ~54 tok/s · ↓~1.2k tok` — live estimate, updated ~4×/s
- **When a message finishes:** `⚡ 58 tok/s · 256 tok · 4.4s` — exact tok/s computed from the real `usage.output`

## Install

As a pi package (recommended):

```bash
pi install git:github.com/giangeralcus/pi-tok-speed
```

Or manually — copy [`extensions/tok-speed.ts`](extensions/tok-speed.ts) into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local).

Then reload: `/reload` inside pi, or just restart it.

## Usage

Nothing to configure. The status line shows up automatically:

| State | Footer shows |
|---|---|
| Assistant streaming | `⚡ ~54 tok/s · ↓~1.2k tok` (live, accent color) |
| Message finalized | `⚡ 58 tok/s · 256 tok · 4.4s` (exact, dim) |

- `/tokspeed` — toggle the indicator on/off
- The timing window starts at the **first streamed token** and ends when the message finalizes, so TTFT (thinking/wait time before the first token) is **excluded** — the reading is pure decode speed, same semantics as common tok/s benchmarks.

## How it works

- **Live estimate:** accumulates `text_delta` + `thinking_delta` characters during streaming, estimated at chars/4, throttled to one status update per 250 ms. Providers only report usage in the final chunk, so an estimate is the best available mid-stream.
- **Final reading:** exact `usage.output ÷ elapsed` from the finalized assistant message.

## Debug

Set `TOKSPEED_DEBUG=1` before launching pi to append every reading to `/tmp/tok-speed.log`:

```bash
TOKSPEED_DEBUG=1 pi
```

## Numbers for context

Benchmarked with [TechPreacher/token-sec-calc](https://github.com/TechPreacher/token-sec-calc) against `opencode.ai/zen/go/v1` (256-token streaming, closed-loop, 2026-09-15):

| Model | Throughput | TTFT (p50) |
|---|---|---|
| glm-5.3-flash | 51.65 tok/s | 1.8s |
| deepseek-v4-flash | 68.88 tok/s | 3.1s |

## Updating

```bash
git pull          # in your clone / dev copy
pi update --extensions   # if installed as a package
```

## License

[MIT](LICENSE)
