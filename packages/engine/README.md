# @soullink-emotion/engine

SoullinkLive 的纯 TypeScript 表演引擎。它把情绪/VAD、FACS、Idle 动作、口型和手动参数混合为每帧 Live2D 参数，不依赖 DOM，也不会自行发起网络请求。

## 动作增强

- 每个会话使用独立随机序列；固定 `seed` 时可复现。
- 非周期呼吸、微动、眨眼和注视。
- 低频 Idle 动作：小点头、歪头、侧看回正、重心移动、轻靠近/后退、叹气下沉、慢眨。
- 根据当前 VAD、角色性格和模型 capabilities 选择动作。
- 最近动作与方向防重复，交互或语音开始时立即中断。
- VAD 手势提供更多候选，并在最近窗口内避重。
- 可选 RMS/peak 口型、attack/release 平滑和轻微重音动作。

这些功能只生成 FACS/参数时间线，不使用原生 `motion3` 候选池，也不包含长语音动作续播。

## 快速使用

```ts
import {
  motionStylePresets,
  SoullinkRuntime
} from "@soullink-emotion/engine";

const runtime = new SoullinkRuntime({
  profile,
  motionStyle: {
    ...motionStylePresets.lively,
    seed: 20260717,
    idleActionGain: 1.05,
    avoidRepeatWindow: 4
  }
});

const snapshot = runtime.update(timeSeconds, deltaSeconds);
renderer.setParameters(snapshot.live2dParams);
```

内置预设：`natural`、`lively`、`calm`、`shy`。可以随时局部覆盖：

```ts
runtime.setMotionStyle({
  spontaneity: 0.8,
  gazeStability: 0.78,
  gestureFrequency: 1.1
});
```

`spontaneity: 0` 或 `idleActionGain: 0` 会关闭离散 Idle 动作；`gestureFrequency: 0` 会关闭 VAD 过渡手势。`setIdleEnabled(false)` 仍是关闭全部 Idle 层的总开关。

## 真实音量口型

分析器只需提供归一化的 `0..1` 音量。`getPeak`、可用性和重置接口均为可选：

```ts
runtime.setAudioLevelAnalyzer({
  getLevel: () => currentRms,
  getPeak: () => currentPeak,
  isAvailable: () => true,
  reset: () => resetAudioWindow()
});

runtime.setVoicePlaybackActive(true);
```

没有分析器、分析器不可用或读取异常时，控制器自动回退合成口型。浏览器可通过 Web Audio `AnalyserNode` 计算 RMS/peak；跨域音频需要正确的 CORS 响应。

使用 `@soullink-emotion/runtime-core` 时，也可以把 `motionStyle` 和 `audioLevelAnalyzer` 直接传给 `createSoullinkSession()`。

## 延迟

Idle 调度、VAD 手势、防重复、呼吸、微动和口型平滑都是本地常数级计算，不增加 API 往返。网络延迟仍只来自宿主已经使用的分类、规划或 TTS 服务。
