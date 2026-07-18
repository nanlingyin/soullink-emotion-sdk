# @soullink-emotion/classifier-embedding

面向 Soullink Emotion 的 Embedding 情绪分类器。包内置 1,400 条中文对话语料，平衡覆盖 14 类 VAD 情绪，并支持：

- Top-K 加权情绪投票和连续 VAD 输出。
- 规范化语料精确命中，命中时不调用 Embedding API。
- 内存 LRU 查询缓存，重复消息不调用 Embedding API。
- 可插拔的样本向量持久化缓存，避免服务重启后重新嵌入 1,400 条语料。
- `classifyDetailed()` 返回置信度、相似语料、类别得分和缓存状态。
- Provider 无关接口、OpenAI-compatible Qwen client、规则降级和动态语料。

包可运行在 Node.js 18+ 或现代浏览器中，不依赖生成式 LLM。

## 快速使用

```ts
import {
  EmbeddingMessageClassifier,
  QwenEmbeddingClient
} from "@soullink-emotion/classifier-embedding";

const provider = new QwenEmbeddingClient({
  baseURL: "https://api.example.com/v1",
  apiKey: process.env.EMBEDDING_API_KEY,
  model: "Qwen/Qwen3-VL-Embedding-8B"
});

const classifier = new EmbeddingMessageClassifier(provider, {
  similarityThreshold: 0.65,
  topK: 5,
  queryCacheSize: 256,
  initializationBatchSize: 128
});

await classifier.initialize();

const intent = await classifier.classify("卧槽，最后一秒居然翻盘了");
console.log(intent.emotion, intent.intensity, intent.naturalVAD);
```

`classify()` 仍返回标准 `EmotionIntent`。Embedding 分类、精确命中、neutral 和规则降级都会提供完整的 `naturalVAD`，可直接交给 Soullink 表情引擎。

默认配置：

| 选项 | 默认值 | 作用 |
| --- | ---: | --- |
| `similarityThreshold` | `0.65` | 最高相似度必须超过该值 |
| `topK` | `5` | 参与类别投票和 VAD 加权的最近语料数 |
| `queryCacheSize` | `256` | 内存中保留的查询结果数量，设为 `0` 可关闭 |
| `initializationBatchSize` | `128` | 初始化时单次发送给 Provider 的语料数 |
| `includeDefaultExamples` | `true` | 是否加载内置 1,400 条语料 |

如需恢复原来的单条最近邻行为，将 `topK` 设为 `1`。

## 查看详细分类结果

```ts
const detail = await classifier.classifyDetailed("这破服务器怎么又崩了");

console.log({
  intent: detail.intent,
  source: detail.source,             // exact | embedding | neutral | fallback
  confidence: detail.confidence,     // 0..1
  similarity: detail.similarity,
  naturalVAD: detail.naturalVAD,
  matchedExamples: detail.matchedExamples,
  emotionScores: detail.emotionScores,
  cacheHit: detail.cacheHit,
  fallbackReason: detail.fallbackReason
});
```

`matchedExamples` 按相似度从高到低排列，最多返回 `topK` 条；`emotionScores` 是超过阈值的邻居按情绪汇总后的权重和占比。主情绪由投票结果决定，`naturalVAD` 则由所有超过阈值的 Top-K 邻居加权得到，因此可以表达介于 `happy`、`excited`、`surprised` 等类别之间的状态。

## 精确命中与查询缓存

分类器会为消息生成规范化匹配键：统一 Unicode 宽窄字符和英文大小写，并忽略空白与标点。比如下面两条会命中同一条内置语料：

```ts
await classifier.classify("真他妈离谱");
await classifier.classify("  真他妈离谱！！！  ");
```

内置或动态语料的精确命中不需要初始化，也不会调用远程 API。非精确消息在第一次分类后进入 LRU；规范化后相同的消息再次出现时直接返回缓存结果。

如果自定义 Provider 通过 `providerOptions` 动态切换模型或租户，请实现 `getCacheKey(options)`；未提供稳定缓存键时，分类器会安全地跳过这类请求的 LRU 复用。

动态增加语料会自动清空查询 LRU。宿主也可以主动清空：

```ts
classifier.clearQueryCache();
```

## Node.js 持久化样本向量

内存 LRU 缓存的是用户查询结果；`FileEmbeddingVectorCache` 缓存的是 1,400 条默认语料和动态语料的向量。第一次启动仍需调用 Embedding API，后续启动会直接从磁盘加载。

```ts
import { EmbeddingMessageClassifier, QwenEmbeddingClient } from "@soullink-emotion/classifier-embedding";
import { FileEmbeddingVectorCache } from "@soullink-emotion/classifier-embedding/node";

const provider = new QwenEmbeddingClient({
  baseURL: process.env.QWEN_EMBEDDING_BASE_URL,
  apiKey: process.env.QWEN_EMBEDDING_API_KEY,
  model: process.env.QWEN_EMBEDDING_MODEL
});

const embeddingCache = new FileEmbeddingVectorCache({
  directory: ".cache/soullink-embeddings"
});

const classifier = new EmbeddingMessageClassifier(provider, {
  embeddingCache
});

await classifier.initialize();
```

Qwen client 会用 `baseURL + model` 自动生成缓存命名空间，API Key 不会写入缓存键或缓存文件。语料新增或删除时只嵌入缺少向量的文本。

自定义 Provider 使用持久化缓存时，需要实现 `getCacheKey()`，或者显式设置 `embeddingCacheKey`：

```ts
const classifier = new EmbeddingMessageClassifier(customProvider, {
  embeddingCache,
  embeddingCacheKey: "my-local-model:v2"
});
```

浏览器应用可以实现同一个 `EmbeddingVectorCache` 接口，将记录保存到 IndexedDB。不要使用 `localStorage` 保存大向量集合，其容量通常不够。

## 自定义 Provider 和语料

任何 Provider 只需实现以下接口：

```ts
import type { EmbeddingProvider } from "@soullink-emotion/classifier-embedding";

const localProvider: EmbeddingProvider = {
  getCacheKey() {
    return "local-chinese-embedding:v1";
  },
  async embed(text) {
    return localModel.embed(text);
  },
  async batchEmbed(texts) {
    return Promise.all(texts.map(text => localModel.embed(text)));
  }
};
```

可以关闭内置语料并传入自己的样本：

```ts
const classifier = new EmbeddingMessageClassifier(localProvider, {
  includeDefaultExamples: false,
  examples: [{
    text: "这是自定义语义样本",
    intent: {
      emotion: "confused",
      variant: "confused",
      intensity: 0.7,
      contextTags: ["question"]
    }
  }]
});
```

运行期间也可以增加语料。重新调用 `initialize()` 时只嵌入新样本：

```ts
classifier.addExample("自定义新样本", {
  emotion: "happy",
  variant: "bright_smile",
  intensity: 0.8,
  contextTags: ["custom"]
});

await classifier.initialize();
```

## 降级行为

以下情况会使用中文规则分类器：

- Provider 未配置，且消息没有精确命中语料。
- 尚未成功初始化全部样本向量。
- 查询 API 报错、超时或返回无效向量。

可以通过 `fallbackClassifier` 替换降级策略。持久化缓存读取或写入失败不会中断分类器，只会通过可选 `logger` 发出警告。

SDK 不读取宿主环境变量。长期 API Key 不应放在浏览器 bundle 中，浏览器应用建议通过可信后端调用 Embedding API。
