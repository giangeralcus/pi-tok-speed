/**
 * tok-speed — live tokens/sec for pi's footer.
 *
 * While the assistant is streaming, shows a live tok/s estimate (chars/4
 * heuristic over text+thinking deltas) and a running token count via
 * ctx.ui.setStatus — the default footer (usage + cost) stays untouched.
 * When a message finalizes, the reading is replaced with the exact tok/s
 * computed from usage.output over the decode window (first delta → end,
 * TTFT excluded).
 *
 * Toggle with /tokspeed.
 */

import { appendFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const KEY = "tok-speed";
const THROTTLE_MS = 250;
const DEBUG = process.env.TOKSPEED_DEBUG === "1";
const DBG_PATH = "/tmp/tok-speed.log";
const dbg = (line: string) => {
	if (!DEBUG) return;
	try {
		appendFileSync(DBG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* ignore */
	}
};

export default function (pi: ExtensionAPI) {
	let enabled = true;

	let t0 = 0; // timestamp of first delta in the current assistant stream (ms)
	let chars = 0; // accumulated text+thinking delta chars
	let lastPaint = 0;

	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

	pi.registerCommand("tokspeed", {
		description: "Toggle live tokens/sec status",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				ctx.ui.setStatus(KEY, ctx.ui.theme.fg("dim", "⚡ tok-speed on"));
				ctx.ui.notify("tok-speed on", "info");
			} else {
				ctx.ui.setStatus(KEY, undefined);
				ctx.ui.notify("tok-speed off", "info");
			}
		},
	});

	pi.on("message_update", async (event, ctx) => {
		if (!enabled || (!ctx.hasUI && !DEBUG)) return;
		const ev = event.assistantMessageEvent;
		if (!ev || (ev.type !== "text_delta" && ev.type !== "thinking_delta")) return;
		if (!t0) {
			t0 = Date.now();
			dbg(`stream start (model=${ctx.model?.id ?? "?"})`);
		}
		chars += ev.delta.length;
		const now = Date.now();
		if (now - lastPaint >= THROTTLE_MS) {
			lastPaint = now;
			const elapsed = (now - t0) / 1000;
			const est = chars / 4;
			const tps = elapsed > 0 ? est / elapsed : 0;
			ctx.ui.setStatus(
				KEY,
				ctx.ui.theme.fg("accent", `⚡ ~${tps.toFixed(0)} tok/s · ↓~${fmt(est)} tok`),
			);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!enabled || (!ctx.hasUI && !DEBUG)) return;
		if (event.message.role !== "assistant") return;
		const m = event.message as AssistantMessage;
		const start = t0;
		const out = m.usage?.output ?? 0;
		t0 = 0;
		chars = 0;
		lastPaint = 0;
		if (!start || out <= 0) return;
		const elapsed = (Date.now() - start) / 1000;
		if (elapsed <= 0) return;
		const tps = out / elapsed;
		dbg(`final out=${out} elapsed=${elapsed.toFixed(2)}s tps=${tps.toFixed(1)} (t0-first-delta)`);
		ctx.ui.setStatus(
			KEY,
			ctx.ui.theme.fg("dim", `⚡ ${tps.toFixed(0)} tok/s · ${fmt(out)} tok · ${elapsed.toFixed(1)}s`),
		);
	});
}
