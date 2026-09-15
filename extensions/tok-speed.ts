/**
 * tok-speed — live tokens/sec + spend tracker for pi's footer.
 *
 * Status line (default footer stays untouched):
 * - While streaming:    `⚡ ~54 tok/s · avg 57 · $0.0123 · ↓~1.2k tok`
 * - Message finalized:  `⚡ 58 tok/s · avg 57 · $0.0123 · 256 tok`
 * - Turn ended:         `⚡ avg 57 tok/s · $0.0123 · 12 msg`
 *
 * - Live estimate: chars/4 over text+thinking+toolcall deltas, throttled 250ms.
 * - Per-message reading: exact usage.output over the decode window
 *   (first delta → finalize, TTFT excluded).
 * - Session average: total exact output tokens ÷ total exact decode seconds.
 * - Session spend/tokens: accumulated from real usage (incl. cache cost).
 *
 * On session end, appends a summary line to ~/.pi/agent/tok-speed-stats.jsonl
 * (model, messages, in/out tokens, cost, avg tok/s, decode seconds, model
 * price rates). The next session start shows the previous session's summary
 * as a toast. Model price rates are announced on model change.
 *
 * Toggle with /tokspeed. Debug: TOKSPEED_DEBUG=1 → /tmp/tok-speed.log
 */

import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const KEY = "tok-speed";
const THROTTLE_MS = 250;
const DEBUG = process.env.TOKSPEED_DEBUG === "1";
const DBG_PATH = "/tmp/tok-speed.log";
const STATS_PATH = join(homedir(), ".pi", "agent", "tok-speed-stats.jsonl");

const dbg = (line: string) => {
	if (!DEBUG) return;
	try {
		appendFileSync(DBG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* ignore */
	}
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const money = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

export default function (pi: ExtensionAPI) {
	let enabled = true;

	let t0 = 0; // timestamp of first delta in the current assistant stream (ms)
	let chars = 0; // accumulated text+thinking+toolcall delta chars
	let lastPaint = 0;

	// session totals — exact values from finalized messages (this run)
	let totalIn = 0;
	let totalOut = 0;
	let totalCost = 0;
	let totalSec = 0; // exact decode seconds
	let msgCount = 0;

	// per-model session totals (exact, keyed by the message's own model field)
	const perModel = new Map<string, { msgs: number; inTok: number; tokens: number; cost: number; sec: number }>();
	const shortModel = (id: string) =>
		id.split("/").pop()!.split("-").slice(0, 2).join("-");

	const avg = () => (totalSec > 0 ? totalOut / totalSec : 0);

	pi.on("session_start", async (_event, ctx) => {
		totalIn = 0;
		totalOut = 0;
		totalCost = 0;
		totalSec = 0;
		msgCount = 0;
		perModel.clear();
		t0 = 0;
		chars = 0;
		if (!ctx.hasUI) return;
		try {
			const lines = readFileSync(STATS_PATH, "utf-8").trim().split("\n");
			const last = lines[lines.length - 1];
			if (last) {
				const s = JSON.parse(last) as {
					avgTokPerSec?: number;
					cost?: number;
					messages?: number;
					inputTokens?: number;
					outputTokens?: number;
					model?: string;
				};
				if (s && typeof s.cost === "number") {
					ctx.ui.notify(
						`last session: ⚡ avg ${s.avgTokPerSec?.toFixed(0) ?? "?"} tok/s · ${money(s.cost)} · ${s.messages ?? "?"} msg · ↑${fmt(s.inputTokens ?? 0)} ↓${fmt(s.outputTokens ?? 0)} tok`,
						"info",
					);
				}
			}
		} catch {
			/* no stats file yet */
		}
	});

	pi.registerCommand("tokspeed", {
		description: "Toggle live tokens/sec status",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				const a = avg();
				ctx.ui.setStatus(
					KEY,
					ctx.ui.theme.fg(
						"dim",
						a > 0 ? `⚡ avg ${a.toFixed(0)} tok/s · ${money(totalCost)} · ${msgCount} msg` : "⚡ tok-speed on",
					),
				);
				ctx.ui.notify("tok-speed on", "info");
			} else {
				ctx.ui.setStatus(KEY, undefined);
				ctx.ui.notify("tok-speed off", "info");
			}
		},
	});

	pi.on("model_select", async (event, ctx) => {
		if (!ctx.hasUI) return;
		const c = event.model?.cost;
		const s = perModel.get(event.model?.id ?? "");
		const sesPart =
			s && s.msgs > 0 && s.sec > 0
				? ` · sesi ini: ${s.msgs} msg · avg ${(s.tokens / s.sec).toFixed(0)} tok/s · ${money(s.cost)}`
				: "";
		if (c)
			ctx.ui.notify(
				`${event.model.id}: in $${c.input}/M · out $${c.output}/M tok${c.cacheRead ? ` · cache read $${c.cacheRead}/M` : ""}${sesPart}`,
				"info",
			);
	});

	pi.on("message_update", async (event, ctx) => {
		if (!enabled || (!ctx.hasUI && !DEBUG)) return;
		const ev = event.assistantMessageEvent;
		if (!ev) return;
		if (ev.type !== "text_delta" && ev.type !== "thinking_delta" && ev.type !== "toolcall_delta")
			return;
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
			const a = avg();
			const avgPart = a > 0 ? ` · avg ${a.toFixed(0)}` : "";
			ctx.ui.setStatus(
				KEY,
				ctx.ui.theme.fg("accent", `⚡ ~${tps.toFixed(0)} tok/s${avgPart} · ${money(totalCost)} · ↓~${fmt(est)} tok`),
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
		totalIn += m.usage?.input ?? 0;
		totalOut += out;
		totalCost += m.usage?.cost?.total ?? 0;
		totalSec += elapsed;
		msgCount += 1;
		const mid = m.model || ctx.model?.id || "?";
		const pm = perModel.get(mid) ?? { msgs: 0, inTok: 0, tokens: 0, cost: 0, sec: 0 };
		pm.msgs += 1;
		pm.inTok += m.usage?.input ?? 0;
		pm.tokens += out;
		pm.cost += m.usage?.cost?.total ?? 0;
		pm.sec += elapsed;
		perModel.set(mid, pm);
		const a = avg();
		dbg(
			`final out=${out} elapsed=${elapsed.toFixed(2)}s tps=${tps.toFixed(1)} avg=${a.toFixed(1)} msgs=${msgCount} cost=${totalCost.toFixed(4)}`,
		);
		ctx.ui.setStatus(
			KEY,
			ctx.ui.theme.fg(
				"dim",
				`⚡ ${tps.toFixed(0)} tok/s · avg ${a.toFixed(0)} · ${money(totalCost)} · ↓${fmt(totalOut)} tok`,
			),
		);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!enabled || !ctx.hasUI) return;
		const a = avg();
		if (msgCount === 0) return;
		let breakdown = "";
		if (perModel.size > 1) {
			const parts = [...perModel.entries()].map(([id, s]) =>
				`${shortModel(id)} ${s.sec > 0 ? (s.tokens / s.sec).toFixed(0) : "?"}`,
			);
			breakdown = ` (${parts.slice(0, 3).join(" · ")}${parts.length > 3 ? " …" : ""})`;
		}
		ctx.ui.setStatus(
			KEY,
			ctx.ui.theme.fg("dim", `⚡ avg ${a.toFixed(0)} tok/s${breakdown} · ${money(totalCost)} · ${msgCount} msg`),
		);
	});

	pi.on("session_shutdown", async (event, ctx) => {
		// authoritative session totals: recompute from the whole session history
		// (covers turns that happened before an extension reload)
		const model = ctx.model?.id ?? "?";
		let inTok = totalIn;
		let outTok = totalOut;
		let cost = totalCost;
		let msgs = msgCount;
		const histPerModel = new Map<string, { msgs: number; inputTokens: number; outputTokens: number; cost: number }>();
		try {
			inTok = 0;
			outTok = 0;
			cost = 0;
			msgs = 0;
			for (const e of ctx.sessionManager.getBranch()) {
				if (e.type !== "message" || e.message.role !== "assistant") continue;
				const m = e.message as AssistantMessage;
				if (!m.usage) continue;
				inTok += m.usage.input ?? 0;
				outTok += m.usage.output ?? 0;
				cost += m.usage.cost?.total ?? 0;
				msgs += 1;
				const mid = m.model || "?";
				const pm = histPerModel.get(mid) ?? { msgs: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
				pm.msgs += 1;
				pm.inputTokens += m.usage.input ?? 0;
				pm.outputTokens += m.usage.output ?? 0;
				pm.cost += m.usage.cost?.total ?? 0;
				histPerModel.set(mid, pm);
			}
		} catch {
			/* keep tracked totals */
			inTok = totalIn;
			outTok = totalOut;
			cost = totalCost;
			msgs = msgCount;
		}
		const a = totalSec > 0 ? outTok / totalSec : 0;
		const rates = ctx.model?.cost;
		const perModelOut: Record<string, unknown> = {};
		for (const [id, hp] of histPerModel.entries()) {
			const rt = perModel.get(id);
			perModelOut[id] = {
				...hp,
				cost: Number(hp.cost.toFixed(6)),
				avgTokPerSec: rt && rt.sec > 0 ? Number((rt.tokens / rt.sec).toFixed(2)) : null,
				decodeSeconds: rt && rt.sec > 0 ? Number(rt.sec.toFixed(2)) : null,
			};
		}
		const record = {
			ts: new Date().toISOString(),
			reason: event.reason,
			cwd: ctx.cwd,
			model,
			messages: msgs,
			inputTokens: inTok,
			outputTokens: outTok,
			cost: Number(cost.toFixed(6)),
			avgTokPerSec: a > 0 ? Number(a.toFixed(2)) : null,
			decodeSeconds: totalSec > 0 ? Number(totalSec.toFixed(2)) : null,
			rateInPerM: rates?.input ?? null,
			rateOutPerM: rates?.output ?? null,
			perModel: Object.keys(perModelOut).length > 0 ? perModelOut : undefined,
		};
		try {
			appendFileSync(STATS_PATH, `${JSON.stringify(record)}\n`);
		} catch {
			/* ignore */
		}
		dbg(`session end (${event.reason}): ${JSON.stringify(record)}`);
	});
}
