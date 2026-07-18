# @soullink-emotion/profile-generator

Node.js SDK for building and validating `soullink.profile.json` from Live2D
`.model3.json`, `.cdi3.json`, `.exp3.json`, and `.motion3.json` files.

It provides deterministic Cubism-ID and CDI-name mapping first, with optional
OpenAI-compatible refinement. LLM output is validated against real CDI parameter
IDs before it can be persisted.

```ts
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";
import { OpenAICompatibleClient } from "@soullink-emotion/planner-openai";

const generator = new Live2DProfileAutoGenerator({
  modelsRoot: "/srv/soullink/models",
  modelsBaseUrl: "https://assets.example.com/models",
  client: new OpenAICompatibleClient({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL
  }),
  useConfiguredOpenAI: true
});

const result = await generator.ensure({
  modelDir: "my-model",
  force: false
});
```

The package never reads environment variables and never exposes an HTTP server.
The host owns authentication, upload policy, `modelsRoot`, and API keys. It is a
Node-only package because profile discovery and persistence use `node:fs`.

Set `useConfiguredOpenAI: false` (the default) for deterministic heuristic-only
generation. A request-level `openAI.apiKey` still explicitly enables refinement.
Use `saveCalibratedProfile()` to validate and persist manually edited mappings.

Generated profiles may include `privateEmotionMap`. These declarative rules map
arbitrary model-specific parameters to dominant emotions and/or VAD ranges, with
explicit active/neutral values, intensity, priority, and exclusive groups. The
generator recognizes high-confidence labels such as `困惑`, `生气`, `星星`,
face shadows, and surprise effects; optional LLM refinement handles ambiguous
labels. Every target is filtered against the actual CDI3 parameter set.
