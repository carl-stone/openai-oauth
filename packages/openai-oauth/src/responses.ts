import {
	adaptCodexResponsesBody,
	collectCompletedResponseFromSse,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { emitRequestLog } from "./logging.js"
import { copyUpstreamResponse, isRecord, toErrorResponse } from "./shared.js"
import type {
	OpenAIOAuthResponsesStateMode,
	OpenAIOAuthServerLogEvent,
	UsageLike,
} from "./types.js"

const usesServerReplayState = (body: Record<string, unknown>): boolean =>
	typeof body.previous_response_id === "string" ||
	(Array.isArray(body.input) &&
		body.input.some(
			(item) =>
				isRecord(item) &&
				item.type === "item_reference" &&
				typeof item.id === "string",
		))

export const handleResponsesRequest = async (
	request: Request,
	client: OpenAIOAuthTransport,
	responsesState: OpenAIOAuthResponsesStateMode,
	requestLogger?: (event: OpenAIOAuthServerLogEvent) => void,
): Promise<Response> => {
	const startedAt = Date.now()
	const requestId = crypto.randomUUID()
	let body: unknown
	try {
		body = await request.json()
	} catch {
		return toErrorResponse("Request body must be valid JSON.")
	}
	if (!isRecord(body)) {
		return toErrorResponse("Request body must be a JSON object.")
	}

	if (responsesState === "stateless" && usesServerReplayState(body)) {
		return toErrorResponse(
			"Stateless Codex responses endpoint does not support `previous_response_id` or `item_reference`. Replay the full conversation history in `input` on each request.",
		)
	}

	const adapted = adaptCodexResponsesBody(body, {
		allowLocalReplayFields: true,
	})
	const model =
		typeof adapted.body.model === "string" ? adapted.body.model : undefined
	const stream = adapted.body.stream === true
	emitRequestLog(requestLogger, {
		type: "responses_request",
		adapterVersion: adapted.version,
		model,
		path: "/v1/responses",
		promptCacheBreakpointCount: adapted.promptCacheBreakpointCount,
		removedFieldPaths: adapted.removedFieldPaths,
		requestId,
		stream,
		toolCount: Array.isArray(adapted.body.tools)
			? adapted.body.tools.length
			: 0,
	})

	try {
		const upstream = await client.request("/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(adapted.body),
			signal: request.signal,
		})
		observeResponsesResponse(
			upstream,
			{ requestId, startedAt, stream },
			requestLogger,
		)
		return copyUpstreamResponse(upstream)
	} catch (error) {
		emitRequestLog(requestLogger, {
			type: "responses_error",
			durationMs: Date.now() - startedAt,
			path: "/v1/responses",
			requestId,
			status: 0,
		})
		throw error
	}
}

const toUsageLike = (response: unknown): UsageLike => {
	if (!isRecord(response) || !isRecord(response.usage)) {
		return {}
	}
	const usage = response.usage
	const inputDetails = isRecord(usage.input_tokens_details)
		? usage.input_tokens_details
		: undefined
	const outputDetails = isRecord(usage.output_tokens_details)
		? usage.output_tokens_details
		: undefined
	return {
		inputTokens:
			typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
		outputTokens:
			typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
		totalTokens:
			typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
		cachedInputTokens:
			typeof inputDetails?.cached_tokens === "number"
				? inputDetails.cached_tokens
				: undefined,
		reasoningTokens:
			typeof outputDetails?.reasoning_tokens === "number"
				? outputDetails.reasoning_tokens
				: undefined,
	}
}

const observeResponsesResponse = (
	response: Response,
	request: { requestId: string; startedAt: number; stream: boolean },
	requestLogger?: (event: OpenAIOAuthServerLogEvent) => void,
): void => {
	if (!requestLogger) {
		return
	}
	const observed = response.clone()
	void (async () => {
		let usage: UsageLike = {}
		try {
			const contentType = observed.headers.get("content-type") ?? ""
			const completed = contentType.includes("text/event-stream")
				? observed.body
					? await collectCompletedResponseFromSse(observed.body)
					: undefined
				: await observed.json()
			usage = toUsageLike(completed)
		} catch {}
		emitRequestLog(requestLogger, {
			type: "responses_response",
			durationMs: Date.now() - request.startedAt,
			path: "/v1/responses",
			requestId: request.requestId,
			status: response.status,
			stream: request.stream,
			usage,
		})
	})()
}
