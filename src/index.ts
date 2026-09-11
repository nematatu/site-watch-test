const TARGET_URL = "https://amatatu.com/";
const STATE_KEY = "site:v2:https://amatatu.com/";
const FETCH_TIMEOUT_MS = 15_000;
type Snapshot = { version: 1; hash: string; checkedAt: string };
type CheckStatus = "baseline" | "unchanged" | "changed";

export function normalizeText(value: string): string {
	return value.replace(/[\s\u3000]+/gu, " ").trim();
}

export function formatJst(value: string): string {
	const date = new Date(value);
	return `${new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")} JST`;
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function extractMainText(response: Response): Promise<string> {
	let found = false;
	let text = "";
	await new HTMLRewriter()
		.on("main", {
			element() { found = true; },
			text(chunk) { text += chunk.text; },
		})
		.transform(response)
		.arrayBuffer();
	const normalized = normalizeText(text);
	if (!found) throw new Error("main element not found");
	if (!normalized) throw new Error("main element is empty");
	return normalized;
}

async function fetchSnapshot(): Promise<Snapshot> {
	const response = await fetch(TARGET_URL, {
		headers: { "User-Agent": "site-watch-test/1.0 (+Cloudflare Workers)" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`target HTTP ${response.status} ${response.statusText}`);
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("text/html")) throw new Error(`unexpected content-type: ${contentType || "missing"}`);
	const content = await extractMainText(response);
	return { version: 1, hash: await sha256(content), checkedAt: new Date().toISOString() };
}

async function sendNotification(topic: string, checkedAt: string): Promise<void> {
	const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
		method: "POST",
		headers: {
			Title: encodeURIComponent("ポートフォリオサイト更新検知"),
			Click: TARGET_URL,
			"Content-Type": "text/plain; charset=utf-8",
		},
		body: `amatatu.com の表示内容が更新されました。\n\n確認日時: ${formatJst(checkedAt)}`,
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`ntfy HTTP ${response.status} ${response.statusText}`);
}

async function checkSite(env: Env): Promise<CheckStatus> {
	const snapshot = await fetchSnapshot();
	const previous = await env.WATCH_STATE.get<Snapshot>(STATE_KEY, "json");
	if (!previous) {
		await env.WATCH_STATE.put(STATE_KEY, JSON.stringify(snapshot));
		return "baseline";
	}
	if (previous.hash === snapshot.hash) return "unchanged";
	await env.WATCH_STATE.put(STATE_KEY, JSON.stringify(snapshot));
	await sendNotification(env.NTFY_TOPIC, snapshot.checkedAt);
	return "changed";
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/") {
			const state = await env.WATCH_STATE.get<Snapshot>(STATE_KEY, "json");
			return Response.json(
				{
					status: "ok",
					service: "site-watch-test",
					target: TARGET_URL,
					baselineUpdatedAt: state ? formatJst(state.checkedAt) : null,
				},
				{ headers: { "Cache-Control": "no-store" } },
			);
		}
		return Response.json({ status: "error", error: "not found" }, { status: 404 });
	},
	async scheduled(controller, env, ctx): Promise<void> {
		ctx.waitUntil(checkSite(env)
			.then((status) => console.log("site check completed", { status, cron: controller.cron }))
			.catch((error) => console.error("site check failed", { url: TARGET_URL, cron: controller.cron, error: error instanceof Error ? error.message : String(error) })));
	},
} satisfies ExportedHandler<Env>;
