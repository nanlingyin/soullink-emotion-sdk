# @soullink-emotion/runtime-core

Headless orchestration for Soullink Emotion sessions. It connects the emotion
engine to replaceable message classifiers, planners, TTS clients, audio sinks,
clocks, and renderer callbacks without requiring a UI framework.

## Install

```bash
npm install @soullink-emotion/engine @soullink-emotion/runtime-core
```

## Minimal Session

```ts
import { loadModelProfile } from "@soullink-emotion/engine";
import {
  createManualClock,
  createSoullinkSession
} from "@soullink-emotion/runtime-core";

const { profile } = await loadModelProfile("/models/avatar/soullink.profile.json");
const clock = createManualClock();

const session = createSoullinkSession({
  profile,
  clock,
  persona: {
    name: "Ava",
    profile: "Warm, attentive, and concise."
  }
});

session.start();
await session.sendMessage("Hello");
clock.tick(1 / 60, 1 / 60);
```

Inject planner, classifier, TTS, and audio ports only when those services are
needed. Without them, the session retains the engine's local emotion fallback.

The package is ESM-only and requires Node.js 18 or a modern browser toolchain.
