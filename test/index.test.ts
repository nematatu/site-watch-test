import { describe, expect, test } from "bun:test";
import { formatJst, normalizeText, sha256 } from "../src/index";

describe("content normalization", () => {
	test("空白・改行・全角空白を同一視する", () => {
		expect(normalizeText("  Amtt\n\t About　 Works  ")).toBe("Amtt About Works");
	});

	test("同じ内容から安定したSHA-256を作る", async () => {
		expect(await sha256("Amtt About Works")).toBe(await sha256("Amtt About Works"));
		expect(await sha256("Amtt About Works")).not.toBe(await sha256("Amtt About Work"));
	});
});

test("UTCの日時を日本時間で表示する", () => {
	expect(formatJst("2026-09-11T11:23:02.605Z")).toBe("2026-09-11 20:23:02 JST");
});
