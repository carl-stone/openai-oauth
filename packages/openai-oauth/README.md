# openai-oauth

[Docs](https://github.com/EvanZhouDev/openai-oauth#dev-proxy) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/openai-oauth)

Turn your ChatGPT account into an OpenAI-compatible local API.

```bash
> npx openai-oauth

OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
Available Models: gpt-5.6-sol, gpt-5.6-terra, gpt-image-2, ...

[d] Run in background  [q] Quit
```

Press `d` to keep it running in the background or `q` to quit. You can also manage it directly:

```bash
npx openai-oauth --detach
npx openai-oauth status
npx openai-oauth logs --follow
npx openai-oauth stop
```

## Package Notes

`openai-oauth` exposes an OpenAI-compatible local endpoint backed by your ChatGPT account.

Supported endpoints:

- `/v1/responses`
- `/v1/chat/completions`
- `/v1/images/generations`
- `/v1/images/edits`
- `/v1/models`

Image generation uses JSON requests. Image editing uses the standard OpenAI multipart request with one or more `image` fields. Both return base64 image data and usage metadata.

```bash
curl http://127.0.0.1:10531/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"A tiny house in a forest","quality":"low"}'
```

### Posit Assistant 0.9.8 in RStudio

Build and start the local endpoint on the port configured in RStudio:

```bash
bun run build
node packages/openai-oauth/dist/cli.js --port 10532
```

Use `http://127.0.0.1:10532/v1` as the OpenAI provider base URL. Posit Assistant 0.9.8 sends complete Responses history with `store: false`, so leave the gateway in its default `stateless` mode; do not add `--responses-state memory`.

GPT-5.6's public Responses API supports explicit prompt caching, but the ChatGPT Codex endpoint has a narrower request contract. The gateway preserves Posit's stable `prompt_cache_key` while removing `prompt_cache_options`, deprecated `prompt_cache_retention`, and nested `prompt_cache_breakpoint` markers. The resulting request uses the Codex endpoint's implicit cache behavior. Posit's cache-keepalive requests continue to reuse the stable key.

The adapter also removes other root or nested controls that the current Codex client cannot serialize. Opt-in request logs report only the model, removed field paths and counts, timing, status, and token usage; they never include prompts, tool inputs/results, credentials, headers, or reasoning content.

Before or after a Posit/Codex update, run the read-only compatibility check:

```bash
bun run check:posit-codex-compat
```

It reports the installed Posit Assistant version and protocol, fetches the current `openai/codex` main SHA, and fails if the gateway's Responses root-field contract has drifted. Set `POSIT_ASSISTANT_ROOT` only when the Assistant bundle is installed somewhere other than RStudio's default per-user location.

Common flags:

| Config | Flag | Default |
| --- | --- | --- |
| Host binding | `--host` | `127.0.0.1` |
| Port | `--port` | `10531` |
| Model allowlist | `--models` | Account-specific Codex models discovered from ChatGPT |
| Auth file path | `--oauth-file` | `$CODEX_HOME/auth.json` or `~/.codex/auth.json` |
| Responses continuation | `--responses-state` | `stateless` |
| Saved response lookup limit | `--responses-max-responses` | `256` |
| Saved response-item limit | `--responses-max-items` | `2000` |
| Open browser | `--open` / `--no-open` | `--open` |
| Login timeout | `--login-timeout-ms` | `300000` |

Binding `--host` beyond loopback exposes the proxy to your network. Anyone who can reach that port can make requests with your ChatGPT account.

Login listens on loopback and uses `http://localhost:1455/auth/callback`, the local callback URL accepted by OpenAI OAuth.

The CLI resolves the latest published Codex client version automatically. Advanced flags also exist for overriding it, the upstream Codex base URL, OAuth client id, and OAuth token URL.

### Responses continuation state

The server is stateless by default, so clients must send their full conversation history with every Responses request. Clients that continue with `previous_response_id` or `item_reference` can opt into the in-memory continuation state already provided by `@openai-oauth/core`:

```bash
npx openai-oauth --responses-state memory
```

Memory mode stores response inputs and outputs as shared history chains, plus saved response items, only in the server process. It defaults to 256 response lookup IDs and 2,000 items; use `--responses-max-responses` and `--responses-max-items` to change those positive-integer count limits. The limits do not cap bytes, and retained descendants keep their shared ancestors reachable. The cache does not persist across restarts, so references created by a previous process cannot be continued; start a new client conversation after restarting the server. The server still sends expanded full history upstream, where repeated prompt prefixes can remain eligible for upstream prompt caching.

The same mode is available programmatically through `responsesState: "memory"` on `createOpenAIOAuthFetchHandler()` and `startOpenAIOAuthServer()`. Set `responsesMaxResponses` and `responsesMaxItems` to configure the bounds.

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#readme)
