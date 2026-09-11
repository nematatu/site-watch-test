const TARGET_URL = "https://amatatu.com/";
const STATE_KEY = "site:v2:https://amatatu.com/";
const FETCH_TIMEOUT_MS = 15_000;

export type Snapshot = { version: 1; url: string; hash: string; content: string; checkedAt: string };
export type CheckResult = {
	status: "baseline" | "unchanged" | "changed";
	url: string;
	checkedAt: string;
	hash: string;
	previousHash: string | null;
	contentLength: number;
	notified: boolean;
};

export function normalizeText(value: string): string {
	return value.replace(/[\s\u3000]+/gu, " ").trim();
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractMainText(response: Response): Promise<string> {
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
	return { version: 1, url: TARGET_URL, hash: await sha256(content), content, checkedAt: new Date().toISOString() };
}

async function sendNotification(topic: string, snapshot: Snapshot, previous: Snapshot): Promise<void> {
	const headers: Record<string, string> = {
		Title: encodeURIComponent("ポートフォリオサイト更新検知"),
		Click: TARGET_URL,
		Tags: "computer,white_check_mark",
		"Content-Type": "text/plain; charset=utf-8",
	};
	const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
		method: "POST",
		headers,
		body: ["amatatu.com の表示内容が更新されました。", "", `変更前: ${previous.hash.slice(0, 12)}`, `変更後: ${snapshot.hash.slice(0, 12)}`, `確認日時: ${snapshot.checkedAt}`].join("\n"),
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`ntfy HTTP ${response.status} ${response.statusText}`);
}

export async function checkSite(env: Env): Promise<CheckResult> {
	const snapshot = await fetchSnapshot();
	const previous = await env.WATCH_STATE.get<Snapshot>(STATE_KEY, "json");
	if (!previous) {
		await env.WATCH_STATE.put(STATE_KEY, JSON.stringify(snapshot));
		return makeResult("baseline", snapshot, null, false);
	}
	if (previous.hash === snapshot.hash) return makeResult("unchanged", snapshot, previous, false);
	await sendNotification(env.NTFY_TOPIC, snapshot, previous);
	await env.WATCH_STATE.put(STATE_KEY, JSON.stringify(snapshot));
	return makeResult("changed", snapshot, previous, true);
}

function makeResult(status: CheckResult["status"], current: Snapshot, previous: Snapshot | null, notified: boolean): CheckResult {
	return { status, url: current.url, checkedAt: current.checkedAt, hash: current.hash, previousHash: previous?.hash ?? null, contentLength: current.content.length, notified };
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/") {
			const state = await env.WATCH_STATE.get<Snapshot>(STATE_KEY, "json");
			return json({ status: "ok", service: "site-watch-test", target: TARGET_URL, snapshotUpdatedAt: state?.checkedAt ?? null, currentHash: state?.hash ?? null });
		}
		return json({ status: "error", error: "not found" }, 404);
	},
	async scheduled(controller, env, ctx): Promise<void> {
		ctx.waitUntil(checkSite(env)
			.then((check) => console.log("site check completed", { ...check, cron: controller.cron }))
			.catch((error) => console.error("site check failed", { url: TARGET_URL, cron: controller.cron, error: error instanceof Error ? error.message : String(error) })));
	},
} satisfies ExportedHandler<Env>;
