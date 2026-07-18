# Soullink Emotion SDK

Soullink Emotion 是一套面向 Live2D 数字角色的情绪表演 SDK。它把消息或外部事件转换为连续的 VAD 情绪状态、FACS/AU 表情、头部和身体动作、口型，以及模型最终能够消费的 Cubism 参数。

这套 SDK 不绑定聊天模型、Embedding 服务、TTS、UI 框架或后端实现。你可以只使用纯 TypeScript 表演引擎，也可以组合会话编排、OpenAI-compatible Planner、Embedding 分类、PIXI 渲染和 Vue 校准工具。

本文先带你运行当前测试项目，再从最小 engine 接入逐步扩展到完整会话、Embedding、Planner/TTS、Profile 生成和模型校准。

## 目录

- [先理解整体数据流](#先理解整体数据流)
- [核心概念](#核心概念)
- [环境要求](#环境要求)
- [包一览与安装选择](#包一览与安装选择)
- [运行当前测试项目](#运行当前测试项目)
- [教程一：只接入 engine 和 Live2D](#教程一只接入-engine-和-live2d)
- [情绪、VAD 与随机性](#情绪vad-与随机性)
- [动作风格配置](#动作风格配置)
- [教程二：使用 runtime-core 管理完整会话](#教程二使用-runtime-core-管理完整会话)
- [连接 Soullink API](#连接-soullink-api)
- [不使用 LLM：直接接入 Embedding 分类](#不使用-llm直接接入-embedding-分类)
- [Planner、TTS 与说话动作](#plannertts-与说话动作)
- [真实音量口型](#真实音量口型)
- [生成和理解 ModelProfile](#生成和理解-modelprofile)
- [Live2D 渲染与原生表情](#live2d-渲染与原生表情)
- [Vue 模型校准](#vue-模型校准)
- [降级行为](#降级行为)
- [常见问题](#常见问题)
- [生产接入检查表](#生产接入检查表)

## 先理解整体数据流

```text
用户消息 / 外部事件
        |
        +--> 本地规则分类 ------------------+
        +--> Embedding 分类（可选）----------+--> EmotionIntent
        +--> LLM Planner（可选）-------------+        |
                                                         v
                                                   VAD 情绪状态
                                                         |
                +----------------------------------------+
                |                                        |
                v                                        v
          FACS/AU 表情                         Idle / VAD / Speech 动作
                |                                        |
                +------------------+---------------------+
                                   v
                              MotionMixer
                                   |
                                   v
                           ModelProfile 参数映射
                                   |
                                   v
                         Record<CubismId, number>
                                   |
                                   v
                            Live2DRenderer
```

各层职责：

| 层 | 负责什么 | 是否需要网络 |
| --- | --- | --- |
| `classifier-embedding` | 从文本判断情绪、强度和连续 VAD | 查询新文本时通常需要 Embedding API |
| `planner-openai` | 生成回复、反思、主动消息或多帧说话动作 | 需要 OpenAI-compatible API |
| `runtime-core` | 编排消息、Planner、TTS、Audio、Clock 和 engine | 取决于你注入的端口 |
| `engine` | VAD、FACS、Idle、反应时序、口型和参数混合 | 不需要网络 |
| `profile-generator` | 扫描模型文件并生成参数映射 | 默认不需要；可选 LLM 精修 |
| `live2d-pixi` | 加载模型并把参数写入 Cubism Core | 只加载模型资源 |

## 核心概念

### EmotionIntent

`EmotionIntent` 是一次即时反应的语义输入：

```ts
interface EmotionIntent {
  emotion: string;
  variant?: string;
  naturalEmotion?: string;
  naturalVariant?: string;
  naturalVAD?: Partial<VADVector>;
  intensity: number;
  contextTags: string[];
  sourceMessage?: string;
}
```

常用字段：

| 字段 | 含义 |
| --- | --- |
| `emotion` | 引擎使用的主情绪，例如 `happy`、`sad`、`confused` |
| `variant` | 同一情绪内的表情变体，例如 `bright_smile`、`downcast` |
| `naturalVAD` | 分类器或 Planner 给出的连续 VAD；有它时比离散情绪更细腻 |
| `intensity` | `0..1` 的反应强度 |
| `contextTags` | 上下文修饰，例如 `compliment`、`question`、`user_tired` |

### VAD

VAD 用三个连续轴描述情绪，而不是只依赖一个标签：

| 轴 | `-1` 方向 | `+1` 方向 |
| --- | --- | --- |
| Valence | 消极、不愉快 | 积极、愉快 |
| Arousal | 平静、疲惫 | 兴奋、紧张、高能量 |
| Dominance | 退缩、顺从、不确定 | 自信、主动、强势 |

例如，`anger` 和 `anxiety` 都可能是负 Valence、高 Arousal，但前者通常 Dominance 较高，后者较低。这个差异会影响眉形、视线、身体前倾和动作力度。

### FACS、ModelProfile 与 RuntimeSnapshot

| 概念 | 作用 |
| --- | --- |
| FACS/AU | 与模型无关的表情语义，例如微笑、皱眉、眨眼、头部倾斜 |
| `ModelProfile` | 把 FACS 语义转换成某个模型真实的 Cubism 参数 ID 和范围 |
| `RuntimeSnapshot` | engine 每帧输出的完整状态，包括 VAD、FACS、Live2D 参数和原生动画指令 |

只要 `ModelProfile` 映射正确，同一套情绪和动作逻辑就可以复用于不同 Live2D 模型。

## 环境要求

- 所有 SDK 包都是 ESM，Node 项目应使用 `"type": "module"`、`.mjs`，或由支持 ESM 的构建工具处理。
- Node 端建议使用 Node.js 18 或更高版本，以获得内置 `fetch`、`AbortController` 和现代 Web API。
- 浏览器渲染需要现代浏览器、PIXI v7 和 `pixi-live2d-display` 0.5.0-beta。
- Cubism 4 Core 需要由集成方按照 Live2D 授权条款自行部署，SDK 不包含 Core 文件。
- 模型目录必须通过 HTTP(S) 提供，不能依赖浏览器直接读取本地文件路径。

几个只在特定环境使用的入口：

| 入口 | 用途 |
| --- | --- |
| `@soullink-emotion/api-client/browser` | 浏览器专用 TTS adapter 和对象 URL 处理 |
| `@soullink-emotion/classifier-embedding/node` | Node 文件向量缓存 |
| `@soullink-emotion/live2d-pixi/metadata` | 不加载 PIXI 渲染器，只读取模型/CDI 元数据 |
| `@soullink-emotion/devtools-vue/style.css` | Vue 校准面板样式 |

## 包一览与安装选择

| 包 | 用途 | 运行环境 |
| --- | --- | --- |
| `@soullink-emotion/engine` | VAD、FACS/AU、Idle 动作、反应时序、口型、参数混合 | Browser / Node |
| `@soullink-emotion/runtime-core` | 消息、Planner、TTS、Audio、Clock 和 engine 会话编排 | Browser / Node |
| `@soullink-emotion/planner-openai` | OpenAI-compatible 反应、反思、主动消息和说话动作规划 | Browser / Node，推荐服务端 |
| `@soullink-emotion/profile-generator` | 扫描模型文件，生成和保存 `soullink.profile.json` | Node >= 18 |
| `@soullink-emotion/classifier-embedding` | Embedding 情绪分类、1,400 条中文语料、缓存和规则降级 | Browser / Node >= 18 |
| `@soullink-emotion/api-client` | Soullink HTTP API 客户端和 runtime adapters | Browser / Node |
| `@soullink-emotion/live2d-pixi` | PIXI Live2D 渲染、CDI3 元数据和参数读取 | Browser |
| `@soullink-emotion/devtools-vue` | Profile 覆盖率、参数预览、映射编辑和保存 | Browser / Vue 3 |

只需要本地表演参数：

```bash
npm install @soullink-emotion/engine
```

需要完整会话编排：

```bash
npm install @soullink-emotion/engine @soullink-emotion/runtime-core
```

需要浏览器 Live2D 渲染：

```bash
npm install @soullink-emotion/engine @soullink-emotion/runtime-core \
  @soullink-emotion/live2d-pixi pixi.js@^7.4.3 pixi-live2d-display@0.5.0-beta
```

已有 Soullink API 服务：

```bash
npm install @soullink-emotion/engine @soullink-emotion/runtime-core \
  @soullink-emotion/api-client
```

只使用 Embedding，不使用生成式 LLM：

```bash
npm install @soullink-emotion/engine @soullink-emotion/runtime-core \
  @soullink-emotion/classifier-embedding
```

需要生成新模型 Profile：

```bash
npm install @soullink-emotion/profile-generator
```

## 运行当前测试项目

仓库根目录本身就是一个完整浏览器测试项目，`package.json` 通过 npm workspaces 引用本仓库中的 SDK，因此修改包源码并重新构建后可以直接验证。

### 1. 安装并启动

```powershell
npm install
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:4173
```

不配置任何 AI 服务也可以使用本地反应、情绪预设、VAD、FACS、动作风格和模型参数调试。Embedding 和 LLM 模式才需要后端服务配置。

### 2. 生成或刷新 Profile

生成目录中所有已登记模型的 Profile：

```powershell
npm run profile:generate
```

只处理一个模型：

```powershell
npm run profile:generate -- --model bee
```

模型列表位于 [`../src/model-catalog.js`](../src/model-catalog.js)。Profile 生成脚本位于 [`../scripts/generate-profile.mjs`](../scripts/generate-profile.mjs)。

### 3. 添加自己的模型

1. 把模型完整目录放入仓库根目录的 `l2d/<modelDir>`。
2. 确保目录包含 `.model3.json` 以及它引用的 moc3、纹理和可选 CDI3/exp3/motion3 文件。
3. 在 `src/model-catalog.js` 增加 `id`、`modelDir`、`modelFile`、`displayName`。
4. 运行 `npm run profile:generate -- --model <id>`。
5. 打开 `http://127.0.0.1:4173/?model=<id>`。

如果自动映射不足，可以在 `profileOverrides.parameterMap`、`privateEmotionMap` 或 `expressionMap` 中增加该模型的显式覆盖。

## 教程一：只接入 engine 和 Live2D

这个方案不需要 `runtime-core`，适合你已经有自己的消息循环、TTS 和状态管理，只需要情绪表演输出的情况。

### 1. 准备 HTML 容器

```html
<div id="live2d-stage"></div>
```

```css
#live2d-stage {
  width: 100%;
  height: 100vh;
  min-height: 480px;
  overflow: hidden;
}
```

容器必须有稳定宽高，否则 PIXI canvas 和模型会显示为空或尺寸为零。

### 2. 加载 Profile、模型和 runtime

```ts
import {
  getVADPreset,
  loadModelProfile,
  motionStylePresets,
  SoullinkRuntime
} from "@soullink-emotion/engine";
import {
  createScriptTagCubismLoader,
  Live2DRenderer
} from "@soullink-emotion/live2d-pixi";

const { profile } = await loadModelProfile(
  "/models/avatar/soullink.profile.json"
);

const stage = document.querySelector<HTMLElement>("#live2d-stage")!;
const renderer = new Live2DRenderer(stage, {
  cubismLoader: createScriptTagCubismLoader(
    "/live2dcubismcore.min.js"
  )
});

await renderer.load(profile.modelPath);

const runtime = new SoullinkRuntime({
  profile,
  motionStyle: {
    ...motionStylePresets.lively
  }
});
```

正常运行时建议省略 `seed`。runtime 会为本次会话生成随机 seed，让每次启动和每次情绪反应产生自然变化。

### 3. 建立帧循环

```ts
const startedAt = performance.now() / 1000;
let previousTime = startedAt;
let frameId = 0;

function frame(timestampMs: number) {
  const absoluteTime = timestampMs / 1000;
  const timeSeconds = absoluteTime - startedAt;
  const deltaSeconds = Math.min(0.1, absoluteTime - previousTime);
  previousTime = absoluteTime;

  const snapshot = runtime.update(timeSeconds, deltaSeconds);
  renderer.applyNativeAnimation(snapshot.nativeAnimation);
  renderer.setParameters(snapshot.live2dParams);

  frameId = requestAnimationFrame(frame);
}

frameId = requestAnimationFrame(frame);
```

每帧必须同时传递：

- `timeSeconds`：从本次 runtime 启动开始的单调递增秒数。
- `deltaSeconds`：上一帧到当前帧的间隔，通常约为 `1 / 60`。

不要传 `Date.now()` 的毫秒值，也不要把毫秒直接当秒使用。

### 4. 触发情绪

```ts
function triggerEmotion(emotion: string, variant?: string) {
  const vad = getVADPreset(emotion, variant);
  const now = performance.now() / 1000 - startedAt;

  runtime.triggerIntent({
    emotion,
    variant,
    naturalEmotion: emotion,
    naturalVAD: vad,
    intensity: 0.8,
    contextTags: ["manual"]
  }, now, {
    vadTarget: vad
  });
}

triggerEmotion("happy", "bright_smile");
```

这里没有传固定 seed，因此连续点击同一个情绪时，主体表情会从会话随机源取得不同 seed。

### 5. 清理资源

```ts
cancelAnimationFrame(frameId);
renderer.destroy();
```

## 情绪、VAD 与随机性

### 内置情绪

当前内置 VAD 预设包括：

```text
neutral, calm, happy, excited, shy, affectionate, curious,
confused, tired, sad, anxiety, anger, angry, concerned, surprised
```

获取预设：

```ts
import { getVADPreset } from "@soullink-emotion/engine";

const vad = getVADPreset("shy", "bashful");
runtime.applyVADTarget(vad, 1);
```

自定义连续 VAD：

```ts
runtime.applyVADTarget({
  valence: 0.35,
  arousal: 0.7,
  dominance: -0.45
}, 0.8);
```

短暂增量可以使用：

```ts
runtime.applyVADDelta({ arousal: 0.2 }, 0.6);
```

### 两类 seed 不要混淆

| seed | 控制范围 | 正常运行建议 |
| --- | --- | --- |
| `triggerIntent(..., { seed })` | 当前一次反应的 FACS 采样、时序、头歪和细微变体 | 省略，让每次反应变化 |
| `motionStyle.seed` | 整个会话的眨眼、注视、Idle 动作和控制器随机序列 | 省略；录像回放和测试时固定 |

不传反应 seed：

```ts
runtime.triggerIntent(intent, now, { vadTarget });
```

固定反应 seed，适合截图测试和问题复现：

```ts
runtime.triggerIntent(intent, now, {
  vadTarget,
  seed: 20260718
});
```

即使反应 seed 固定，最终画面仍可能受当前 VAD、上一帧 FACS、触发时间和持续运行的 Idle 层影响。完整复现需要相同的 `motionStyle.seed`、输入顺序和帧时间。

当前测试项目的情绪预设没有固定反应 seed，因此重复点击同一预设会产生变化。

## 动作风格配置

```ts
import { motionStylePresets } from "@soullink-emotion/engine";

const runtime = new SoullinkRuntime({
  profile,
  motionStyle: {
    ...motionStylePresets.natural
  }
});
```

内置风格：

| 预设 | 视觉倾向 |
| --- | --- |
| `natural` | 默认平衡，适合普通聊天角色 |
| `lively` | 更频繁的视线、VAD 手势和 Idle 动作 |
| `calm` | 呼吸更慢、注视更稳、动作更克制 |
| `shy` | 注视更游移、眨眼略多、动作幅度较柔和 |

所有可配置项：

| 选项 | 有效范围 | 作用 |
| --- | ---: | --- |
| `seed` | 正整数 | 固定整个本地动作序列 |
| `spontaneity` | `0..2` | Idle 离散动作的活跃程度，`0` 关闭 |
| `gestureFrequency` | `0..2.5` | VAD 过渡手势频率，`0` 关闭 |
| `gazeStability` | `0..1` | 越高越少四处看 |
| `blinkRate` | `0.25..2.5` | 眨眼频率倍数 |
| `breathRate` | `0.5..1.8` | 呼吸速度倍数 |
| `breathVariance` | `0..1` | 呼吸非周期变化量 |
| `microMotionGain` | `0..2` | 连续头部和面部微动幅度 |
| `idleActionGain` | `0..2` | 离散点头、歪头、侧看等幅度，`0` 关闭 |
| `avoidRepeatWindow` | `0..8` | 最近多少个动作不重复 |
| `speechAccentGain` | `0..2` | 音量重音的轻微点头和眉动幅度 |

运行时切换风格：

```ts
runtime.setMotionStyle({
  ...motionStylePresets.calm,
  seed: runtime.getMotionStyle().seed
});
```

保留当前 seed 可以只改变风格参数。如果省略 seed，`setMotionStyle()` 会继续沿用当前 runtime seed；如需一套全新序列，可明确传入新的随机 seed。

另外两个总增益不属于 `motionStyle`：

```ts
runtime.setParameterGain(1.45); // 所有映射参数相对 neutral 的增益，范围 0.4..5
runtime.setBodyMotionGain(1.25); // 头部和身体动作增益，范围 0..4
```

调参建议：先使用 `natural`，再调整 `idleActionGain` 和 `bodyMotionGain`。多个增益同时拉高容易造成持续摇晃或参数撞限。

## 教程二：使用 runtime-core 管理完整会话

`runtime-core` 适合需要消息队列、Planner、TTS、语音播放、主动事件和统一生命周期的应用。

### 1. 创建角色和渲染器

```ts
import {
  loadModelProfile,
  motionStylePresets
} from "@soullink-emotion/engine";
import {
  createBrowserAudioSink,
  createRafClock,
  createSoullinkSession,
  type PersonaConfig
} from "@soullink-emotion/runtime-core";
import {
  createScriptTagCubismLoader,
  Live2DRenderer
} from "@soullink-emotion/live2d-pixi";

const { profile } = await loadModelProfile(
  "/models/avatar/soullink.profile.json"
);

const persona: PersonaConfig = {
  name: "Ava",
  profile: "温和、自然、表达简洁的虚拟主持人。",
  variantByEmotion: {
    neutral: "neutral_ack",
    happy: "bright_smile",
    excited: "sparkle",
    shy: "bashful",
    sad: "downcast",
    confused: "confused",
    concerned: "soft_concern"
  }
};

const stage = document.querySelector<HTMLElement>("#live2d-stage")!;
const renderer = new Live2DRenderer(stage, {
  cubismLoader: createScriptTagCubismLoader(
    "/live2dcubismcore.min.js"
  )
});
const motionParameters = await renderer.load(profile.modelPath);
```

### 2. 创建并启动 session

```ts
const session = createSoullinkSession({
  profile,
  persona,
  clock: createRafClock(),
  audio: createBrowserAudioSink(),
  motionStyle: {
    ...motionStylePresets.lively
  },
  onSnapshot(snapshot) {
    const runtime = snapshot.runtime;
    if (!runtime) return;

    renderer.applyNativeAnimation(runtime.nativeAnimation);
    renderer.setParameters(runtime.live2dParams);

    if (snapshot.apiError) {
      console.error("Soullink API error:", snapshot.apiError);
    }
  }
});

session.setSpeakingMotionParameters(motionParameters);
session.start();
```

没有注入 Planner 和远程 classifier 时，`sendMessage()` 会使用 engine 内置规则分类器，仍然可以显示即时情绪反应：

```ts
await session.sendMessage("今天终于把问题解决了");
```

直接触发已知意图：

```ts
session.triggerIntent({
  emotion: "happy",
  variant: "bright_smile",
  intensity: 0.82,
  contextTags: ["manual"]
});
```

页面卸载时：

```ts
session.stop();
renderer.destroy();
```

### 3. 常用 session 方法

| 方法 | 用途 |
| --- | --- |
| `sendMessage(message)` | 分类消息并异步启动回复链 |
| `sendMessage(message, { awaitReply: true })` | 等待 Planner、TTS 和播放链完成，适合串行弹幕队列 |
| `triggerIntent(intent, options?)` | 直接触发明确情绪 |
| `speak(request)` | 直接合成和播放指定文本 |
| `stopVoice()` | 停止当前语音和说话动作 |
| `reset()` | 清空对话状态并重置 engine |
| `setProfile(profile)` | 热切换或预览模型 Profile |
| `setManualFACS(facs)` | 手动覆盖 FACS，用于调试 |
| `setManualParameters(params)` | 直接预览模型私有 Cubism 参数 |
| `getRuntime()` | 访问底层 `SoullinkRuntime` 高级接口 |

`SessionSnapshot` 还会提供 `planning`、`voiceStatus`、`lastReply`、`conversation`、`proactiveDraft` 和 `apiError`。

## 连接 Soullink API

`api-client` 提供类型化 HTTP Client，以及可以直接注入 `runtime-core` 的 Planner、Embedding 和 TTS adapters。

```ts
import {
  createEmbeddingClassifierAdapter,
  createPlannerAdapter,
  createSoullinkApiClient,
  createTtsAdapter
} from "@soullink-emotion/api-client";
import {
  createBrowserAudioSink,
  createSoullinkSession
} from "@soullink-emotion/runtime-core";

const api = createSoullinkApiClient({
  baseURL: "https://soullink-api.example.com",
  token: () => sessionStorage.getItem("access-token") ?? undefined,
  timeouts: {
    llm: 60_000,
    tts: 900_000,
    embedding: 60_000
  }
});

const session = createSoullinkSession({
  profile,
  persona,
  planner: createPlannerAdapter({ client: api }),
  classifier: createEmbeddingClassifierAdapter({ client: api }),
  tts: createTtsAdapter({
    client: api,
    getProvider: () => "voxcpm2"
  }),
  audio: createBrowserAudioSink(),
  onSnapshot
});

session.start();
await session.sendMessage("今天终于把问题解决了", {
  awaitReply: true
});
```

`baseURL` 指向 Soullink API，而不是直接指向上游模型供应商。浏览器不应持有上游 LLM、Embedding 或 TTS 的长期 API Key。

## 不使用 LLM：直接接入 Embedding 分类

Embedding 分类器不生成文本，只把消息映射成 `EmotionIntent` 和连续 VAD。它内置 1,400 条中文语料、Top-K 投票、精确命中、LRU 查询缓存和规则降级。

### 1. 创建并初始化分类器

```ts
import {
  EmbeddingMessageClassifier,
  QwenEmbeddingClient
} from "@soullink-emotion/classifier-embedding";

const provider = new QwenEmbeddingClient({
  baseURL: process.env.EMBEDDING_BASE_URL,
  apiKey: process.env.EMBEDDING_API_KEY,
  model: process.env.EMBEDDING_MODEL,
  timeoutMs: 30_000
});

const embeddingClassifier = new EmbeddingMessageClassifier(provider, {
  similarityThreshold: 0.65,
  topK: 5,
  queryCacheSize: 256,
  initializationBatchSize: 128
});

await embeddingClassifier.initialize();
```

第一次初始化需要为默认语料生成向量，后续查询只嵌入用户的新消息。生产 Node 服务建议配置文件向量缓存，避免每次重启重新嵌入全部语料：

```ts
import { FileEmbeddingVectorCache } from "@soullink-emotion/classifier-embedding/node";

const embeddingCache = new FileEmbeddingVectorCache({
  directory: ".cache/soullink-embeddings"
});
```

将 `embeddingCache` 传给 `EmbeddingMessageClassifier` 的选项即可。

### 2. 查看分类依据

```ts
const detail = await embeddingClassifier.classifyDetailed(
  "这破服务器怎么又崩了"
);

console.log({
  intent: detail.intent,
  confidence: detail.confidence,
  matchedExamples: detail.matchedExamples,
  emotionScores: detail.emotionScores,
  naturalVAD: detail.naturalVAD,
  cacheHit: detail.cacheHit,
  source: detail.source
});
```

### 3. 注入 runtime-core

`EmbeddingMessageClassifier.classify()` 返回的是 `EmotionIntent`，而 `runtime-core` 的 classifier 端口返回 `{ intent }`，因此需要一个很薄的 adapter：

```ts
const session = createSoullinkSession({
  profile,
  persona,
  classifier: {
    async classify(message) {
      return {
        intent: await embeddingClassifier.classify(message)
      };
    }
  }
});
```

如果分类消息精确命中内置语料或命中 LRU，不会调用远程 Embedding API。Provider 未配置、初始化失败或查询报错时，分类器会降级到中文规则分类器。

完整配置见 [`classifier-embedding/README.md`](./classifier-embedding/README.md)。

## Planner、TTS 与说话动作

### Planner 负责什么

Planner 可以生成：

- 消息反应和回复草稿。
- 待机反思和主动消息。
- 说话期间的多帧参数计划。

它不是 engine 的必需依赖。没有 Planner 时，角色仍然有本地情绪、VAD、FACS、Idle 和口型能力。

### 两种说话动作调度模式

```ts
const session = createSoullinkSession({
  profile,
  persona,
  planner,
  tts,
  audio,
  speakingMotionScheduling: {
    mode: "fixed-parallel",
    fixedFrameCount: 4,
    frameIntervalSec: 1
  }
});
```

| 模式 | 流程 | 优点 | 代价 |
| --- | --- | --- | --- |
| `fixed-parallel` | TTS 和动作规划并行 | 首播延迟较低 | 帧数不基于真实音频长度 |
| `duration` | 先等 TTS，再按真实时长规划 | 动作覆盖更准确 | 首播前多等待一次规划 |

当凭据、参数或 LLM 输出不可用时，说话动作 Planner 会返回 `provider: "vad-facs"` 和空 `parameterPlan`。这不是致命错误：runtime 会继续使用 VAD/FACS 和本地口型。

口型占用嘴巴/下颌的“张开”参数；嘴型、微笑、嘟嘴和音素形状仍可用于 Planner 关键帧。

完整说明见 [`planner-openai/README.md`](./planner-openai/README.md)。

## 真实音量口型

未提供音量分析器时，engine 使用本地合成口型，不需要音频采样。需要让嘴型跟随真实 RMS/peak 时，可以注入 `AudioLevelAnalyzer`：

```ts
let currentRms = 0;
let currentPeak = 0;
let audioAvailable = false;

const audioLevelAnalyzer = {
  getLevel: () => currentRms,
  getPeak: () => currentPeak,
  isAvailable: () => audioAvailable,
  reset() {
    currentRms = 0;
    currentPeak = 0;
  }
};

const session = createSoullinkSession({
  profile,
  persona,
  audioLevelAnalyzer
});
```

宿主可使用 Web Audio `AnalyserNode` 更新这两个值：

```ts
const samples = new Uint8Array(analyser.fftSize);

function sampleAudioLevel() {
  analyser.getByteTimeDomainData(samples);

  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
  }

  currentRms = Math.min(1, Math.sqrt(sumSquares / samples.length) * 3.2);
  currentPeak = Math.min(1, peak * 2.2);
  audioAvailable = true;
  requestAnimationFrame(sampleAudioLevel);
}
```

`createBrowserAudioSink()` 当前不会自动暴露其内部 `HTMLAudioElement`，因此要做真实音量分析，宿主需要让自定义 AudioSink 和 `AnalyserNode` 连接同一个音频源。跨域音频还需要正确的 CORS 响应。

分析器不可用、返回异常或未注入时会自动回退合成口型，不会中断会话。

## 生成和理解 ModelProfile

`profile-generator` 在 Node.js 中扫描：

- `.model3.json`
- `.cdi3.json`
- `.exp3.json`
- `.motion3.json`

最小生成示例：

```ts
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";

const generator = new Live2DProfileAutoGenerator({
  modelsRoot: "/srv/models",
  modelsBaseUrl: "https://assets.example.com/models",
  useConfiguredOpenAI: false
});

const result = await generator.ensure({
  modelDir: "avatar",
  displayName: "Ava",
  force: false
});

console.log(result.profileUrl, result.profile);
```

### Profile 关键字段

| 字段 | 作用 |
| --- | --- |
| `modelPath` | `.model3.json` 的公开 URL |
| `parameterMap` | FACS 到 Cubism 参数的映射 |
| `idleConfig` | 该模型待机参数范围 |
| `neutralParams` | 参数中性值，用于增益和恢复 |
| `parameterSmoothing` | 参数平滑速度 |
| `nativeAnimations` | 扫描得到的 exp3 和 motion3 目录 |
| `expressionMap` | 情绪/变体到原生 expression 的映射 |
| `motionMap` | 情绪/变体到原生 motion 的映射 |
| `privateEmotionMap` | 模型私有特效参数与情绪/VAD 的声明式映射 |

常用参数映射模式：

```ts
const parameterMap = {
  headX: {
    target: "ParamAngleX",
    mode: "set",
    scale: 30,
    min: -30,
    max: 30
  },
  eyeBlinkL: {
    target: "ParamEyeLOpen",
    mode: "subtract",
    scale: 1,
    min: 0,
    max: 1
  }
};
```

生成器优先采用确定性的标准 Cubism ID 和 CDI 名称映射。只有模糊参数才需要可选 LLM 精修，而且 LLM 返回的目标仍会经过真实 CDI 参数 ID 校验。

完整说明见 [`profile-generator/README.md`](./profile-generator/README.md)。

## Live2D 渲染与原生表情

每帧应同时处理参数和原生动画指令：

```ts
renderer.applyNativeAnimation(snapshot.nativeAnimation);
renderer.setParameters(snapshot.live2dParams);
```

`applyNativeAnimation()` 会：

- 根据 `expressionMap` 播放 exp3 表情。
- 根据 `motionMap` 播放指定 motion3。
- 暂时抑制被原生表情占用的参数，避免 FACS 与 exp3 同时抢同一参数。

当前实现不会从一个 motion 候选池随机挑选动作；只有 Profile 明确映射的 motion 才会播放。

渲染注意事项：

- `live2d-pixi` 当前基于 PIXI v7，不兼容 PIXI v6/v8。
- 必须提供 Cubism 4 Core 脚本；SDK 不代为分发 Cubism Core。
- 宿主容器必须有宽高。
- 模型、纹理、CDI3 和 motion/exp 文件 URL 必须能被浏览器访问。
- `renderer.destroy()` 会释放 PIXI、纹理、模型和 ResizeObserver。

只读取模型参数元数据、不需要渲染器时，可以使用轻量子路径：

```ts
import {
  loadCDIParameterMeta,
  parseModel3DisplayInfo
} from "@soullink-emotion/live2d-pixi/metadata";
```

完整说明见 [`live2d-pixi/README.md`](./live2d-pixi/README.md)。

## Vue 模型校准

```vue
<script setup lang="ts">
import { CalibrationPanel } from "@soullink-emotion/devtools-vue";
import "@soullink-emotion/devtools-vue/style.css";
</script>

<template>
  <CalibrationPanel
    :coverage="coverage"
    :current-profile="profile"
    :parameters="motionParameters"
    @preview-profile="session.setProfile($event)"
    @save-calibration="saveCalibration"
  />
</template>
```

校准面板用于：

- 查看标准 FACS 与模型私有参数覆盖率。
- 执行参数 sweep 并确认方向、范围和默认值。
- 编辑 `parameterMap` 和 `privateEmotionMap`。
- 将预览 Profile 热更新到当前 session。
- 把最终映射交给宿主后端保存。

完整说明见 [`devtools-vue/README.md`](./devtools-vue/README.md)。

## 降级行为

Soullink 的各层都是可选端口。缺少远程能力时，角色应继续显示，而不是整体失败：

| 不可用的能力 | 实际行为 |
| --- | --- |
| 未注入 classifier | `runtime-core` 使用 engine 本地规则分类器 |
| Embedding 未配置或查询失败 | `classifier-embedding` 使用规则降级 |
| 未注入 Planner | 即时情绪照常显示，不生成远程回复 |
| 说话动作 Planner 失败 | 使用 `vad-facs`，不播放参数关键帧 |
| 未注入 TTS 或 AudioSink | 不播放语音，表情和 Idle 仍继续 |
| 未注入 AudioLevelAnalyzer | 使用本地合成口型 |
| Profile 没有原生动画映射 | 只使用运行时 FACS 参数 |
| 某个 FACS 没有模型映射 | 该通道不会影响模型，其他通道继续工作 |

应用应通过 `SessionSnapshot.apiError`、Embedding 的 `fallbackReason` 和 Profile 覆盖率记录降级原因。

## 常见问题

### 模型完全不显示

依次检查：

1. Live2D 容器是否有非零宽高。
2. Cubism Core 脚本是否成功加载。
3. `.model3.json`、moc3 和纹理 URL 是否返回 `200`。
4. 模型是 Cubism 4，且使用 PIXI v7 依赖。
5. 浏览器控制台是否有 CORS 或资源相对路径错误。

### 模型显示了，但情绪没有动作

检查：

1. 每帧是否调用 `runtime.update()`。
2. 是否把 `snapshot.live2dParams` 传给 `renderer.setParameters()`。
3. Profile 的 `parameterMap` 是否包含头部、眼睛、嘴和身体通道。
4. Cubism 参数 ID 大小写是否和模型完全一致。
5. `parameterGain`、`bodyMotionGain`、`idleActionGain` 是否被设为 `0`。

### 原生表情没有播放

除了 `setParameters()`，还必须调用：

```ts
renderer.applyNativeAnimation(snapshot.nativeAnimation);
```

同时检查 `nativeAnimations` 和 `expressionMap` 中的名称是否与 exp3 目录一致。

### 每次点击同一情绪动作都一样

不要给普通交互传固定反应 seed：

```ts
runtime.triggerIntent(intent, now, { vadTarget });
```

固定 seed 只适合测试和回放。当前浏览器测试项目的情绪预设已经采用无固定 seed 的写法。

### 动作太频繁或一直摇晃

建议按这个顺序降低：

1. `idleActionGain`
2. `spontaneity`
3. `bodyMotionGain`
4. `microMotionGain`
5. `gestureFrequency`

不要同时把 `parameterGain`、`bodyMotionGain` 和 `idleActionGain` 全部拉到上限。

### Embedding 第一次启动很慢

默认语料需要首次生成向量。Node 服务应使用 `FileEmbeddingVectorCache`；后续启动只加载缓存，新增语料只嵌入缺失部分。

精确命中的消息和 LRU 命中的重复查询不调用 API。

### 浏览器中出现 API Key 或 CORS 问题

不要把上游长期密钥放进 Vite 环境变量并打入 bundle。浏览器应调用可信后端，再由后端连接 LLM、Embedding 和 TTS 供应商。

### Vite 提示 chunk 超过 500 kB

这是体积警告，不是构建失败。Live2D、PIXI 和 Cubism 渲染依赖本身体积较大。生产项目可以动态导入 `live2d-pixi`，把渲染器拆为独立 chunk。

## 性能与延迟

- engine 的 VAD、FACS、Idle、防重复、口型平滑和参数映射都是本地每帧常数级计算。
- 情绪预设和本地规则反应没有网络延迟。
- Embedding 的首次语料初始化可能需要多批 API 请求；查询阶段通常是一条消息一次 Embedding 请求。
- LLM Planner 和 TTS 延迟由供应商决定。
- `fixed-parallel` 可以让 TTS 与说话动作规划并行，降低首播等待。
- 固定 seed 不会加速动作计算，它只用于复现。

## 凭据与运行边界

- SDK 不会自动读取宿主项目的 `.env` 或其他凭据文件。
- 不要把 LLM、Embedding 或 TTS 的长期 API Key 放进浏览器 bundle。
- `profile-generator` 使用文件系统，只能在 Node.js 中运行。
- `live2d-pixi` 依赖浏览器 DOM、PIXI v7 和 Cubism 4 Core。
- 远程模型资源和音频需要正确配置 CORS。
- 不要把包含密钥的本地配置文件提交到版本库。

## 生产接入检查表

- Profile 已生成并通过真实模型验证。
- `parameterMap` 覆盖眼睛、嘴、眉、头部和必要身体参数。
- 每帧同时应用 `nativeAnimation` 和 `live2dParams`。
- 页面卸载时停止 session、音频和 renderer。
- 上游密钥只保存在服务端。
- Embedding 默认语料向量已经持久化缓存。
- API 超时、降级和 `apiError` 已接入日志。
- CORS、模型资源路径和 Cubism Core 部署已验证。
- 生产构建已检查 bundle 拆分和首屏加载时间。
- 自动化测试使用固定 seed，真实交互不固定反应 seed。

## 更多文档

- [当前测试项目说明](../TESTING.md)
- [Engine 与动作风格](./engine/README.md)
- [API Client](./api-client/README.md)
- [Embedding 分类](./classifier-embedding/README.md)
- [Vue 校准工具](./devtools-vue/README.md)
- [Live2D PIXI 渲染](./live2d-pixi/README.md)
- [OpenAI-compatible Planner](./planner-openai/README.md)
- [Profile Generator](./profile-generator/README.md)

## 当前目录开发与验证

测试项目：

```powershell
npm run build
```

单独验证 engine：

```powershell
npm --prefix packages/engine run typecheck
npm --prefix packages/engine run test
npm --prefix packages/engine run build
```

单独验证其他包时，把 `engine` 替换为对应目录名。例如：

```powershell
npm --prefix packages/classifier-embedding run test
npm --prefix packages/profile-generator run typecheck
```
