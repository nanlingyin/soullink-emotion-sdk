import type { Live2DParamState } from "../facs/FACSLikeState";
import type {
  PrivateEmotionCategory,
  PrivateEmotionMap,
  PrivateEmotionMapping
} from "../profile/ModelProfile";
import { clamp } from "../utils/clamp";
import type { VADRuntimeState } from "./VADState";

export interface VADPrivateParameterInfo {
  name?: string;
  groupId?: string;
  groupName?: string;
  min: number;
  max: number;
  default: number;
}

interface PrivateEmotionCandidate {
  id: string;
  info: VADPrivateParameterInfo;
  category: PrivateEmotionCategory;
  priority: number;
}

interface DeclaredPrivateEmotionCandidate {
  mappingKey: string;
  id: string;
  info: VADPrivateParameterInfo;
  mapping: PrivateEmotionMapping;
}

type PrivateEmotionAmounts = Record<PrivateEmotionCategory, number>;

export interface VADPrivateParameterSummary {
  totalParameters: number;
  candidateCount: number;
  categories: Record<string, number>;
}

export interface VADPrivateParameterUpdateContext {
  /** Semantic intent may be more specific than the VAD-derived label (for example, confused). */
  intentEmotion?: string;
  intentVariant?: string;
}

export class VADPrivateParameterOverlay {
  private candidates: PrivateEmotionCandidate[] = [];
  private declaredCandidates: DeclaredPrivateEmotionCandidate[] = [];
  private totalParameters = 0;
  private activeExclusiveCategory: PrivateEmotionCategory | null = null;
  private activeVariantByCategory: Partial<Record<PrivateEmotionCategory, string>> = {};

  setParameters(
    parameters: Record<string, VADPrivateParameterInfo>,
    privateEmotionMap: PrivateEmotionMap = {},
    profileMappedIds: ReadonlySet<string> = new Set()
  ) {
    this.totalParameters = Object.keys(parameters).length;
    const mappings = privateEmotionMap && typeof privateEmotionMap === "object" && !Array.isArray(privateEmotionMap)
      ? privateEmotionMap
      : {};
    this.declaredCandidates = selectDeclaredCandidates(parameters, mappings);
    const excludedHeuristicIds = new Set([
      ...profileMappedIds,
      ...this.declaredCandidates.map((candidate) => candidate.id)
    ]);
    this.candidates = selectCandidates(parameters, excludedHeuristicIds);
    this.activeExclusiveCategory = null;
    this.activeVariantByCategory = {};
  }

  getSummary(): VADPrivateParameterSummary {
    const categories: Record<string, number> = {};
    for (const candidate of this.candidates) {
      categories[candidate.category] = (categories[candidate.category] ?? 0) + 1;
    }
    for (const candidate of this.declaredCandidates) {
      const category = candidate.mapping.category ?? "privateEffect";
      categories[category] = (categories[category] ?? 0) + 1;
    }

    return {
      totalParameters: this.totalParameters,
      candidateCount: this.candidates.length + this.declaredCandidates.length,
      categories
    };
  }

  update(
    vadState: VADRuntimeState,
    weight = 1,
    context: VADPrivateParameterUpdateContext = {}
  ): Live2DParamState {
    if ((this.candidates.length === 0 && this.declaredCandidates.length === 0) || weight <= 0) return {};

    const result: Live2DParamState = {};
    const vad = vadState.current;
    const emotion = normalizeText(vadState.dominantEmotion);
    const baseAmounts = createCategoryAmounts();

    for (const candidate of this.candidates) {
      const amount = privateEmotionAmount(candidate.category, vad.valence, vad.arousal, vad.dominance, emotion);
      baseAmounts[candidate.category] = Math.max(baseAmounts[candidate.category], amount);
    }

    const amounts = resolveCategoryConflicts(baseAmounts, emotion, this.activeExclusiveCategory);
    this.activeExclusiveCategory = currentExclusiveCategory(amounts);
    const activeSelection = selectActiveCandidates(this.candidates, amounts, this.activeVariantByCategory);
    this.activeVariantByCategory = activeSelection.variants;

    for (const candidate of this.candidates) {
      const amount = activeSelection.ids.has(candidate.id) ? amounts[candidate.category] : 0;
      result[candidate.id] = activeValue(candidate.info, amount * weight);
    }

    Object.assign(result, evaluateDeclaredCandidates(this.declaredCandidates, vadState, weight, context));

    return result;
  }
}

const privateEmotionCategories: PrivateEmotionCategory[] = [
  "positiveEye",
  "blush",
  "tear",
  "shadow",
  "anger",
  "sweat",
  "surprise",
  "privateEffect"
];

const exclusiveCategories: PrivateEmotionCategory[] = [
  "positiveEye",
  "tear",
  "shadow",
  "anger",
  "sweat",
  "surprise",
  "privateEffect"
];

function selectCandidates(
  parameters: Record<string, VADPrivateParameterInfo>,
  excludedIds: ReadonlySet<string> = new Set()
): PrivateEmotionCandidate[] {
  const selected: PrivateEmotionCandidate[] = [];

  for (const [id, info] of Object.entries(parameters)) {
    if (excludedIds.has(id)) continue;
    if (!Number.isFinite(info.min) || !Number.isFinite(info.max)) continue;
    if (isLowValueParameter(id, info) || isMouthOpenParameter(id, info) || isCoreMotionParameter(id, info)) continue;

    const category = classifyPrivateEmotionParameter(id, info);
    if (!category) continue;

    selected.push({
      id,
      info,
      category,
      priority: categoryPriority(category, id, info)
    });
  }

  return selected
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .slice(0, 32);
}

function selectDeclaredCandidates(
  parameters: Record<string, VADPrivateParameterInfo>,
  mappings: PrivateEmotionMap
): DeclaredPrivateEmotionCandidate[] {
  const result: DeclaredPrivateEmotionCandidate[] = [];

  for (const [mappingKey, mapping] of Object.entries(mappings)) {
    const targets = uniqueStrings([
      ...(mapping.target ? [mapping.target] : []),
      ...(mapping.targets ?? [])
    ]);
    for (const id of targets) {
      const info = parameters[id];
      if (!info || !Number.isFinite(info.min) || !Number.isFinite(info.max)) continue;
      if (isLowValueParameter(id, info) || isMouthOpenParameter(id, info)) continue;
      result.push({ mappingKey, id, info, mapping });
    }
  }

  return result.slice(0, 64);
}

function evaluateDeclaredCandidates(
  candidates: DeclaredPrivateEmotionCandidate[],
  vadState: VADRuntimeState,
  weight: number,
  context: VADPrivateParameterUpdateContext
): Live2DParamState {
  if (candidates.length === 0) return {};
  const evaluated = candidates.map((candidate) => ({
    candidate,
    amount: declaredEmotionAmount(candidate.mapping, vadState, context) * weight
  }));
  const groupWinners = new Map<string, string>();

  for (const item of evaluated.filter((entry) => entry.amount > 0)) {
    const group = item.candidate.mapping.exclusiveGroup?.trim();
    if (!group) continue;
    const currentKey = groupWinners.get(group);
    const current = currentKey
      ? evaluated.find((entry) => entry.candidate.mappingKey === currentKey)
      : undefined;
    if (!current || declaredScore(item) > declaredScore(current)) {
      groupWinners.set(group, item.candidate.mappingKey);
    }
  }

  const byTarget = new Map<string, typeof evaluated>();
  for (const item of evaluated) {
    const group = item.candidate.mapping.exclusiveGroup?.trim();
    const allowed = !group || !groupWinners.has(group) || groupWinners.get(group) === item.candidate.mappingKey;
    const normalized = allowed ? item : { ...item, amount: 0 };
    byTarget.set(item.candidate.id, [...(byTarget.get(item.candidate.id) ?? []), normalized]);
  }

  const result: Live2DParamState = {};
  for (const [id, items] of byTarget) {
    const selected = [...items].sort((left, right) => (
      Number(right.amount > 0) - Number(left.amount > 0)
      || declaredScore(right) - declaredScore(left)
    ))[0];
    if (selected) {
      result[id] = declaredValue(selected.candidate.info, selected.candidate.mapping, selected.amount);
    }
  }
  return result;
}

function declaredEmotionAmount(
  mapping: PrivateEmotionMapping,
  vadState: VADRuntimeState,
  context: VADPrivateParameterUpdateContext
): number {
  const checks: boolean[] = [];
  const emotions = [
    vadState.dominantEmotion,
    context.intentEmotion,
    context.intentVariant
  ].filter((value): value is string => Boolean(value)).map(normalizeText);
  if (mapping.emotions?.length) {
    checks.push(mapping.emotions.some((candidate) => {
      const normalized = normalizeText(candidate);
      return emotions.some((emotion) => emotion.includes(normalized) || normalized.includes(emotion));
    }));
  }
  if (mapping.vadRange && Object.keys(mapping.vadRange).length > 0) {
    checks.push(vadMatchesRange(vadState, mapping));
  }

  if (checks.length > 0) {
    const active = mapping.triggerMode === "all" ? checks.every(Boolean) : checks.some(Boolean);
    if (!active) return 0;
    return clamp(mapping.intensity ?? Math.max(vadState.intensity, 0.65), 0, 1);
  }

  return privateEmotionAmount(
    mapping.category ?? "privateEffect",
    vadState.current.valence,
    vadState.current.arousal,
    vadState.current.dominance,
    normalizeText(vadState.dominantEmotion)
  );
}

function vadMatchesRange(vadState: VADRuntimeState, mapping: PrivateEmotionMapping): boolean {
  const range = mapping.vadRange;
  if (!range) return false;
  const axes = ["valence", "arousal", "dominance"] as const;
  return axes.every((axis) => {
    const limits = range[axis];
    if (!limits) return true;
    const min = Math.min(limits[0], limits[1]);
    const max = Math.max(limits[0], limits[1]);
    return vadState.current[axis] >= min && vadState.current[axis] <= max;
  });
}

function declaredScore(item: { candidate: DeclaredPrivateEmotionCandidate; amount: number }): number {
  return item.amount + (item.candidate.mapping.priority ?? 0) / 100;
}

function declaredValue(
  info: VADPrivateParameterInfo,
  mapping: PrivateEmotionMapping,
  amount: number
): number {
  const min = Math.min(info.min, info.max);
  const max = Math.max(info.min, info.max);
  const neutral = clamp(mapping.neutralValue ?? info.default, min, max);
  const active = clamp(mapping.activeValue ?? farthestEndpoint(neutral, min, max), min, max);
  return clamp(neutral + (active - neutral) * clamp(amount, 0, 1), min, max);
}

function farthestEndpoint(neutral: number, min: number, max: number): number {
  return Math.abs(max - neutral) >= Math.abs(neutral - min) ? max : min;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function createCategoryAmounts(): PrivateEmotionAmounts {
  return {
    positiveEye: 0,
    blush: 0,
    tear: 0,
    shadow: 0,
    anger: 0,
    sweat: 0,
    surprise: 0,
    privateEffect: 0
  };
}

function resolveCategoryConflicts(
  base: PrivateEmotionAmounts,
  emotion: string,
  previous: PrivateEmotionCategory | null
): PrivateEmotionAmounts {
  const result = createCategoryAmounts();
  const primary = chooseExclusiveCategory(base, emotion, previous);

  if (!primary) {
    result.blush = visibleAmount(base.blush);
    return result;
  }

  result[primary] = visibleAmount(base[primary]);

  if (primary === "positiveEye") {
    result.blush = visibleAmount(Math.min(base.blush, 0.56));
  } else if (primary === "surprise" && hasAny(emotion, ["surprised", "confused"])) {
    result.sweat = visibleAmount(Math.min(base.sweat * 0.42, 0.24));
  } else if (primary === "sweat" && hasAny(emotion, ["anxiety", "confused"])) {
    result.shadow = visibleAmount(Math.min(base.shadow * 0.34, 0.22));
  }

  if (!exclusiveCategories.includes(primary)) {
    result.blush = visibleAmount(base.blush);
  }

  return result;
}

function chooseExclusiveCategory(
  base: PrivateEmotionAmounts,
  emotion: string,
  previous: PrivateEmotionCategory | null
): PrivateEmotionCategory | null {
  const scored = exclusiveCategories
    .map((category) => ({
      category,
      amount: base[category],
      score: categoryScore(category, base[category], emotion)
    }))
    .filter((item) => item.amount >= 0.045)
    .sort((left, right) => right.score - left.score || categoryPriorityRank(left.category) - categoryPriorityRank(right.category));

  const winner = scored[0];
  if (!winner || winner.score < 0.075) return null;

  if (previous) {
    const previousScore = categoryScore(previous, base[previous], emotion);
    if (base[previous] >= 0.055 && winner.category !== previous && winner.score - previousScore < 0.14) {
      return previous;
    }
  }

  return winner.category;
}

function categoryScore(category: PrivateEmotionCategory, amount: number, emotion: string): number {
  if (amount <= 0) return 0;
  return amount + categoryEmotionBias(category, emotion);
}

function categoryEmotionBias(category: PrivateEmotionCategory, emotion: string): number {
  switch (category) {
    case "positiveEye":
      return emotionBoost(emotion, ["happy", "excited", "affectionate"], 0.18) + emotionBoost(emotion, ["shy"], 0.08);
    case "tear":
      return emotionBoost(emotion, ["sad"], 0.24) + emotionBoost(emotion, ["concerned"], 0.1);
    case "shadow":
      return emotionBoost(emotion, ["anxiety"], 0.18) + emotionBoost(emotion, ["anger", "angry"], 0.08);
    case "anger":
      return emotionBoost(emotion, ["anger", "angry"], 0.26);
    case "sweat":
      return emotionBoost(emotion, ["anxiety", "confused"], 0.18) + emotionBoost(emotion, ["surprised"], 0.06);
    case "surprise":
      return emotionBoost(emotion, ["surprised"], 0.28) + emotionBoost(emotion, ["confused"], 0.06);
    case "privateEffect":
    case "blush":
      return 0;
  }
}

function currentExclusiveCategory(amounts: PrivateEmotionAmounts): PrivateEmotionCategory | null {
  let best: { category: PrivateEmotionCategory; amount: number } | null = null;

  for (const category of exclusiveCategories) {
    const amount = amounts[category];
    if (amount <= 0) continue;
    if (!best || amount > best.amount) best = { category, amount };
  }

  return best?.amount && best.amount >= 0.04 ? best.category : null;
}

function categoryPriorityRank(category: PrivateEmotionCategory): number {
  const rank: Record<PrivateEmotionCategory, number> = {
    positiveEye: 0,
    blush: 1,
    tear: 2,
    shadow: 3,
    anger: 4,
    sweat: 5,
    surprise: 6,
    privateEffect: 7
  };

  return rank[category];
}

function visibleAmount(amount: number): number {
  return amount >= 0.04 ? clamp(amount, 0, 1) : 0;
}

function selectActiveCandidates(
  candidates: PrivateEmotionCandidate[],
  amounts: PrivateEmotionAmounts,
  previousVariants: Partial<Record<PrivateEmotionCategory, string>>
): { ids: Set<string>; variants: Partial<Record<PrivateEmotionCategory, string>> } {
  const ids = new Set<string>();
  const variants: Partial<Record<PrivateEmotionCategory, string>> = {};

  for (const category of privateEmotionCategories) {
    if (amounts[category] <= 0) continue;

    const categoryCandidates = candidates.filter((candidate) => candidate.category === category);
    if (categoryCandidates.length === 0) continue;

    const variant = chooseVariant(categoryCandidates, previousVariants[category]);
    variants[category] = variant;

    const picked = pickLimitedCandidates(
      categoryCandidates.filter((candidate) => candidateVariantKey(candidate) === variant),
      categoryCandidateLimit(category)
    );

    for (const candidate of picked) {
      ids.add(candidate.id);
    }
  }

  return { ids, variants };
}

function chooseVariant(candidates: PrivateEmotionCandidate[], previous?: string): string {
  const groups = new Map<string, number>();

  for (const candidate of candidates) {
    const variant = candidateVariantKey(candidate);
    groups.set(variant, Math.min(groups.get(variant) ?? Number.POSITIVE_INFINITY, candidate.priority));
  }

  if (previous && groups.has(previous)) return previous;

  return [...groups.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "default";
}

function pickLimitedCandidates(candidates: PrivateEmotionCandidate[], limit: number): PrivateEmotionCandidate[] {
  const sorted = [...candidates].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  if (limit <= 1 || sorted.length <= 1) return sorted.slice(0, 1);

  const sided = sorted.filter((candidate) => parameterSide(candidate.id, candidate.info));
  if (sided.length >= 2) {
    const result: PrivateEmotionCandidate[] = [];
    const usedSides = new Set<string>();

    for (const candidate of sorted) {
      const side = parameterSide(candidate.id, candidate.info);
      if (!side || usedSides.has(side)) continue;
      result.push(candidate);
      usedSides.add(side);
      if (result.length >= limit) break;
    }

    if (result.length > 0) return result;
  }

  return sorted.slice(0, 1);
}

function categoryCandidateLimit(category: PrivateEmotionCategory): number {
  if (category === "positiveEye" || category === "blush" || category === "tear") return 2;
  return 1;
}

function candidateVariantKey(candidate: PrivateEmotionCandidate): string {
  const text = parameterText(candidate.id, candidate.info);

  if (candidate.category === "positiveEye" || candidate.category === "privateEffect") {
    if (hasAny(text, ["爱心", "心", "heart", "love"])) return "heart";
    if (hasAny(text, ["星", "star"])) return "star";
    if (hasAny(text, ["闪", "sparkle", "highlight", "高光"])) return "sparkle";
  }

  if (candidate.category === "shadow" && hasAny(text, ["黑", "dark", "black"])) return "dark";
  if (candidate.category === "anger" && hasAny(text, ["怒", "angry", "anger", "mad"])) return "anger";
  if (candidate.category === "surprise" && hasAny(text, ["惊", "shock", "surprise"])) return "surprise";

  return candidate.category;
}

function parameterSide(id: string, info: VADPrivateParameterInfo): "left" | "right" | null {
  const raw = `${id} ${info.name ?? ""} ${info.groupName ?? ""}`.toLowerCase();
  if (raw.includes("左") || raw.includes("left") || /(?:^|[^a-z])l(?:\d|$|[^a-z])/u.test(raw) || /l(?:\d)?$/u.test(raw)) {
    return "left";
  }
  if (raw.includes("右") || raw.includes("right") || /(?:^|[^a-z])r(?:\d|$|[^a-z])/u.test(raw) || /r(?:\d)?$/u.test(raw)) {
    return "right";
  }
  return null;
}

function classifyPrivateEmotionParameter(id: string, info: VADPrivateParameterInfo): PrivateEmotionCategory | null {
  const text = parameterText(id, info);

  if (hasAny(text, ["爱心眼", "心眼", "heart eye", "hearteye", "loveeye", "love eyes", "星星眼", "star eye", "stareye", "sparkleeye", "闪眼"])) return "positiveEye";
  if (hasAny(text, ["脸红", "腮红", "脸颊红", "blush", "cheekred", "照れ"])) return "blush";
  if (hasAny(text, ["眼泪", "泪", "哭", "tear", "cry", "crying"])) return "tear";
  if (hasAny(text, ["脸黑", "黑脸", "阴影", "黑化", "shade", "shadow", "dark face", "faceshadow"])) return "shadow";
  if (hasAny(text, ["生气", "怒", "angry", "anger", "mad"])) return "anger";
  if (hasAny(text, ["汗", "冷汗", "sweat", "drop"])) return "sweat";
  if (hasAny(text, ["惊", "惊讶", "震惊", "surprise", "shock", "びっくり"])) return "surprise";
  if (hasAny(text, ["特效", "符号", "表情", "effect", "emoji", "mark", "heart", "star", "心", "星"])) return "privateEffect";

  return null;
}

function privateEmotionAmount(
  category: PrivateEmotionCategory,
  valence: number,
  arousal: number,
  dominance: number,
  emotion: string
): number {
  const positive = Math.max(valence, 0);
  const negative = Math.max(-valence, 0);
  const highArousal = Math.max(arousal, 0);
  const lowDominance = Math.max(-dominance, 0);
  const highDominance = Math.max(dominance, 0);

  switch (category) {
    case "positiveEye":
      return trigger(positive * 0.82 + highArousal * 0.32 + emotionBoost(emotion, ["happy", "excited", "affectionate"], 0.34), 0.42);
    case "blush":
      return trigger(positive * 0.34 + lowDominance * 0.36 + emotionBoost(emotion, ["shy", "affectionate"], 0.58), 0.28);
    case "tear":
      return trigger(negative * 0.72 + Math.max(-arousal, 0) * 0.24 + emotionBoost(emotion, ["sad"], 0.42), 0.36);
    case "shadow":
      return trigger(negative * 0.58 + highArousal * 0.24 + emotionBoost(emotion, ["anxiety", "anger", "angry"], 0.34), 0.42);
    case "anger":
      return trigger(negative * 0.5 + highArousal * 0.34 + highDominance * 0.24 + emotionBoost(emotion, ["anger", "angry"], 0.58), 0.4);
    case "sweat":
      return trigger(negative * 0.36 + highArousal * 0.52 + lowDominance * 0.24 + emotionBoost(emotion, ["anxiety", "confused"], 0.4), 0.36);
    case "surprise":
      return trigger(highArousal * 0.74 + emotionBoost(emotion, ["surprised", "excited"], 0.26), 0.5);
    case "privateEffect":
      return trigger(Math.abs(valence) * 0.3 + highArousal * 0.32 + emotionBoost(emotion, ["happy", "excited", "surprised"], 0.22), 0.48);
  }
}

function activeValue(info: VADPrivateParameterInfo, amount: number): number {
  const min = Math.min(info.min, info.max);
  const max = Math.max(info.min, info.max);
  const neutral = clamp(info.default, min, max);
  const normalizedAmount = clamp(amount, 0, 1);
  const distanceToMin = Math.abs(neutral - min);
  const distanceToMax = Math.abs(max - neutral);
  const activeTarget = distanceToMax >= distanceToMin ? max : min;

  return clamp(neutral + (activeTarget - neutral) * normalizedAmount, min, max);
}

function trigger(value: number, threshold: number): number {
  if (value <= threshold) return 0;
  return clamp((value - threshold) / Math.max(0.001, 1 - threshold), 0, 1);
}

function emotionBoost(emotion: string, emotions: string[], boost: number): number {
  return emotions.some((item) => emotion.includes(item)) ? boost : 0;
}

function categoryPriority(category: PrivateEmotionCategory, id: string, info: VADPrivateParameterInfo): number {
  const text = parameterText(id, info);
  const exactBonus = hasAny(text, ["眼", "eye", "脸", "face", "cheek"]) ? -0.2 : 0;
  const rank: Record<PrivateEmotionCategory, number> = {
    positiveEye: 0,
    blush: 1,
    tear: 2,
    shadow: 3,
    anger: 4,
    sweat: 5,
    surprise: 6,
    privateEffect: 7
  };

  return rank[category] + exactBonus;
}

function isCoreMotionParameter(id: string, info: VADPrivateParameterInfo): boolean {
  const text = parameterText(id, info);
  return hasAny(text, [
    "anglex",
    "angley",
    "anglez",
    "bodyangle",
    "eyeball",
    "eyeopen",
    "mouthopen",
    "mouthform",
    "brow",
    "breath",
    "角度",
    "身体",
    "眼球",
    "眼珠",
    "眉",
    "嘴"
  ]);
}

function isMouthOpenParameter(id: string, info: VADPrivateParameterInfo): boolean {
  const idAndName = normalizeText(`${id} ${info.name ?? ""}`);
  // Explicit mouth-form/lip-shape parameters stay available even when a broad
  // CDI group is named "mouth open/close" for historical authoring reasons.
  if (hasAny(idAndName, [
    "mouthform", "mouthshape", "lipshape", "lipform", "liptype",
    "嘴型", "口型", "唇形", "唇型"
  ])) return false;

  return hasAny(idAndName, [
    "mouthopen", "openmouth", "jawopen", "openjaw",
    "嘴张开", "张嘴", "嘴巴开合", "嘴开合", "口部开合", "下颌开合"
  ]);
}

function isLowValueParameter(id: string, info: VADPrivateParameterInfo): boolean {
  const text = parameterText(id, info);
  return hasAny(text, [
    "copyright",
    "license",
    "watermark",
    "author",
    "授权",
    "盗版",
    "正版",
    "水印",
    "售后",
    "qq群",
    "b站",
    "说明",
    "警告"
  ]);
}

function parameterText(id: string, info: VADPrivateParameterInfo): string {
  return normalizeText(`${id} ${info.name ?? ""} ${info.groupName ?? ""}`);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, "").replace(/[＿_\-　/]/gu, "").toLowerCase();
}

function hasAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(normalizeText(hint)));
}
