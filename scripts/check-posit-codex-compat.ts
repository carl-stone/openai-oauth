import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	CODEX_RESPONSES_ADAPTER_VERSION,
	CODEX_RESPONSES_REQUEST_FIELDS,
} from "../packages/core/src/runtime.js"

const positRoot =
	process.env.POSIT_ASSISTANT_ROOT ??
	path.join(os.homedir(), ".local", "share", "rstudio", "pai", "bin")

const readJson = async (filePath: string): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>

const fetchText = async (url: string): Promise<string> => {
	const response = await fetch(url, {
		headers: { "User-Agent": "posit-codex-gateway-compat-check" },
	})
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
	}
	return response.text()
}

const fetchJson = async (url: string): Promise<Record<string, unknown>> =>
	JSON.parse(await fetchText(url)) as Record<string, unknown>

const extractResponsesRequestFields = (source: string): string[] => {
	const body = source.match(
		/pub struct ResponsesApiRequest\s*\{([\s\S]*?)\n\}/,
	)?.[1]
	if (!body) {
		throw new Error(
			"Could not find ResponsesApiRequest in current Codex source.",
		)
	}
	return [...body.matchAll(/\bpub\s+(\w+):/g)]
		.map((match) => match[1])
		.filter((field): field is string => field !== undefined)
}

const main = async () => {
	const [positPackage, positProtocol, positBundle, head] = await Promise.all([
		readJson(path.join(positRoot, "package.json")),
		readJson(path.join(positRoot, "protocol.json")),
		readFile(path.join(positRoot, "dist", "server", "main.js"), "utf8"),
		fetchJson("https://api.github.com/repos/openai/codex/commits/main"),
	])
	const upstreamSha = typeof head.sha === "string" ? head.sha : undefined
	if (!upstreamSha) {
		throw new Error("GitHub did not return the current openai/codex main SHA.")
	}
	const source = await fetchText(
		`https://raw.githubusercontent.com/openai/codex/${upstreamSha}/codex-rs/codex-api/src/common.rs`,
	)
	const upstreamFields = extractResponsesRequestFields(source)
	const adapterFields = [...CODEX_RESPONSES_REQUEST_FIELDS]
	const missingFromAdapter = upstreamFields.filter(
		(field) => !adapterFields.includes(field as (typeof adapterFields)[number]),
	)
	const absentUpstream = adapterFields.filter(
		(field) => !upstreamFields.includes(field),
	)
	const compatible =
		missingFromAdapter.length === 0 && absentUpstream.length === 0

	console.log(
		JSON.stringify(
			{
				compatible,
				adapter: {
					version: CODEX_RESPONSES_ADAPTER_VERSION,
					fields: adapterFields,
					missingFromAdapter,
					absentUpstream,
				},
				codex: { upstreamSha, fields: upstreamFields },
				positAssistant: {
					version: positPackage.version,
					protocol: positProtocol.protocol,
					sendsPromptCacheOptions: positBundle.includes("promptCacheOptions"),
					sendsPromptCacheBreakpoints: positBundle.includes(
						"promptCacheBreakpoint",
					),
				},
			},
			null,
			2,
		),
	)
	if (!compatible) {
		process.exitCode = 1
	}
}

main().catch((error) => {
	console.error(
		error instanceof Error ? error.message : "Compatibility check failed.",
	)
	process.exitCode = 1
})
