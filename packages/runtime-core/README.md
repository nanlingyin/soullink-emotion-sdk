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

Inject the provider ports independently. `textModel` handles replies and
reaction intent, `voiceModel` handles TTS, and `motionPlanner` handles
speaking parameter plans such as JEV. This keeps credentials and provider
choices in the host application:

```ts
const session = createSoullinkSession({
  profile,
  persona,
  textModel: myTextModel,
  voiceModel: myVoiceModel,
  motionPlanner: myJevPlanner,
  audio: myAudioSink
});
```

The three provider ports are public TypeScript contracts. A text provider
returns a `SoullinkExternalPlan`, a voice provider returns an audio URL or
bytes plus its duration, and a JEV adapter returns parameter keyframes. They
can point to three different services and none of them receives credentials
from the SDK:

```ts
import type {
  MotionPlannerClient,
  SpeakingMotionInput,
  TextModelClient,
  VoiceModelClient
} from "@soullink-emotion/runtime-core";

const textModel: TextModelClient = {
  planReaction: (input) => dialogueService.planReaction(input)
};

const voiceModel: VoiceModelClient = {
  synthesize: async (text, context) => {
    const clip = await voiceService.synthesize({ text, context });
    return { bytes: clip.bytes, durationSec: clip.durationSec };
  }
};

const motionPlanner: MotionPlannerClient = {
  async planSpeakingMotion(input: SpeakingMotionInput) {
    const frames = await jevService.plan({
      text: input.speechText,
      durationSec: input.durationSec,
      parameters: input.availableParameters,
      emotion: input.intent,
      vad: input.vad
    });
    return { provider: "jev", parameterPlan: frames };
  }
};
```

`motionPlanner` is independent from `textModel`: use it for JEV, a local
planner, or your own backend. The runtime passes CDI/Profile-derived parameter
IDs and ranges through `availableParameters`, then applies the returned beats
with its normal smoothing and LipSync ownership rules. Set
`speakingMotionScheduling.mode` to `"fixed-parallel"` to plan JEV while TTS is
running, or to `"duration"` when the real audio duration should determine the
frame count.

The older `planner` and `tts` options remain supported. Without injected
providers, the session retains the engine's local emotion fallback.

The package is ESM-only and requires Node.js 18 or a modern browser toolchain.
