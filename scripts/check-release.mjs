#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
// The fork publishes only the scoped OAuth package. Its workspace dependencies
// remain the upstream 2.0.0 packages and are not release targets here.
const packageDirs = ["packages/openai-oauth"]

const packages = packageDirs.map((directory) => ({
	directory,
	metadata: JSON.parse(
		readFileSync(join(root, directory, "package.json"), "utf8"),
	),
}))
const versions = new Set(packages.map(({ metadata }) => metadata.version))
if (versions.size !== 1) {
	throw new Error(
		`Publishable package versions differ: ${[...versions].join(", ")}`,
	)
}

const exportTargets = (value) =>
	typeof value === "string"
		? [value]
		: Object.values(value ?? {}).flatMap(exportTargets)

for (const { directory, metadata } of packages) {
	for (const file of [
		"README.md",
		"LICENSE",
		"NOTICE",
		...exportTargets(metadata.exports),
	]) {
		if (
			!file.startsWith("./dist") &&
			file !== "README.md" &&
			file !== "LICENSE" &&
			file !== "NOTICE"
		) {
			continue
		}
		if (!existsSync(join(root, directory, file))) {
			throw new Error(
				`${metadata.name} is missing ${file}. Run the build first.`,
			)
		}
	}
}

console.log(`Release packages are ready at ${[...versions][0]}.`)
