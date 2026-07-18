# @soullink-emotion/planner-openai

OpenAI-compatible reaction, reflection, and Live2D speaking-motion planners.

The package does not read environment variables. Server applications must pass
credentials explicitly through `OpenAIClientOptions`.

`SoullinkSpeakingMotionPlanner` accepts `(clientOrOpenAIOptions, generationConfig)`.
The generation config exposes `mode`, `fixedFrameCount`, `frameIntervalSec`,
`minFrameCount`, `maxFrameCount`, and `twoStage`.

Use `mode: "fixed-parallel"` (alias `fixed`) to plan concurrently with TTS.
Use `mode: "duration"` after TTS to derive the frame count from
`ceil(durationSec / frameIntervalSec)`. Request-level `frameCount` and
`frameIntervalSec` override configured values.

When credentials, parameters, or LLM output are unavailable, speaking motion
returns `provider: "vad-facs"` and an empty `parameterPlan`. The runtime should
continue displaying its VAD/FACS expression; no local parameter animation is
generated.

Browser clients should use `createSpeakingMotionApiClient` to call a trusted
backend instead of holding an LLM key. The HTTP client deliberately strips the
`openAI` field before sending requests.

Only mouth/jaw opening parameters are reserved for LipSync. Mouth form, smile,
pucker, lip shape, phoneme shape, and other non-opening mouth details remain
eligible for generated keyframes.

For Node-side `.model3.json`/CDI3 scanning and `soullink.profile.json`
generation, use the companion `@soullink-emotion/profile-generator` package.
