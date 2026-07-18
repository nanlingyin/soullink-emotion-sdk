# @soullink-emotion/api-client

Typed HTTP client and `@soullink-emotion/runtime-core` adapters for a deployed
Soullink Emotion API. The package works in browsers and Node.js 18+ and accepts an
injected `fetch` implementation for other runtimes and tests.

## Install

```bash
npm install @soullink-emotion/api-client @soullink-emotion/engine @soullink-emotion/runtime-core
```

## HTTP client

```ts
import { createSoullinkApiClient } from "@soullink-emotion/api-client";

const api = createSoullinkApiClient({
  baseURL: "https://soullink-api.example.com",
  token: () => sessionStorage.getItem("soullink-token") ?? undefined,
  timeouts: {
    llm: 60_000,
    tts: 900_000,
    modelUpload: 300_000
  }
});

const plan = await api.planReaction({
  message: "今天终于成功了",
  characterName: "Amane"
});

const profile = await api.ensureAutoProfile({
  modelDir: "my-model",
  force: true
});
```

The client covers reaction, reflection, proactive messages, speaking-motion
planning, embedding classification and configuration, profile generation and
calibration, model listing/upload, and VoxCPM2/CosyVoice2 synthesis. A bearer
token is resolved at request time, so applications can rotate credentials
without rebuilding the client.

## Runtime adapters

```ts
import {
  createEmbeddingClassifierAdapter,
  createPlannerAdapter,
  createTtsAdapter
} from "@soullink-emotion/api-client";
import { createSoullinkSession } from "@soullink-emotion/runtime-core";

const getOpenAI = () => ({ model: "gpt-4.1-mini" });

const session = createSoullinkSession({
  profile,
  persona,
  planner: createPlannerAdapter({ client: api, getOpenAI }),
  classifier: createEmbeddingClassifierAdapter({ client: api, getOpenAI }),
  tts: createTtsAdapter({
    client: api,
    getProvider: () => "voxcpm2"
  })
});
```

The environment-neutral TTS adapter returns `ArrayBuffer` audio. In a browser,
use the optional helper to create an object URL and probe the real clip length:

```ts
import { createBrowserTtsAdapter } from "@soullink-emotion/api-client/browser";

const tts = createBrowserTtsAdapter({
  client: api,
  getProvider: () => "cosyvoice2",
  getOpenAI
});
```

Do not put upstream provider secrets in public browser bundles. Prefer server
configuration or send short-lived credentials to a trusted Soullink API.
