import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildGeminiRequestBody,
	mapGeminiFinishReason,
	normalizeGeminiRoot,
	parseGeminiResponse,
	parseGeminiSseEvents,
	stream,
} from "./gemini-native.js";
import type { Model, TranscriptContext } from "./pi/types.js";

const context = (messages: TranscriptContext["messages"]): TranscriptContext => ({ messages } as TranscriptContext);

const model: Model<"google-gemini"> = {
	id: "gemini-2.5-flash",
	name: "gemini-2.5-flash",
	api: "google-gemini",
	provider: "google",
	baseUrl: "https://generativelanguage.googleapis.com/v1beta",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4_096,
};

test("normalizes Gemini roots without retaining protocol suffixes", () => {
	assert.equal(normalizeGeminiRoot("https://generativelanguage.googleapis.com/v1beta"), "https://generativelanguage.googleapis.com");
	assert.equal(normalizeGeminiRoot("https://example.com/v1/models/"), "https://example.com");
	assert.equal(normalizeGeminiRoot("https://example.com/models/v1beta/v1"), "https://example.com");
});

test("maps system, assistant tool calls, and tool results to Gemini contents", () => {
	const body = buildGeminiRequestBody({
		messages: [
			{ role: "system", content: "Be concise", timestamp: 1 },
			{ role: "user", content: [{ type: "text", text: "Read it" }], timestamp: 2 },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { page: 3 } }],
				api: "google-gemini", provider: "google", model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse", timestamp: 3,
			},
			{ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "page three" }], isError: false, timestamp: 4 },
		] as TranscriptContext["messages"],
	}, { temperature: 0.2, maxTokens: 128 });
	assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be concise" }] });
	assert.deepEqual(body.contents, [
		{ role: "user", parts: [{ text: "Read it" }] },
		{ role: "model", parts: [{ functionCall: { name: "read", args: { page: 3 } } }] },
		{ role: "user", parts: [{ functionResponse: { name: "read", response: { content: "page three" } } }] },
	]);
	assert.deepEqual(body.generationConfig, { maxOutputTokens: 128, temperature: 0.2 });
});

test("sends only x-goog-api-key and never puts the key in the URL", async () => {
	let seenUrl = "";
	let seenHeaders: Headers | undefined;
	const response = new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } });
	const events = stream(model, context([{ role: "user", content: "hello", timestamp: 1 }]), {
		apiKey: "secret-key",
		fetch: async (input, init) => {
			seenUrl = String(input);
			seenHeaders = new Headers(init?.headers);
			return response;
		},
	});
	await events.result();
	assert.equal(seenUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
	assert.equal(seenHeaders?.get("x-goog-api-key"), "secret-key");
	assert.equal(seenHeaders?.get("authorization"), null);
	assert.equal(seenHeaders?.get("x-api-key"), null);
	assert.equal(seenUrl.includes("key="), false);
});

test("parses SSE text and tool-call increments, finish reasons, and usage", () => {
	const events = parseGeminiSseEvents([
		`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "hel" }] } }] })}`,
		"",
		`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }, { functionCall: { name: "lookup", args: { q: "x" } } }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, totalTokenCount: 10 } })}`,
		"",
	].join("\n"));
	assert.equal(events[0]?.text, "hel");
	assert.equal(events[1]?.text, "lo");
	assert.deepEqual(events[1]?.toolCalls[0], { id: "lookup0", name: "lookup", arguments: { q: "x" } });
	assert.equal(events[1]?.stopReason, "length");
	assert.equal(events[1]?.rawStopReason, "MAX_TOKENS");
	assert.deepEqual(events[1]?.usage && {
		input: events[1].usage.input,
		output: events[1].usage.output,
		totalTokens: events[1].usage.totalTokens,
	}, { input: 4, output: 6, totalTokens: 10 });
});

test("streams split response chunks without a real network request", async () => {
	const encoder = new TextEncoder();
	const chunks = [
		`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "A" }] } }] })}\n\n`,
		`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } })}\n\n`,
	];
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	const result = await stream(model, context([{ role: "user", content: "hello", timestamp: 1 }]), {
		apiKey: "secret-key",
		fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
	}).result();
	assert.equal(result.stopReason, "stop");
	assert.equal(result.content.find((part) => part.type === "text")?.type, "text");
	assert.deepEqual(result.content.find((part) => part.type === "toolCall"), {
		type: "toolCall", id: "lookup0", name: "lookup", arguments: { q: "x" },
	});
	assert.deepEqual(result.usage, {
		input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test("maps all documented Gemini finish reasons and preserves unknown reason as stop", () => {
	assert.equal(mapGeminiFinishReason("STOP"), "stop");
	assert.equal(mapGeminiFinishReason("MAX_TOKENS"), "length");
	for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL", "OTHER"]) {
		assert.equal(mapGeminiFinishReason(reason), "stop");
	}
	assert.equal(parseGeminiResponse({ candidates: [{ finishReason: "SAFETY" }], usageMetadata: {} }).rawStopReason, "SAFETY");
	assert.equal(parseGeminiResponse({ candidates: [{ finishReason: "SAFETY" }, { content: { parts: [{ text: "ignored" }] }, finishReason: "STOP" }], usageMetadata: {} }).text, "");
});

test("redacts API keys from upstream errors", async () => {
	const body = JSON.stringify({ error: { message: "bad secret-key request" } });
	const result = await stream(model, context([{ role: "user", content: "hello", timestamp: 1 }]), {
		apiKey: "secret-key",
		fetch: async () => new Response(body, { status: 400 }),
	}).result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /bad \[REDACTED\] request/);
	assert.equal((result.errorMessage ?? "").includes("secret-key"), false);
});
