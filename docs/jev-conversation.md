# JEV 语音对话实验

启动：`npm run dev`，打开终端中显示的地址并选择 LilyaBee。默认勾选“语音对话 · JEV”，发送消息后自动生成文字、语音及动作。支持停止请求或播放、重播、清空会话，以及下载本轮 JSON。

## 数据流

1. Rivo `gemini-3-flash-preview` 接收最近 20 条对话并生成回复。
2. 回复完成后，Fish `/v1/tts` 与 JEV 同时开始。Fish 使用指定的 `reference_id` 和语音模型生成 MP3；JEV 根据回复文字估算大致说话秒数，无需等待音频。
3. 两者都完成后，浏览器 `decodeAudioData` 获取实际时长。服务端把 JEV 关键帧重排到一个比音频更宽松的动作时间轴（默认 1.35 倍规划时长并增加 0.8 秒收尾），参数值不变，不重新请求 JEV。音频结束后动作继续播放到收尾完成。
4. JEV 先决定每帧的头部动作、表情、视线及互斥手势，再为可控连续参数选择中性、小/中/大幅度及正负方向等语义档位；服务端根据当前模型的 cdi3 范围映射成实际数值。这样把语义判断交给 JEV，把数值计算留在代码中。默认按预计每秒约 2 个关键帧生成，支持 1/2/4 档，最终帧率随实际语速略有变化。
5. 等待生成时角色继续待机。全部参数生成并校验后，读取最后实际渲染的姿态，用 0.85 秒 smootherstep 接入 JEV 参数；播放期间再用连续跟随平滑吸收关键帧目标变化。允许平滑的二值特效使用更慢的独立跟随速度；模型声明为严格离散的手部/开关参数始终保持 `0/1`，不产生中间值。音频结束后继续按动作时间轴缓动到最后一帧，释放阶段使用 0.6 秒过渡。原始关键帧不修改。Web Audio 播放语音，Live2D 使用同一个 `AudioContext.currentTime` 采样动作。播放 telemetry 会记录 `strictDiscreteParameterIds`、`smoothedDiscreteParameterIds` 和 `binarySamples`，可直接检查实际渲染过渡。

## 参数归属

- 每个模型的关键帧包含该模型实际加载的全部参数，数值范围来自对应的 moc3/Core 元数据。
- 每个模型的物理输出、口型和保护性外观参数会先排除；其余连续参数和有动作语义的二值开关都进入候选池。JEV 先决定哪些通道需要接管，再生成这些通道的绝对目标值。语义时间轴出现点头、歪头、微笑、视线变化等非中性方向时，候选标准通道会交给 JEV 做第二次一致性判断；只有 JEV 再次选择 `animate` 才会接管。二值动作开关只允许 0/1，并会优先考虑与语句情绪、强调或手势匹配的独特动作。
- LilyaBee 的已知互斥手势由 JEV 选择，转换成模型规定的开关组；其它模型的二值特效、道具、服装和动作参数按独立通道交给 JEV，避免把未知模型的所有开关错误地当成同一种手势。
- 嘴巴开合来自解码音频的 RMS 包络。它不是 JEV 生成的音素口型。
- 完整 152 参数帧用于记录和校验。实际播放只覆盖 `ownedParameterIds`，其余 `passthroughParameterIds` 继续实时 Idle/VAD 和模型物理，包括未接管的呼吸、眨眼、身体起伏、头发与衣物。不把捕获的旧值反复写入这些通道。
- 接管参数在入场缓动结束后以 JEV 值为准，不额外叠加 Idle 偏移；未接管参数一直更新。二值手势/道具/特效开关的关键帧仍是严格的 0/1；是否允许渲染中间值由模型 profile 决定。LilyaBee 的手部动作及 `Param86/87` 属于严格离散开关，激活时整组互斥开关一起接管并保持 0/1。结束后只将接管参数用 0.6 秒缓动交还原运行时。
- 连续参数的语义强度档位映射为约 35%/65%/90% 的可用范围，避免“小幅度”在模型画面中几乎不可见。用户明确点名的模型特效开关会记录在 `explicitEffectParameterIds`，但是否接管仍由 JEV 的初次选择或一致性选择决定。
- 问候语会连同模型参数名称和规则交给 JEV；如果模型有命名的挥手开关（例如 LilyaBee 的 `Param70`），JEV 可以自行选择它、强度和持续时间。程序不会因为本地识别到“你好”而强行加入挥手，也不会截断 JEV 选择的时间轴。

## 配置与记录

服务端读取根目录的本地 `api` 文件（已被 Git 忽略），也支持同名环境变量：

```ini
RIVO_API_KEY=...
RIVO_BASE_URL=https://rivoapi.com/v1
RIVO_MODEL=gemini-3-flash-preview
FISH_API_KEY=...
FISH_BASE_URL=https://api.fish.audio/v1
FISH_REFERENCE_ID=...
FISH_MODEL=s2.1-pro
JEV_API_KEY=...
JEV_BASE_URL=https://openrouter.ai/api/alpha
JEV_MODEL=~typesafe/jev-latest
```

每轮写入 `output/conversations/<id>.json` 和同名 MP3。JSON 包含完整 provider 请求体、原始回复、JEV 概率、耗时、预估及实际音频时长、初始姿态、关键帧及播放采样；不记录认证头。`plan.decisionAnswers` 保存动作、参数和一致性阶段的 JEV 选择及置信度，`plan.decisionConfidence` 汇总低/中/高置信度，完整 `probabilities` 仍在对应的 `requests[].response.answers` 中保留。当前动作是低风险表现控制，因此置信度用于诊断而不是一刀切禁用动作；`selectionOverrides` 仅记录 JEV 一致性阶段选择接管的通道，不代表本地覆盖。`plan` 保留 JEV 原始时间轴，`playbackPlan` 记录适配实际语音的时间轴，`entryTransition` 记录缓动来源姿态。中止及失败请求也保留。重播记录追加到 `playbacks`。

`npm run conversation:test` 验证时间轴、完整帧校验、连续/离散插值和 JEV 选择解码。`npm run build` 校验构建。

## 实验边界

目前先生成整段语音和动作再播放，有明显等待时间，不是流式实时生成。模型切换会重新读取该模型的 moc3 参数、profile 和 physics3 输出；最长 60 秒。文字与动作的对应采用等比例分段，尚无逐词时间戳。JEV 可能长时间保持同一个姿态、偶尔选出节奏不自然的动作；数值合法不代表表演自然。对话历史保存在当前页面，刷新后重新开始，磁盘实验日志仍保留。
