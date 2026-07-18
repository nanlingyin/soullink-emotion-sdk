import type { EmotionIntent } from "./EmotionIntent";

export class MessageReactionClassifier {
  classify(message: string): EmotionIntent {
    const text = message.trim();

    if (/(过了|成功|赢了|拿下|通过|上岸|好消息)/u.test(text)) {
      return {
        emotion: "happy",
        variant: "surprised_happy",
        intensity: 0.85,
        contextTags: ["user_good_news"],
        sourceMessage: message
      };
    }

    if (/(喜欢你|可爱|好看|夸夸|贴贴)/u.test(text)) {
      return {
        emotion: "shy",
        variant: "bashful",
        intensity: 0.8,
        contextTags: ["compliment", "warm"],
        sourceMessage: message
      };
    }

    if (/(兴奋|太爽|冲啊|炸了|激动)/u.test(text)) {
      return {
        emotion: "excited",
        variant: "sparkle",
        intensity: 0.86,
        contextTags: ["user_good_news"],
        sourceMessage: message
      };
    }

    if (/(累|难受|不开心|崩溃|压力|困|疼)/u.test(text)) {
      return {
        emotion: /(累|困|没精神)/u.test(text) ? "tired" : "concerned",
        variant: /(累|困|没精神)/u.test(text) ? "drained" : "comfort",
        intensity: 0.75,
        contextTags: ["user_tired", "warm"],
        sourceMessage: message
      };
    }

    if (/(难过|伤心|想哭|委屈|失落)/u.test(text)) {
      return {
        emotion: "sad",
        variant: "downcast",
        intensity: 0.72,
        contextTags: ["comfort"],
        sourceMessage: message
      };
    }

    if (/(焦虑|慌|害怕|紧张|不安)/u.test(text)) {
      return {
        emotion: "anxiety",
        variant: "nervous",
        intensity: 0.76,
        contextTags: ["comfort"],
        sourceMessage: message
      };
    }

    if (/(怎么|为什么|咋回事|啥|不懂|疑惑)/u.test(text)) {
      return {
        emotion: /(好奇|想知道|什么原因)/u.test(text) ? "curious" : "confused",
        variant: /(好奇|想知道|什么原因)/u.test(text) ? "tilt" : "confused",
        intensity: 0.68,
        contextTags: ["question", "curious"],
        sourceMessage: message
      };
    }

    if (/(生气|气死|讨厌|烦|离谱)/u.test(text)) {
      return {
        emotion: "anger",
        variant: "annoyed",
        intensity: 0.62,
        contextTags: ["annoyed"],
        sourceMessage: message
      };
    }

    return {
      emotion: "neutral",
      variant: "neutral_ack",
      intensity: 0.35,
      contextTags: ["normal_chat"],
      sourceMessage: message
    };
  }
}
