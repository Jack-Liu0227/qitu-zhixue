import type {
	Api,
	AssistantMessage,
	ImageContent,
	JsonObject,
	Message,
	Model,
	ProviderStreams,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	Tool,
	ToolCall,
	TranscriptContext,
	Usage,
} from "./pi/types.js";
import { AssistantMessageEventStream } from "./pi/utils/event-stream.js";
import { contentText, getSystemMessageText } from "./pi/utils/text.js";
import { getCurrentTools } from "./pi/utils/transcript.js";

export interface GeminiPart {
	text?: string;
	inlineData?: { mimeType: string; data: string };
	functionCall?: { name: string; args: JsonObject };
	functionResponse?: { name: string; response: JsonObject };
}

export interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

export interface GeminiRequestBody {
	contents: GeminiContent[];
	systemInstruction?: { parts: Array<{ text: string }> };
	generationConfig?: { maxOutputTokens?: number; temperature?: number };
	tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: unknown }> }>;
}

export interface GeminiToolCall {
	id: string;
	name: string;
	arguments: JsonObject;
}

export interface ParsedGeminiResponse {
	text: string;
	toolCalls: GeminiToolCall[];
	usage: Usage | null;
	stopReason: StopReason | null;
	rawStopReason?: string;
}

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function normalizeGeminiRoot(baseUrl: string): string {
	const url = new URL(baseUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid Gemini base URL");
	if (url.username || url.password || url.search || url.hash) throw new Error("Invalid Gemini base URL");
	let pathname = url.pathname.replace(/\/+$/, "");
	let changed = true;
	while (changed) {
		changed = false;
		for (const suffix of ["/v1beta", "/v1", "/models"]) {
			if (pathname.toLowerCase().endsWith(suffix)) {
				pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, "");
				changed = true;
				break;
			}
		}
	}
	url.pathname = pathname;
	return url.toString().replace(/\/$/, "");
}

function textParts(content: string | readonly (TextContent | ImageContent)[]): GeminiPart[] {
	if (typeof content === "string") return content.length > 0 ? [{ text: content }] : [];
	return content.flatMap((part): GeminiPart[] => {
		if (part.type === "text") return part.text.length > 0 ? [{ text: part.text }] : [];
		return part.data.length > 0 && part.mimeType.length > 0
			? [{ inlineData: { mimeType: part.mimeType, data: part.data } }]
			: [];
	});
}

function messageParts(message: Message): GeminiPart[] {
	if (message.role === "system") return textParts(message.content);
	if (message.role === "user") return textParts(message.content);
	if (message.role === "toolResult") {
		const text = contentText(message.content);
		return [{ functionResponse: {
			name: message.toolName,
			response: message.isError ? { error: text } : { content: text },
		} }];
	}
	return message.content.flatMap((part): GeminiPart[] => {
		if (part.type === "text") return part.text.length > 0 ? [{ text: part.text }] : [];
		if (part.type === "toolCall") return [{ functionCall: { name: part.name, args: part.arguments } }];
		return [];
	});
}

export function toGeminiContents(messages: readonly Message[]): GeminiContent[] {
	return messages.flatMap((message): GeminiContent[] => {
		if (message.role === "system") return [];
		const parts = messageParts(message);
		if (parts.length === 0) return [];
		return [{ role: message.role === "assistant" ? "model" : "user", parts }];
	});
}

function toGeminiSystemInstruction(messages: readonly Message[]): GeminiRequestBody["systemInstruction"] {
	const text = messages
		.filter((message) => message.role === "system")
		.map((message) => getSystemMessageText(message))
		.filter((value) => value.length > 0)
		.join("\n\n");
	return text.length > 0 ? { parts: [{ text }] } : undefined;
}

function toGeminiTools(tools: readonly Tool[]): GeminiRequestBody["tools"] {
	if (tools.length === 0) return undefined;
	return [{ functionDeclarations: tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	})) }];
}

export function buildGeminiRequestBody(
	context: TranscriptContext | { messages: readonly Message[] },
	options: Pick<StreamOptions, "temperature" | "maxTokens"> = {},
): GeminiRequestBody {
	const messages = context.messages;
	const body: GeminiRequestBody = {
		contents: toGeminiContents(messages),
	};
	const systemInstruction = toGeminiSystemInstruction(messages);
	if (systemInstruction) body.systemInstruction = systemInstruction;
	const tools = toGeminiTools(getCurrentTools(messages));
	if (tools) body.tools = tools;
	if (options.temperature !== undefined || options.maxTokens !== undefined) {
		body.generationConfig = {};
		if (options.maxTokens !== undefined) body.generationConfig.maxOutputTokens = options.maxTokens;
		if (options.temperature !== undefined) body.generationConfig.temperature = options.temperature;
	}
	return body;
}

export function mapGeminiFinishReason(reason: unknown): StopReason | null {
	if (typeof reason !== "string") return null;
	return reason === "MAX_TOKENS" ? "length" : "stop";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown): JsonObject {
	return isObject(value) ? value as JsonObject : {};
}

function parseUsage(value: unknown): Usage | null {
	if (!isObject(value)) return null;
	const input = value.promptTokenCount;
	const output = value.candidatesTokenCount;
	const total = value.totalTokenCount;
	if (![input, output, total].every((entry) => entry === undefined || (typeof entry === "number" && Number.isFinite(entry)))) {
		throw new Error("Invalid Gemini usage metadata");
	}
	if (input === undefined && output === undefined && total === undefined) return null;
	const usage = structuredClone(EMPTY_USAGE);
	usage.input = typeof input === "number" ? input : 0;
	usage.output = typeof output === "number" ? output : 0;
	usage.totalTokens = typeof total === "number" ? total : usage.input + usage.output;
	return usage;
}

export function parseGeminiResponse(value: unknown): ParsedGeminiResponse {
	if (!isObject(value) || !Array.isArray(value.candidates) || value.candidates.length === 0) throw new Error("Invalid Gemini response");
	const candidate = value.candidates[0];
	if (!isObject(candidate)) throw new Error("Invalid Gemini candidate");
	let text = "";
	const toolCalls: GeminiToolCall[] = [];
	if (candidate.content !== undefined) {
		if (!isObject(candidate.content) || !Array.isArray(candidate.content.parts)) throw new Error("Invalid Gemini content");
		for (const part of candidate.content.parts) {
			if (!isObject(part)) throw new Error("Invalid Gemini part");
			if (part.text !== undefined) {
				if (typeof part.text !== "string") throw new Error("Invalid Gemini text part");
				text += part.text;
			}
			if (part.functionCall !== undefined) {
				if (!isObject(part.functionCall) || typeof part.functionCall.name !== "string") {
					throw new Error("Invalid Gemini function call");
				}
				const functionCall = part.functionCall;
				const name = functionCall.name as string;
				const callId = typeof functionCall.id === "string" && functionCall.id.length > 0
					? functionCall.id
					: `${name}${toolCalls.length}`;
				toolCalls.push({
					id: callId,
					name,
					arguments: jsonObject(functionCall.args),
				});
			}
		}
	}
	const rawStopReason = typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;
	return {
		text,
		toolCalls,
		usage: parseUsage(value.usageMetadata),
		stopReason: mapGeminiFinishReason(rawStopReason),
		...(rawStopReason ? { rawStopReason } : {}),
	};
}

export function parseGeminiSseData(data: string): ParsedGeminiResponse {
	try {
		return parseGeminiResponse(JSON.parse(data) as unknown);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : "Invalid Gemini SSE event");
	}
}

/** Parse complete SSE text, useful for deterministic adapter tests. */
export function parseGeminiSseEvents(input: string): ParsedGeminiResponse[] {
	const events: ParsedGeminiResponse[] = [];
	let data: string[] = [];
	const flush = () => {
		if (data.length > 0) events.push(parseGeminiSseData(data.join("\n")));
		data = [];
	};
	for (const line of input.split(/\r?\n/)) {
		if (line === "") flush();
		else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
	}
	flush();
	return events;
}

function emptyAssistant(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
		usage: structuredClone(EMPTY_USAGE), stopReason: "pending", timestamp: Date.now(),
	};
}

function sanitizeErrorMessage(message: string, apiKey?: string): string {
	let safe = message.replace(/([?&]key=)[^&\s]*/gi, "$1[REDACTED]");
	if (apiKey) safe = safe.split(apiKey).join("[REDACTED]");
	return safe;
}

function errorMessageFromBody(body: string, status: number, apiKey?: string): string {
	try {
		const parsed = JSON.parse(body) as unknown;
		const message = isObject(parsed) && isObject(parsed.error) && typeof parsed.error.message === "string"
			? parsed.error.message
			: `Gemini API request failed with status ${status}`;
		return sanitizeErrorMessage(message, apiKey);
	} catch {
		return `Gemini API request failed with status ${status}`;
	}
}

function requestHeaders(options: StreamOptions, apiKey: string): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (value === null || /^(authorization|x-api-key|api-key|cf-aig-authorization)$/i.test(name)) continue;
		headers.set(name, value);
	}
	headers.set("content-type", "application/json");
	headers.set("x-goog-api-key", apiKey);
	return headers;
}

function requestSignal(options: StreamOptions): AbortSignal | undefined {
	if (options.timeoutMs === undefined) return options.signal;
	const timeout = AbortSignal.timeout(options.timeoutMs);
	return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

async function postGemini(
	model: Model<Api>,
	context: TranscriptContext,
	options: StreamOptions,
	streaming: boolean,
): Promise<Response> {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const root = normalizeGeminiRoot(model.baseUrl);
	const action = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
	const url = `${root}/v1beta/models/${encodeURIComponent(model.id)}:${action}`;
	const response = await (options.fetch ?? globalThis.fetch)(url, {
		method: "POST",
		headers: requestHeaders(options, apiKey),
		body: JSON.stringify(buildGeminiRequestBody(context, options)),
		signal: requestSignal(options),
	});
	return response;
}

interface SseEvent { data: string; }

async function* iterateGeminiSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let data: string[] = [];
	const flush = (): SseEvent | undefined => {
		if (data.length === 0) return undefined;
		const event = { data: data.join("\n") };
		data = [];
		return event;
	};
	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let index = buffer.search(/[\r\n]/);
			while (index >= 0) {
				const line = buffer.slice(0, index);
				let next = index + 1;
				if (buffer[index] === "\r" && buffer[next] === "\n") next++;
				buffer = buffer.slice(next);
				if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
				else if (line === "") {
					const event = flush();
					if (event) yield event;
				}
				index = buffer.search(/[\r\n]/);
			}
		}
		buffer += decoder.decode();
		if (buffer.length > 0 && buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
		const event = flush();
		if (event) yield event;
	} finally {
		reader.releaseLock();
	}
}

function appendText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string, block: TextContent | null): TextContent | null {
	if (!text) return block;
	const next = block ?? { type: "text", text: "" };
	if (!block) {
		output.content.push(next);
		stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
	}
	next.text += text;
	stream.push({ type: "text_delta", contentIndex: output.content.indexOf(next), delta: text, partial: output });
	return next;
}

const mergeArgs = (previous: JsonObject, next: JsonObject): JsonObject => ({ ...previous, ...next });

function runGeminiStream(
	model: Model<Api>,
	context: TranscriptContext,
	options: StreamOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const output = emptyAssistant(model);
	(async () => {
		let textBlock: TextContent | null = null;
		const toolBlocks = new Map<string, { call: ToolCall; argsText: string; contentIndex: number }>();
		try {
			const response = await postGemini(model, context, options, true);
			if (!response.ok) {
				const body = await response.text();
				throw new Error(errorMessageFromBody(body, response.status, options.apiKey));
			}
			if (!response.body) throw new Error("Gemini response has no body");
			output.stopReason = "pending";
			stream.push({ type: "start", partial: output });
			let finishReason: string | undefined;
			for await (const event of iterateGeminiSse(response.body, requestSignal(options))) {
				const parsed = parseGeminiSseData(event.data);
				if (parsed.usage) output.usage = parsed.usage;
				textBlock = appendText(stream, output, parsed.text, textBlock);
				if (parsed.rawStopReason) {
					output.rawStopReason = parsed.rawStopReason;
					output.stopReason = parsed.stopReason ?? "stop";
				}
				for (const [index, tool] of parsed.toolCalls.entries()) {
					const key = `${tool.name}:${index}`;
					let block = toolBlocks.get(key);
					if (!block) {
						const call: ToolCall = { type: "toolCall", id: tool.id, name: tool.name, arguments: tool.arguments };
						block = { call, argsText: "", contentIndex: output.content.length };
						toolBlocks.set(key, block);
						output.content.push(call);
						stream.push({ type: "toolcall_start", contentIndex: block.contentIndex, partial: output });
					}
					const merged = mergeArgs(block.call.arguments, tool.arguments);
					const nextText = JSON.stringify(merged);
					const delta = nextText.startsWith(block.argsText) ? nextText.slice(block.argsText.length) : nextText;
					block.call.arguments = merged;
					block.argsText = nextText;
					if (delta) stream.push({ type: "toolcall_delta", contentIndex: block.contentIndex, delta, partial: output });
				}
			}
			if (options.signal?.aborted) throw new Error("Request was aborted");
			for (const block of toolBlocks.values()) stream.push({ type: "toolcall_end", contentIndex: block.contentIndex, toolCall: block.call, partial: output });
			if (output.stopReason === "pending") output.stopReason = toolBlocks.size > 0 ? "toolUse" : "stop";
			if (output.content.length === 0 && output.stopReason === "stop") throw new Error("Gemini returned an empty response");
			if (textBlock) stream.push({ type: "text_end", contentIndex: output.content.indexOf(textBlock), content: textBlock.text, partial: output });
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end(output);
		} catch (error) {
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error), options.apiKey);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end(output);
		}
	})();
	return stream;
}

export const stream: StreamFunction<Api> = (model, context, options) => {
	return runGeminiStream(model, context, options ?? {});
};

export const streamSimple: StreamFunction<Api, SimpleStreamOptions> = (model, context, options) => {
	return runGeminiStream(model, context, options ?? {});
};

export async function completeGemini(
	model: Model<Api>,
	context: TranscriptContext,
	options: StreamOptions = {},
): Promise<ParsedGeminiResponse> {
	const response = await postGemini(model, context, options, false);
	if (!response.ok) return Promise.reject(new Error(errorMessageFromBody(await response.text(), response.status, options.apiKey)));
	return parseGeminiResponse(await response.json() as unknown);
}

export function googleGeminiApi(): ProviderStreams {
	return { stream, streamSimple };
}
