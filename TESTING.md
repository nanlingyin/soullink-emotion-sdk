# Soullink Emotion package test workspace

This workspace contains the following cooperating packages:

- `@soullink-emotion/engine`: local message reactions, VAD emotion state and decay, FACS/action-unit expressions, idle motion, gaze, blink, breathing, lip sync, private emotion parameters, and final Live2D parameter values.
- `@soullink-emotion/runtime-core`: framework-neutral orchestration for replaceable planners, classifiers, TTS, audio, and clocks.
- `@soullink-emotion/live2d-pixi`: Cubism 4 rendering through PixiJS and `pixi-live2d-display`, including parameter metadata and native expression/motion playback.
- `@soullink-emotion/planner-openai`: OpenAI-compatible reaction, reflection, proactive-message, and speaking-motion planning.
- `@soullink-emotion/profile-generator`: Node-only generation and validation of `soullink.profile.json` from model3, CDI3, expression, and motion files.
- `@soullink-emotion/classifier-embedding`: embedding-based message classification with 48 built-in Chinese examples, cosine matching, custom examples, and a local rule fallback.
- `@soullink-emotion/api-client`: typed browser/Node client and runtime adapters for a separately deployed Soullink API.
- `@soullink-emotion/devtools-vue`: optional Vue calibration panel. It is present as a package but is not mounted by the current plain-JavaScript browser lab.

The browser page directly uses the engine and renderer and now uses `api-client` to reach a local Vite server bridge for optional LLM planning and embedding classification. It can switch among Blondegirl, Lilya Bee, Hiyori, and Shizuku from the header. Profile generation and the reusable AI smoke test run as separate Node commands. The runtime session and TTS path remain available for later integration but are not required to run the model lab.

## Install and run the local smoke test

From this directory:

```powershell
npm install
node .\test-engine.mjs
```

The smoke test uses Node's built-in assertion module and the compiled engine. It verifies:

1. Chinese text is classified into several emotions.
2. A model profile exposes expected capabilities and adaptation coverage.
3. A happy message changes VAD state and produces finite, changing Live2D parameters across 120 frames.

No LLM, embedding service, API server, TTS service, or provider credential is needed for this test.

## Run the configured AI smoke test

The local `api` file is parsed as follows:

1. First non-empty line: provider API key.
2. First later `http://` or `https://` line: OpenAI-compatible base URL.
3. Later `provider/model` lines: available model names.

The current defaults are `deepseek-ai/DeepSeek-V3.2` for chat planning and `Qwen/Qwen3-Embedding-0.6B` for embeddings. Override them without editing source code by setting `SOULLINK_LLM_MODEL` or `SOULLINK_EMBEDDING_MODEL` in the server environment.

```powershell
npm run ai:test
```

This performs real provider calls. It batches all 48 Chinese classifier examples, classifies a natural Chinese sentence, requests a structured reaction plan, then runs the two-stage speaking-motion planner for four semantic and parameter frames. It fails if the classifier does not initialize, either planner falls back, or the multi-frame result is incomplete. Its JSON output contains model names and results but never prints the API key.

## Generate all model profiles

Generate the Blondegirl, Lilya Bee, Hiyori, and Shizuku profiles before opening the browser lab:

```powershell
npm run profile:generate
```

This command runs `scripts/generate-profile.mjs --force`. To reuse the current profile when the model source signature has not changed, run:

```powershell
node .\scripts\generate-profile.mjs
```

The checked-in script uses deterministic heuristic generation with `useConfiguredOpenAI: false`. It reads each local model3, CDI3, exp3, and motion3 file and does not need an API key. Generate only one model with `node .\scripts\generate-profile.mjs --model bee --force` (also accepts `blondegirl`, `hiyori`, or `shizuku`). The generated profiles include:

- Standard eye-open/blink/smile, gaze, head, body, brow, mouth, and breath mappings.
- `blush` mapped to both `Param10` and `ParamCheek`.
- `tear` mapped to `Param9`.
- `privateEmotionMap.confusionEffect` mapped to `Param6` for `confused`.
- `privateEmotionMap.angerEffect` mapped to `Param8` for high-confidence anger reactions.
- `privateEmotionMap.starEffect` mapped to `Param7` for `excited`, `happy`, and `surprised`.
- Native expression bindings: `confused -> exp_01`, `shy -> exp_02`, `angry -> exp_03`, `excited -> exp_04`, and `sad -> exp_05`.
- The model's `Idle` motion catalog entry.
- Bee's six native expressions, semantic private effects, and sleep motion. Its extracted project directory is `l2d/bee-special` because the package generator accepts ASCII model directory names.
- Hiyori's 10 native motions and standard Cubism parameter mappings.
- Shizuku's four native motions and legacy uppercase `PARAM_*` mappings.

Ambiguous parameters such as `Param11` and `Param12` are intentionally not assigned a semantic role by the heuristic generator. They should be calibrated manually or refined on a trusted Node/server process with an OpenAI-compatible client. Generated and LLM-refined targets are validated against actual CDI parameter IDs before persistence.

## Run the browser model lab

```powershell
npm run dev
```

Open `http://127.0.0.1:4173/`. The page loads the generated profile first and falls back to its built-in profile only if that file cannot be loaded. It includes:

- Local, Embedding, and LLM message-reaction modes plus all 15 local emotion presets.
- Live provider/model status and the returned embedding intent or LLM reply.
- Two-stage multi-frame motion generation with fixed-frame and duration modes, editable frame interval, a generated timeline, and immediate playback.
- Editable Valence, Arousal, and Dominance targets.
- Emotion-decay rate.
- All 24 FACS channels as selective manual overrides.
- Native model expressions.
- Separate expression/parameter gain and body-motion gain controls.
- Natural, lively, calm, and shy local motion styles with spontaneous-action, VAD-gesture, gaze-stability, and idle-action controls.
- Dynamic native expression and motion controls from each selected model's generated catalog.
- Viewport controls and a live parameter inspector.

Local mode works without provider credentials. Embedding and LLM modes use `api-client` against the Vite-only `/api` bridge, which reads the provider credential on the Node side and invokes `classifier-embedding` or `planner-openai`. The development server must remain running; a production preview does not provide this test bridge. Cubism Core is loaded from the official Live2D HTTPS URL, so that script must also be reachable unless it is later hosted locally.

## Full integration configuration

Use this boundary when testing the optional networked features:

| Test path | Browser receives | Trusted Node/server receives | Required now for local lab |
| --- | --- | --- | --- |
| Local engine and Live2D rendering | Model/profile URLs only | Nothing | No external service |
| Heuristic profile generation | Generated JSON only | `modelsRoot`, `modelsBaseUrl`, `modelDir` | No credential |
| OpenAI-compatible reaction planning | Returned plan/reply only | Provider `baseURL`, `apiKey`, `model`, `timeoutMs` | Only for LLM mode |
| Multi-frame speaking motion | Semantic frames and validated parameter frames | Model parameter metadata plus provider configuration | Only when generating motion |
| Embedding classification | Returned intent only | Embedding `baseURL`, `apiKey`, `model`, `timeoutMs` | Only for Embedding mode |
| TTS and audio | Soullink API URL and optional short-lived token | TTS provider endpoint, credential, model/voice, response format | No |

### LLM planner

`@soullink-emotion/planner-openai` does not read environment variables itself. A trusted host must load its server-only configuration and pass it to the client. The minimum configuration is:

```text
baseURL
apiKey
model
```

Optional fields are `organization`, `project`, and `timeoutMs`. The same rule applies when enabling optional LLM refinement in `profile-generator`: run it in Node or behind an authenticated server endpoint, never in the public Vite bundle.

### Multi-frame speaking motion

The browser calls `SoullinkSpeakingMotionPlanner` through `/api/llm/speaking-motion/plan` and sends the 87 parameters returned by the loaded Blondegirl model. The planner excludes mouth/jaw opening parameters reserved for lip sync; the latest browser run therefore reported 86 usable parameters.

Two generation modes are available:

- `fixed-parallel`: generate an explicit frame count independently of audio, suitable for starting alongside TTS.
- `duration`: derive the frame count from `ceil(durationSec / frameIntervalSec)`, suitable after real audio duration is known.

With `twoStage: true`, the first provider request creates a coherent semantic action for every frame and the second translates those actions into parameter values validated against the model's actual min/max ranges. `ParameterPlanSequencer` interpolates between the generated frames on every render update. Mouth form, smile, gaze, head, body, and model-specific non-opening parameters remain eligible.

The current DeepSeek V3.2 test generated four frames at 0.75-second intervals in roughly 41-45 seconds. Provider latency varies, and two-stage mode normally requires two chat-completion requests.

### Embedding classifier

`@soullink-emotion/classifier-embedding` now provides the embedding path that was absent from the earlier package set. Its Qwen-compatible client calls an OpenAI-style `POST /embeddings` endpoint and needs `baseURL`, `apiKey`, `model`, and optionally `timeoutMs`/custom headers. It can fall back to local Chinese rules when the provider is unavailable.

The local bridge keeps one initialized 48-example classifier in Vite's Node process and persists example vectors under `output/cache/embeddings`, so page reloads and later Vite restarts do not repeat the initialization batch for the same provider/model. This lab uses a `0.61` cosine threshold; the package default is `0.65`. Direct browser calls are intentionally avoided because they would reveal the provider key and may require provider CORS support.

### Soullink API client and backend

`@soullink-emotion/api-client` is a client library, not an HTTP server. `scripts/ai-vite-plugin.mjs` implements only the endpoint subset required by this local lab: health/config, embedding classification, LLM reaction planning, and multi-frame speaking-motion planning. A production end-to-end deployment still needs a separately running backend for the complete reaction, profile, model, and TTS contracts. Configure a production browser with only:

```text
Soullink API baseURL
optional short-lived bearer token
```

The production backend must own provider credentials, model storage paths, upload policy, authentication, and CORS. The local Vite bridge is deliberately unauthenticated and bound to `127.0.0.1`; it is a test harness, not a deployable API service.

## Credential safety

Never place an LLM, embedding, or TTS provider API key in browser-delivered code such as:

- `src/`, `index.html`, or any imported browser module.
- A `VITE_*` environment variable; Vite intentionally exposes those values to browser code.
- A committed profile, test fixture, screenshot, or log.

For this local workspace, the user-provided root `api` file is read only by Node. The Vite plugin intercepts `/api` before static-file handling, so requesting that URL returns redacted service metadata rather than the file contents. This is suitable only for the local test setup; deployments should load secrets from a server environment or secret manager. Browser code should receive only a backend URL and, when required, a scoped short-lived application token.

## Remaining integration limits

- The Vite AI bridge covers only the browser lab's reaction, multi-frame motion, and embedding flows; the workspace still does not include a production Soullink HTTP server.
- `runtime-core` and `devtools-vue` are validated packages but are not mounted by the current plain-JavaScript page.
- The full voice path still needs a configured TTS backend and an `AudioSink`; returned audio must include a usable duration or decodable bytes.
- Final visual behavior remains model-specific. Automatic mappings should be reviewed with the browser parameter inspector and manually calibrated when a CDI name is ambiguous.
