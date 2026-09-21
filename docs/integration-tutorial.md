# Soullink Emotion SDK 接入教程

这份教程面向要把 Soullink Emotion 接入桌宠、Live2D 网页应用或 AI 角色产品的开发者。示例使用 TypeScript 和 ESM，重点说明三类外部模型如何分别接入：对话模型、语音模型和 JEV/动作模型。

SDK 不内置厂商密钥，也不要求三类模型来自同一个服务。浏览器可以只调用自己的后端适配层，Node 服务也可以直接注入 provider。

## 1. 整体数据流

```text
用户消息
  |
  +--> TextModelClient.planReaction()
  |       回复、EmotionIntent、VAD 目标和可选动作计划
  |
  +--> runtime-core / engine 更新情绪、FACS、Idle 和反应层
          |
          +--> VoiceModelClient.synthesize()
          |       音频和可选 durationSec
          |
          +--> MotionPlannerClient.planSpeakingMotion()
                  CDI/Profile 参数 + 语音上下文
                  JEV 参数关键帧
                          |
                          v
                  engine 逐帧混合与平滑
                          |
                          v
                  Live2DRenderer.setParameters()
```

| 层 | 主要职责 | 典型来源 |
| --- | --- | --- |
| VAD/FACS | 连续情绪、基础表情和自然回落 | engine、对话模型 |
| Idle | 呼吸、眨眼、注视和微小身体运动 | engine |
| LipSync | 嘴部开合和音量响应 | 音频分析器、engine |
| JEV 参数计划 | 头部、身体、视线、眉眼、嘴型和模型私有效果 | JEV 或其他动作模型 |
| 原生动画 | `.exp3.json` 表情和 `.motion3.json` 动作 | Live2D 模型本身 |

JEV 输出参数目标值，不直接修改 Cubism Core。运行时在关键帧之间插值，所以未被 JEV 覆盖的 Idle 参数可以继续运动。

### 1.1 表情与动作的实际执行顺序

VAD 没有被 JEV 取代，它仍是连续情绪和基础表情的核心。每一帧的处理顺序是：

1. `MessageClassifier` 先产生即时 `EmotionIntent`，让角色无需等待大模型就能开始反应。
2. `TextModelClient.planReaction()` 返回回复、`vadTarget`、FACS/AU action plan 和可选参数计划，runtime 通过 `triggerPlan()` 接收。
3. `EmotionStateController` 更新连续 VAD；VAD mapper 将当前 VAD 转换为基础 FACS 表情。
4. engine 将 Idle、VAD 微动、VAD 手势、reaction、reflection、等待语音动作、LipSync 和 speech performance 混合为当前 FACS。
5. `ModelProfileAdapter` 把 FACS 和自定义通道映射成当前模型的真实 Cubism 参数。
6. `privateEmotionMap` 根据情绪/VAD 添加脸红、泪、阴影或模型私有效果。
7. JEV 的 `parameterPlan` 作为说话参数 overlay，只覆盖计划中出现的真实参数 ID；这些 ID 上以 JEV 为准。
8. `LayeredParameterMixer` 根据 `parameterSmoothing` 对最终目标逐帧平滑，然后由 renderer 写入 Cubism Core。

因此，JEV 负责“这段台词中做什么独特动作以及幅度多大”，VAD/FACS 负责持续的情绪底色，Idle 负责始终存在的生命感，LipSync 负责嘴部开合。新模型只要 Profile 和 CDI 参数信息足够完整，就可以复用同一条 pipeline。

## 2. 环境和安装

建议使用 Node.js 20.19+ 或 22.12+、npm 10+。所有官方包都是 ESM，应用的 `package.json` 建议包含：

```json
{ "type": "module" }
```

一次安装全部包：

```bash
npm install @soullink-emotion/sdk
```

生产项目通常只安装实际用到的包：

```bash
npm install @soullink-emotion/engine \
  @soullink-emotion/runtime-core \
  @soullink-emotion/api-client \
  @soullink-emotion/live2d-pixi \
  pixi.js@^7.4.3 pixi-live2d-display@0.5.0-beta
```

需要在 Node 端生成模型 Profile 时再安装：

```bash
npm install @soullink-emotion/profile-generator
```

## 3. 准备模型和 Profile

### 3.1 模型目录

可加载的模型目录至少应包含 `.model3.json`、它引用的 `.moc3` 和纹理文件。建议同时提供 `.cdi3.json`、`.exp3.json` 和 `.motion3.json`。浏览器必须通过 HTTP(S) 获取这些资源，例如：

```text
public/models/lilyabee/lilyabee.model3.json
public/models/lilyabee/lilyabee.cdi3.json
public/models/lilyabee/soullink.profile.json
```

不要把模型文件依赖到浏览器无法访问的本地磁盘路径，也不要把 API key 写入模型目录或 `VITE_*` 变量。

### 3.2 自动生成 Profile

仓库项目可以直接运行：

```bash
npm run profile:generate -- --model lilyabee
```

第三方 Node 项目可以编程生成。默认启发式扫描不需要 LLM：

```ts
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";

const generator = new Live2DProfileAutoGenerator({
  modelsRoot: "/srv/my-app/models",
  modelsBaseUrl: "/models",
  defaultModelDir: "lilyabee"
});

const result = await generator.ensure({
  modelDir: "lilyabee",
  displayName: "Lilyabee"
});

console.log(result.provider, result.coverage);
```

需要让 OpenAI-compatible 模型辅助判断模糊 CDI 名称时，在服务端注入客户端：

```ts
import { OpenAICompatibleClient } from "@soullink-emotion/planner-openai";
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";

const generator = new Live2DProfileAutoGenerator({
  modelsRoot: "/srv/my-app/models",
  modelsBaseUrl: "https://assets.example.com/models",
  client: new OpenAICompatibleClient({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL
  }),
  useConfiguredOpenAI: true
});

await generator.ensure({ modelDir: "lilyabee", force: false });
```

生成器会把目标 ID 限制在真实 CDI3 参数集合内。模糊的私有效果可以在校准工具中加入 `customParams` 或 `privateEmotionMap`，再用 `saveCalibratedProfile()` 保存。

### 3.3 加载 Profile

```ts
import { loadModelProfile } from "@soullink-emotion/engine";

const { profile } = await loadModelProfile(
  "/models/lilyabee/soullink.profile.json"
);
```

`loadModelProfile()` 会校验 schema。切换模型时应同时切换模型文件和 Profile。

## 4. 初始化 Live2D Renderer

Cubism Core 需要由应用根据 Live2D 授权条款自行提供。下面假设 `/live2dcubismcore.min.js` 是静态资源，`createScriptTagCubismLoader()` 会负责注入对应的 script：

```html
<div id="live2d-stage"></div>
```

```ts
import {
  Live2DRenderer,
  createScriptTagCubismLoader
} from "@soullink-emotion/live2d-pixi";

const stage = document.querySelector<HTMLElement>("#live2d-stage")!;
const renderer = new Live2DRenderer(stage, {
  cubismLoader: createScriptTagCubismLoader("/live2dcubismcore.min.js"),
  onMissingParameter: (id) => console.debug("Missing parameter", id)
});

const availableParameters = await renderer.load(profile.modelPath);
```

`availableParameters` 是以真实参数 ID 为 key 的 CDI/Core 元数据，包含 `min`、`max`、`default`、分组和本地化名称。它应直接传给 JEV 动作 provider。

```ts
renderer.setViewScale(1.05);
renderer.setViewOffset({ x: 0, y: 12 });
```

## 5. 只使用本地 engine（可选）

已有自己的消息循环、TTS 和渲染循环时，可以不使用 `runtime-core`：

```ts
import { SoullinkRuntime, motionStylePresets } from "@soullink-emotion/engine";

const runtime = new SoullinkRuntime({
  profile,
  motionStyle: { ...motionStylePresets.natural, seed: 20260921 }
});

runtime.sendMessage("今天辛苦了", 0);

function frame(now: number) {
  const snapshot = runtime.update(now / 1000, 1 / 60);
  renderer.setParameters(snapshot.live2dParams);
  renderer.applyNativeAnimation(snapshot.nativeAnimation);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

## 6. 用 runtime-core 编排三个 provider

### 6.1 Provider 接口

```ts
import type {
  TextModelClient,
  VoiceModelClient,
  MotionPlannerClient
} from "@soullink-emotion/runtime-core";
```

对话模型至少实现 `planReaction`：

```ts
const textModel: TextModelClient = {
  async planReaction(input) {
    return {
      intent: {
        emotion: "happy",
        variant: "bright_smile",
        intensity: 0.7,
        contextTags: ["normal_chat"],
        sourceMessage: input.message
      },
      vadTarget: { valence: 0.6, arousal: 0.35, dominance: 0.15 },
      replyDraft: "我听到了，今天也辛苦你了。",
      provider: "my-text-model"
    };
  }
};
```

`planProactive`、`planReflection` 和 `planSpeakingMotion` 都是可选方法。没有这些方法时，session 使用本地回退或不生成对应能力。

语音模型返回音频字节或 URL，最好同时返回真实时长：

```ts
const voiceModel: VoiceModelClient = {
  async synthesize(text, context) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, emotion: context.emotion, vad: context.vad })
    });
    if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
    return { bytes: await response.arrayBuffer() };
  }
};
```

JEV 或其他动作模型实现：

```ts
const motionPlanner: MotionPlannerClient = {
  async planSpeakingMotion(input) {
    const response = await fetch("/api/jev/motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(`JEV failed: ${response.status}`);
    return await response.json();
  }
};
```

浏览器只发送动作请求和模型元数据，JEV key 应由 `/api/jev/motion` 的可信服务端持有。

### 6.2 创建 session

```ts
import {
  createBrowserAudioSink,
  createSoullinkSession
} from "@soullink-emotion/runtime-core";

const session = createSoullinkSession({
  profile,
  persona: {
    name: "Lilyabee",
    profile: "温和、会根据对话自然改变语气和动作的虚拟角色。",
    variantByEmotion: {
      happy: "bright_smile",
      sad: "downcast",
      shy: "blush"
    },
    fallbacks: { neutral: "嗯，我在。" }
  },
  textModel,
  voiceModel,
  motionPlanner,
  audio: createBrowserAudioSink(),
  speakingMotionScheduling: {
    mode: "fixed-parallel",
    fixedFrameCount: 4,
    frameIntervalSec: 1
  },
  onSnapshot(snapshot) {
    if (snapshot.runtime) {
      renderer.setParameters(snapshot.runtime.live2dParams);
      renderer.applyNativeAnimation(snapshot.runtime.nativeAnimation);
    }
    updateChatUI(snapshot);
  }
});

// 把当前模型从 CDI3/Core 读取到的完整参数表交给 JEV。
session.setSpeakingMotionParameters(availableParameters);
session.start();
await session.sendMessage("你好，今天过得怎么样？");
```

`sendMessage()` 会触发即时情绪，然后异步执行回复、TTS、播放和说话动作。需要等待整条链路时：

```ts
await session.sendMessage("请完整处理这一轮", { awaitReply: true });
```

也可以直接播放外部系统生成的回复：

```ts
await session.speak({
  text: "这是一段由外部系统生成的回复。",
  emotion: "happy",
  planSpeakingMotion: true,
  userMessage: "用户刚刚夸了角色"
});
```

`userMessage` 会传给动作模型，便于 JEV 识别“挥手”“眨眼”“歪头”等显式动作。

## 7. 使用官方 HTTP adapters

如果已有可信的 Soullink API 服务，推荐使用 `api-client`：

```ts
import {
  createMotionPlannerAdapter,
  createPlannerAdapter,
  createSoullinkApiClient,
  createTtsAdapter
} from "@soullink-emotion/api-client";

const api = createSoullinkApiClient({
  baseURL: "/api/soullink",
  token: () => authStore.accessToken
});

const textModel = createPlannerAdapter({ client: api });
const voiceModel = createTtsAdapter({
  client: api,
  getProvider: () => "voxcpm2"
});
const motionPlanner = createMotionPlannerAdapter({ client: api });
```

默认服务端路径：

| 能力 | 路径 |
| --- | --- |
| 对话计划 | `/llm/reaction/plan` |
| JEV/说话动作计划 | `/llm/speaking-motion/plan` |
| TTS | `/tts/voxcpm2` 或 `/tts/cosyvoice2` |
| Embedding 分类 | `/reaction/classify-embedding` |

`createMotionPlannerAdapter()` 只暴露动作能力，适合对话模型和动作模型来自不同厂商的情况。

## 8. JEV 请求和返回格式

运行时会尽可能提供完整的模型能力信息：

```ts
interface SpeakingMotionInput {
  speechText: string;
  durationSec: number;
  mode?: "duration" | "fixed-parallel";
  frameCount?: number;
  frameIntervalSec?: number;
  availableParameters?: Record<string, {
    name?: string;
    groupId?: string;
    groupName?: string;
    min: number;
    max: number;
    default: number;
  }>;
  intent?: Partial<EmotionIntent>;
  vad?: Partial<VADVector>;
  expression?: {
    emotion?: string;
    variant?: string;
    intensity?: number;
    peakFACS?: PartialFACSLikeState;
  } | null;
  characterName: string;
  characterProfile: string;
  userMessage?: string;
}
```

`availableParameters` 优先来自 `Live2DRenderer.load()` 读取的 CDI3/Core 数据；渲染器尚未加载时，也会根据 Profile 构造参数。参数值必须使用真实 ID，并处于 `min..max` 范围。

返回值示例：

```json
{
  "provider": "jev",
  "parameterPlan": [
    {
      "time": 0,
      "duration": 0.8,
      "label": "gentle-nod",
      "parameters": {
        "ParamAngleX": 4,
        "ParamAngleY": -3,
        "ParamBodyAngleX": -2
      }
    },
    {
      "time": 0.8,
      "duration": 0.8,
      "label": "settle",
      "parameters": {
        "ParamAngleX": 0,
        "ParamAngleY": 1,
        "ParamBodyAngleX": 0
      }
    }
  ]
}
```

约束：

1. `time` 和 `duration` 以秒为单位，参数值是绝对目标值，不是增量。
2. 只返回模型真实存在的参数，后端必须再次校验 ID、数值和范围。
3. 嘴部开合参数（`MouthOpen`、`JawOpen` 等）由 LipSync 保留，JEV 不应覆盖。
4. `MouthForm`、smile、pucker、lip shape 等非开合嘴型仍可以交给 JEV。
5. 眨眼、挥手、抬手、歪头等显式动作应放进较早的关键帧；模型没有对应参数时由 Profile 降级。
6. 一个参数一旦出现在某帧，下一帧省略它会使 sequencer 将其缓动到 `0`；需要继续保持时，应在下一帧再次给出目标值。

动作模型不可用时返回空 `parameterPlan` 并设置 `provider: "vad-facs"`，运行时会继续使用 VAD/FACS 和 Idle，不会中断语音。

## 9. 并行规划和关键帧平滑

默认是 `fixed-parallel`：TTS 与 JEV 同时请求，先生成固定数量关键帧，降低首帧延迟：

```ts
speakingMotionScheduling: {
  mode: "fixed-parallel",
  fixedFrameCount: 4,
  frameIntervalSec: 1
}
```

需要根据真实音频时长决定帧数时使用 `duration`：

```ts
speakingMotionScheduling: {
  mode: "duration",
  frameIntervalSec: 0.8
}
```

如果 TTS 没有提供时长，runtime-core 会按文本长度估算有限范围内的时长。能从音频容器或服务端可靠计算时，建议返回 `durationSec`。

JEV 只生成稀疏目标帧，`ParameterPlanSequencer` 使用 `easeInOut` 在帧之间插值，`duration` 决定过渡时间；最终参数层还会执行逐帧平滑。二值参数的目标可以仍为 `0/1`，但应给予足够的 `duration`，运行时会生成中间值。

从未在整个 JEV 计划中出现的参数不会进入这层 overlay，因此 Idle 的呼吸、注视和微动仍然可以继续。已经由 JEV 控制过的参数若在下一帧省略，会缓动到 `0`；要保持或回到模型的非零中立值，应在后续帧显式重复目标值或写入 `default`。

```ts
session.setParameterGain(1.15);
session.setBodyMotionGain(1.0);
session.setVADDecayRate(0.85);
```

如果动作不明显，先检查 `parameterPlan` 是否包含目标参数和可见幅度，再适度增加参数增益；过大的增益会增加跨模型越界风险。

### 9.1 使用 planner-openai 的动作 planner

也可以在 Node 服务端直接使用 OpenAI-compatible planner：

```ts
import { SoullinkSpeakingMotionPlanner } from "@soullink-emotion/planner-openai";

const motionPlanner = new SoullinkSpeakingMotionPlanner(
  {
    apiKey: process.env.JEV_GATEWAY_KEY,
    baseURL: process.env.JEV_GATEWAY_URL,
    model: process.env.JEV_MODEL
  },
  {
    mode: "fixed-parallel",
    fixedFrameCount: 4,
    frameIntervalSec: 0.9,
    twoStage: true
  }
);

const result = await motionPlanner.plan({
  speechText: "我来给你挥挥手。",
  userMessage: "请挥手并轻轻歪头",
  durationSec: 3.2,
  availableParameters,
  characterName: persona.name,
  characterProfile: persona.profile
});
```

浏览器应用请使用 `createSpeakingMotionApiClient()` 调用可信后端，不要把 `openAI` 配置传到浏览器。

## 10. 渲染循环、口型和模型切换

session 的 `onSnapshot` 会在有意义的状态变化时触发；把最新的 runtime snapshot 交给 renderer：

```ts
const session = createSoullinkSession({
  profile,
  persona,
  textModel,
  voiceModel,
  motionPlanner,
  audio: createBrowserAudioSink(),
  onSnapshot(snapshot) {
    if (!snapshot.runtime) return;
    renderer.setParameters(snapshot.runtime.live2dParams);
    renderer.applyNativeAnimation(snapshot.runtime.nativeAnimation);
  }
});
```

`createBrowserAudioSink()` 会为 TTS 字节创建并回收 Blob URL；播放结束、出错或被新消息打断时会结束 playback promise。需要真实 RMS/peak 口型时，可以把 `AudioLevelAnalyzer` 实现传给 `audioLevelAnalyzer`。

切换模型时同时加载新模型和 Profile，并更新动作参数：

```ts
async function switchModel(modelUrl: string, profileUrl: string) {
  const { profile: nextProfile } = await loadModelProfile(profileUrl);
  const nextParameters = await renderer.load(modelUrl);
  session.stopVoice();
  session.setProfile(nextProfile);
  session.setSpeakingMotionParameters(nextParameters);
}
```

## 11. 错误降级和调试

```ts
onSnapshot(snapshot) {
  if (snapshot.apiError) console.warn(snapshot.apiError);
  if (snapshot.voiceStatus === "error") showVoiceFallback();

  const plan = snapshot.runtime?.plan;
  if (plan) {
    console.debug("plan", {
      provider: plan.provider,
      actionBeatCount: plan.actionBeatCount,
      parameterBeatCount: plan.parameterBeatCount
    });
  }
}
```

常见降级路径：

| 故障 | 行为 |
| --- | --- |
| 对话模型超时或 JSON 非法 | 本地分类器和角色 fallback 回复 |
| TTS 失败 | 文字回复仍保留，停止语音状态 |
| JEV 失败 | 空参数计划，继续 VAD/FACS、Idle 和 LipSync |
| 参数 ID 不存在 | renderer 跳过并可由 `onMissingParameter` 记录 |
| 没有 CDI3 | 使用 Profile 的映射和默认范围 |

保存动作日志时只记录模型、provider、帧数和参数 ID，不要保存密钥或完整用户隐私：

```ts
const debugRecord = {
  modelId: profile.modelId,
  provider: result.provider,
  frameCount: result.parameterPlan?.length ?? 0,
  parameterIds: [...new Set(
    (result.parameterPlan ?? []).flatMap((frame) => Object.keys(frame.parameters))
  )]
};
```

## 12. 安全和发布边界

1. 对话、TTS、JEV、Embedding 的密钥只放在可信后端环境变量或密钥管理服务中。
2. 浏览器只调用自己的后端；`createSpeakingMotionApiClient` 会移除请求中的 `openAI` 字段。
3. 后端接收动作计划后必须重新校验参数 ID、范围、帧数和 `duration`。
4. Live2D 模型、贴图和 Cubism Core 的授权由应用方负责，不属于 SDK 的 Apache-2.0 授权范围。
5. Profile 可以公开给浏览器，但不要写入 provider key、内部 URL 或用户隐私。

发布自己的 provider 包前运行：

```bash
npm run release:check
```

发布包应包含 `dist/`、`.d.ts`、README、许可证和 repository/bugs/homepage 元数据，不应包含 `.env`、私有模型、API key、调试日志和测试凭据。

## 13. 接入检查表

- [ ] 模型文件和 CDI3 可以通过 HTTP(S) 访问。
- [ ] 已生成并校验 `soullink.profile.json`。
- [ ] `availableParameters` 来自当前模型，而不是写死另一套模型的参数。
- [ ] 对话、语音、JEV 三个 provider 通过 `createSoullinkSession` 独立注入。
- [ ] JEV 只返回真实参数 ID 和合法范围内的绝对目标值。
- [ ] LipSync 使用嘴部开合参数，JEV 使用嘴型和其他非开合参数。
- [ ] 已测试 `fixed-parallel` 或 `duration` 的短音频和长音频行为。
- [ ] 已验证关键帧之间的缓动，以及未被 JEV 修改的 Idle 参数是否仍在运动。
- [ ] 对话、TTS 或 JEV 失败时角色仍能本地回退。
- [ ] 浏览器包中没有 provider 密钥、`.env` 或模型私有配置。
- [ ] 发布前通过 `npm run release:check`。

## 常见问题

### JEV 能否控制当前模型的所有参数？

可以把 CDI3 的参数元数据尽量完整地传给 JEV，但“能传给模型”不等于“每个参数都适合每一帧修改”。LipSync 开合参数、物理模拟结果和会破坏基础表情的参数需要由运行时保留。其余参数可以交给 JEV 选择，Profile 和后端校验负责跨模型安全。

### 为什么模型没有执行“挥手”？

参数计划只能修改真实存在的参数。如果挥手是 `.motion3.json` 原生动作，应让动作意图映射到 Profile 的 `motionMap`；如果模型只有手臂参数，则必须在 CDI3/Profile 中提供这些参数，JEV 才能生成手臂关键帧。

### 可以只接入 JEV，不接入对话模型吗？

可以。实现 `MotionPlannerClient`，调用 `session.speak()` 时传入 `text`、`emotion` 或 `intent`。没有 `textModel` 时，`sendMessage()` 仍可使用 engine 的本地分类和 fallback。
