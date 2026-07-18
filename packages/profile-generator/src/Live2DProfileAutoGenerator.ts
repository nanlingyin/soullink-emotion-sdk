import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  detectCapabilities,
  facsKeys,
  type FACSKey,
  type ModelProfile,
  type ParameterMap,
  type ParameterMapRule,
  CURRENT_SCHEMA_VERSION,
  deriveNeutralParams,
  deriveParameterSmoothing,
  computeAdaptationCoverage,
  isStandardId,
  type AdaptationCoverage,
  type MappingSource,
  type NativeExpressionEntry,
  type NativeAnimationCatalog,
  type ExpressionBinding,
  type MotionBinding,
  type PrivateEmotionCategory,
  type PrivateEmotionMap,
  type PrivateEmotionMapping
} from "@soullink-emotion/engine";
import {
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient,
  type OpenAICompatibleClientLike,
  type OpenAIClientOptions,
  type OpenAIJsonSchemaResponseFormat,
  type OpenAIResponseFormat
} from "@soullink-emotion/planner-openai";
import { STANDARD_PARAM_TABLE, resolveStandard } from "./standardParamTable.js";

export const profileGeneratorVersion = "soullink-profile-autogen-v3";

export interface EnsureLive2DProfileRequest {
  modelDir?: string;
  displayName?: string;
  force?: boolean;
  openAI?: OpenAIClientOptions;
}

export interface Live2DProfileAutoGeneratorOptions {
  /** Absolute or process-relative directory containing one subdirectory per model. */
  modelsRoot: string;
  /** Public URL prefix corresponding to modelsRoot. Defaults to `/models`. */
  modelsBaseUrl?: string;
  /** Inject a configured OpenAI-compatible client. */
  client?: OpenAICompatibleClientLike;
  /** Allow the configured client to run without a request-level API key. */
  useConfiguredOpenAI?: boolean;
  /** Model directory used when ensure() omits modelDir. Defaults to `lilyabee`. */
  defaultModelDir?: string;
}

export interface SaveCalibratedProfileRequest {
  modelDir: string;
  parameterMap?: unknown;
  customParams?: unknown;
  privateEmotionMap?: unknown;
  neutralParams?: unknown;
  idleConfig?: unknown;
  displayName?: string;
}

export interface EnsureLive2DProfileResult {
  generated: boolean;
  reason: "current" | "missing" | "stale" | "forced";
  provider: "openai-compatible" | "heuristic" | "existing" | "manual";
  profileUrl: string;
  modelUrl: string;
  sourceSignature: Live2DSourceSignature;
  profile: ModelProfile;
  notes: string[];
  /** Response-only adaptation-coverage diagnostic. Never written to disk. */
  coverage?: AdaptationCoverage;
}

export interface Live2DSourceSignature {
  modelDir: string;
  model3File: string;
  cdi3File?: string;
  hash: string;
  generatedAt: string;
}

export interface Live2DParameterInfo {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
}

interface Live2DModelContext {
  modelDir: string;
  directoryPath: string;
  model3File: string;
  model3Path: string;
  cdi3File?: string;
  cdi3Path?: string;
  profilePath: string;
  webModelPath: string;
  webProfilePath: string;
  model3: Live2DModel3;
  cdi3?: Live2DCDI3;
  parameters: Live2DParameterInfo[];
  groups: Live2DModelGroup[];
  expressions: Array<{ name: string; file: string }>;
  expressionFiles: Array<{ name: string; file: string }>;
  motionGroups: Array<{ group: string; files: string[] }>;
  signature: Live2DSourceSignature;
}

interface Live2DModel3 {
  Version?: number;
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    DisplayInfo?: string;
    Expressions?: Array<{ Name?: string; File?: string }>;
    Motions?: Record<string, Array<{ File?: string }>>;
  };
  Groups?: Live2DModelGroup[];
}

interface Live2DModelGroup {
  Target?: string;
  Name?: string;
  Ids?: string[];
}

interface Live2DCDI3 {
  Version?: number;
  Parameters?: Array<{ Id?: string; Name?: string; GroupId?: string }>;
  ParameterGroups?: Array<{ Id?: string; Name?: string; GroupId?: string }>;
}

interface RawProfile {
  modelId?: unknown;
  displayName?: unknown;
  version?: unknown;
  modelPath?: unknown;
  capabilities?: unknown;
  parameterMap?: unknown;
  customParams?: unknown;
  privateEmotionMap?: unknown;
  idleConfig?: unknown;
  reactionBias?: unknown;
  neutralParams?: unknown;
  parameterSmoothing?: unknown;
  nativeAnimations?: unknown;
  expressionMap?: unknown;
  motionMap?: unknown;
}

export class Live2DProfileAutoGenerator {
  private readonly client: OpenAICompatibleClientLike;
  private readonly modelsRoot: string;
  private readonly modelsBaseUrl: string;
  private readonly useConfiguredOpenAI: boolean;
  private readonly defaultModelDir: string;

  constructor(options: Live2DProfileAutoGeneratorOptions) {
    if (!options?.modelsRoot?.trim()) {
      throw new Error("Live2DProfileAutoGenerator requires a modelsRoot directory");
    }

    this.client = options.client ?? new OpenAICompatibleClient();
    this.modelsRoot = path.resolve(options.modelsRoot);
    this.modelsBaseUrl = normalizeModelsBaseUrl(options.modelsBaseUrl ?? "/models");
    this.useConfiguredOpenAI = options.useConfiguredOpenAI ?? false;
    this.defaultModelDir = sanitizeModelDir(options.defaultModelDir ?? "lilyabee");
  }

  async ensure(request: EnsureLive2DProfileRequest): Promise<EnsureLive2DProfileResult> {
    const context = await this.loadContext(request.modelDir ?? this.defaultModelDir);
    const existing = await this.readExistingProfile(context.profilePath);
    const existingHash = existing?.sourceSignature?.hash;
    const generatorRevisionCurrent = !existing?.autoProfile
      || existing.autoProfile.provider === "manual"
      || existing.autoProfile.promptVersion === profileGeneratorVersion;
    const reason = request.force
      ? "forced"
      : existing
        ? existingHash === context.signature.hash
          && existing.modelPath === context.webModelPath
          && generatorRevisionCurrent
          ? "current"
          : "stale"
        : "missing";

    if (reason === "current" && existing) {
      return {
        generated: false,
        reason,
        provider: "existing",
        profileUrl: context.webProfilePath,
        modelUrl: context.webModelPath,
        sourceSignature: context.signature,
        profile: existing,
        notes: ["source signature is current"],
        // Provenance is unknown for a pre-existing profile; coverage infers
        // per-key confidence from whether targets are standard Cubism ids.
        coverage: computeAdaptationCoverage(existing, context.parameters, {
          modelDir: context.modelDir,
          provider: "existing",
          provenance: undefined
        })
      };
    }

    const provenance: Record<string, MappingSource> = {};
    const heuristic = await this.createHeuristicProfile(context, request.displayName ?? existing?.displayName, provenance);
    const notes: string[] = [`generation reason: ${reason}`];
    let provider: "openai-compatible" | "heuristic" = "heuristic";
    let profile = heuristic;

    if (shouldUseLLM(request.openAI, this.useConfiguredOpenAI) && this.client.isConfigured(request.openAI)) {
      try {
        const llmProfile = await this.generateWithLLM(context, heuristic, existing, request.openAI);
        profile = await this.sanitizeProfile(llmProfile, heuristic, context, "openai-compatible");
        provider = "openai-compatible";
        notes.push("LLM profile accepted after parameter validation");
      } catch (error) {
        notes.push(`LLM profile generation fell back to heuristic: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      notes.push("Explicit OpenAI-compatible settings were not provided; used heuristic scanner");
    }

    if (provider === "heuristic") {
      profile = await this.sanitizeProfile(profile, heuristic, context, "heuristic");
    }

    await this.writeProfile(context.profilePath, profile);

    return {
      generated: true,
      reason,
      provider,
      profileUrl: context.webProfilePath,
      modelUrl: context.webModelPath,
      sourceSignature: context.signature,
      profile,
      notes,
      coverage: computeAdaptationCoverage(profile, context.parameters, {
        modelDir: context.modelDir,
        provider,
        provenance
      })
    };
  }

  /**
   * Persist a manually calibrated profile. Overlays only the sanitized incoming
   * rules onto the existing profile, preserves the existing source signature
   * (never rehashes), recomputes neutralParams/parameterSmoothing/capabilities,
   * and marks the profile as provider="manual".
   */
  async saveCalibratedProfile(request: SaveCalibratedProfileRequest): Promise<EnsureLive2DProfileResult> {
    const context = await this.loadContext(request.modelDir);
    const parameterIds = new Set(context.parameters.map((parameter) => parameter.id));
    const mouthOpenParameterIds = new Set(
      context.parameters.filter(isMouthOpenLive2DParameter).map((parameter) => parameter.id)
    );
    const existing = await this.readExistingProfile(context.profilePath);
    // Fall back to a fresh heuristic profile so a save-back still works before
    // the first auto-generation has produced a profile on disk.
    const base = existing ?? await this.createHeuristicProfile(context, request.displayName);

    // Start from the existing parameterMap; overlay ONLY sanitized incoming
    // rules. sanitizeRule drops invalid targets against the real CDI id set, so
    // keys absent or invalid in the request keep their existing rule untouched.
    const parameterMap: ParameterMap = { ...base.parameterMap };
    const rawIncomingMap = request.parameterMap && typeof request.parameterMap === "object" && !Array.isArray(request.parameterMap)
      ? request.parameterMap as Record<string, unknown>
      : {};
    for (const key of facsKeys) {
      const rule = sanitizeRule(rawIncomingMap[key], parameterIds);
      if (rule) parameterMap[key] = rule;
    }

    // Same overlay for customParams, keyed by arbitrary strings.
    const customParams: Record<string, ParameterMapRule> = { ...(base.customParams ?? {}) };
    const rawIncomingCustom = request.customParams && typeof request.customParams === "object" && !Array.isArray(request.customParams)
      ? request.customParams as Record<string, unknown>
      : {};
    for (const [key, value] of Object.entries(rawIncomingCustom)) {
      const rule = sanitizeRule(value, parameterIds);
      if (rule) customParams[key] = rule;
    }
    const hasCustomParams = Object.keys(customParams).length > 0;
    const privateEmotionMap = sanitizePrivateEmotionMap(
      request.privateEmotionMap,
      parameterIds,
      base.privateEmotionMap ?? {},
      "manual",
      mouthOpenParameterIds
    );
    const hasPrivateEmotionMap = Object.keys(privateEmotionMap).length > 0;
    const derivedBase = { parameterMap, ...(hasCustomParams ? { customParams } : {}) };

    // Preserve the existing source signature verbatim; a manual save must never
    // rehash the model source. The result signature just coerces optional
    // fields to the strict shape using the current context as a fallback.
    const preservedSignature = base.sourceSignature ?? context.signature;
    const resultSignature: Live2DSourceSignature = {
      modelDir: preservedSignature.modelDir ?? context.signature.modelDir,
      model3File: preservedSignature.model3File ?? context.signature.model3File,
      cdi3File: preservedSignature.cdi3File ?? context.signature.cdi3File,
      hash: preservedSignature.hash,
      generatedAt: preservedSignature.generatedAt ?? context.signature.generatedAt
    };

    const profile: ModelProfile = {
      modelId: base.modelId,
      displayName: request.displayName?.trim() || base.displayName,
      version: base.version,
      modelPath: context.webModelPath,
      sourceSignature: preservedSignature,
      autoProfile: {
        provider: "manual",
        promptVersion: base.autoProfile?.promptVersion ?? profileGeneratorVersion,
        generatedAt: new Date().toISOString(),
        notes: ["Manually calibrated profile saved via /profile/save."]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap,
      ...(hasCustomParams ? { customParams } : {}),
      ...(hasPrivateEmotionMap ? { privateEmotionMap } : {}),
      idleConfig: this.sanitizeIdleConfig(request.idleConfig, base.idleConfig, parameterMap),
      reactionBias: base.reactionBias,
      neutralParams: {
        ...deriveNeutralParams(derivedBase),
        ...sanitizeNumericRecord(request.neutralParams, parameterIds)
      },
      parameterSmoothing: deriveParameterSmoothing(derivedBase)
    };

    profile.capabilities = detectCapabilities(profile);

    await this.writeProfile(context.profilePath, profile);

    return {
      generated: true,
      reason: "forced",
      provider: "manual",
      profileUrl: context.webProfilePath,
      modelUrl: context.webModelPath,
      sourceSignature: resultSignature,
      profile,
      notes: [
        "Manual calibration saved.",
        "Existing source signature preserved (not rehashed)."
      ],
      // Provenance is unknown for a manual save; coverage infers per-key
      // confidence from whether targets are standard Cubism ids.
      coverage: computeAdaptationCoverage(profile, context.parameters, {
        modelDir: context.modelDir,
        provider: "manual",
        provenance: undefined
      })
    };
  }

  private async loadContext(modelDirInput: string): Promise<Live2DModelContext> {
    const modelDir = sanitizeModelDir(modelDirInput);
    const directoryPath = path.resolve(this.modelsRoot, modelDir);

    if (!isInside(this.modelsRoot, directoryPath)) {
      throw new Error("modelDir must stay inside the configured models root");
    }

    const entries = await fs.readdir(directoryPath);
    const model3File = entries.find((entry) => entry.toLowerCase().endsWith(".model3.json"));
    if (!model3File) throw new Error(`No .model3.json file found in ${modelDir}`);

    const model3Path = path.join(directoryPath, model3File);
    const model3 = await readJson<Live2DModel3>(model3Path);
    const displayInfo = model3.FileReferences?.DisplayInfo;
    const cdi3File = typeof displayInfo === "string" && displayInfo.trim()
      ? normalizeRelativeFile(displayInfo)
      : entries.find((entry) => entry.toLowerCase().endsWith(".cdi3.json"));
    const cdi3Path = cdi3File ? resolveModelFile(directoryPath, cdi3File) : undefined;
    const cdi3 = cdi3Path ? await readOptionalJson<Live2DCDI3>(cdi3Path) : undefined;
    const profilePath = path.join(directoryPath, "soullink.profile.json");
    const groups = Array.isArray(model3.Groups) ? model3.Groups : [];
    const expressions = model3.FileReferences?.Expressions
      ?.map((expression) => ({
        name: String(expression.Name ?? ""),
        file: String(expression.File ?? "")
      }))
      .filter((expression) => expression.name || expression.file) ?? [];
    const motionGroups = Object.entries(model3.FileReferences?.Motions ?? {})
      .map(([group, motions]) => ({
        group,
        files: Array.isArray(motions)
          ? motions.map((motion) => String(motion.File ?? ""))
          : []
      }))
      .filter((motionGroup) => motionGroup.group || motionGroup.files.some(Boolean));
    const parameters = buildParameterInfo(cdi3);
    const signature = await this.createSignature({
      modelDir,
      directoryPath,
      model3File,
      model3Path,
      cdi3File,
      cdi3Path,
      model3
    });

    return {
      modelDir,
      directoryPath,
      model3File,
      model3Path,
      cdi3File,
      cdi3Path,
      profilePath,
      webModelPath: joinModelsUrl(this.modelsBaseUrl, modelDir, toWebPath(model3File)),
      webProfilePath: joinModelsUrl(this.modelsBaseUrl, modelDir, "soullink.profile.json"),
      model3,
      cdi3,
      parameters,
      groups,
      expressions,
      expressionFiles: expressions,
      motionGroups,
      signature
    };
  }

  private async createSignature(input: {
    modelDir: string;
    directoryPath: string;
    model3File: string;
    model3Path: string;
    cdi3File?: string;
    cdi3Path?: string;
    model3: Live2DModel3;
  }): Promise<Live2DSourceSignature> {
    const hash = createHash("sha256");
    hash.update(`modelDir:${input.modelDir}\n`);
    hash.update(`model3File:${input.model3File}\n`);
    hash.update(await fs.readFile(input.model3Path));

    if (input.cdi3Path) {
      hash.update(`\ncdi3File:${input.cdi3File ?? ""}\n`);
      hash.update(await fs.readFile(input.cdi3Path));
    }

    const moc = input.model3.FileReferences?.Moc;
    if (moc) {
      const mocPath = resolveModelFile(input.directoryPath, moc);
      const stat = await statOptional(mocPath);
      if (stat) hash.update(`\nmoc:${moc}:${stat.size}:${Math.round(stat.mtimeMs)}`);
    }

    for (const expression of input.model3.FileReferences?.Expressions ?? []) {
      if (!expression.File || !expression.File.toLowerCase().endsWith(".exp3.json")) continue;
      try {
        const expressionPath = resolveModelFile(input.directoryPath, expression.File);
        const content = await readOptionalFile(expressionPath);
        if (content) hash.update(`\nexpression:${expression.Name ?? ""}:${expression.File}\n`).update(content);
      } catch {
        // Unresolvable path; skip without throwing.
      }
    }

    // Include motion file mtimes/sizes so stale motion sets invalidate the signature.
    for (const [group, entries] of Object.entries(input.model3.FileReferences?.Motions ?? {})) {
      for (let i = 0; i < entries.length; i++) {
        const file = entries[i]?.File;
        if (!file || !file.toLowerCase().endsWith(".motion3.json")) continue;
        try {
          const motionPath = resolveModelFile(input.directoryPath, file);
          const stat = await statOptional(motionPath);
          if (stat) hash.update(`\nmotion:${group}:${i}:${file}:${stat.size}:${Math.round(stat.mtimeMs)}`);
        } catch {
          // Unresolvable path; skip without throwing.
        }
      }
    }

    return {
      modelDir: input.modelDir,
      model3File: input.model3File,
      cdi3File: input.cdi3File,
      hash: hash.digest("hex"),
      generatedAt: new Date().toISOString()
    };
  }

  private async createHeuristicProfile(
    context: Live2DModelContext,
    displayName?: string,
    provenance: Record<string, MappingSource> = {}
  ): Promise<ModelProfile> {
    const selector = new ParameterSelector(context.parameters);
    const params = context.parameters;
    const groups = context.groups;
    const paramIdSet = new Set(params.map((param) => param.id));
    const map: ParameterMap = {};
    const addRule = (key: FACSKey, rule: ParameterMapRule | undefined) => {
      if (rule) map[key] = rule;
    };

    // Resolution precedence for a single-target key:
    //   model Group -> canonical standard id -> CDI name-needle -> unmapped.
    // resolveStandard covers the first two; nameMatch is the existing selector
    // result. When resolveStandard succeeds its ids equal what the selector's
    // preferred-id path would have returned, so shipped targets are unchanged.
    const resolveSingle = (key: FACSKey, nameMatch: string | undefined): string | undefined => {
      const std = resolveStandard(key, params, groups);
      if (std && std.ids.length) {
        provenance[key] = std.source;
        return std.ids[0];
      }
      if (nameMatch) {
        provenance[key] = "name-match";
        return nameMatch;
      }
      return undefined;
    };

    // Same precedence for pair/multi-target keys.
    const resolveMulti = (key: FACSKey, nameMatch: string[]): string[] => {
      const std = resolveStandard(key, params, groups);
      if (std && std.ids.length) {
        provenance[key] = std.source;
        return std.ids;
      }
      if (nameMatch.length) {
        provenance[key] = "name-match";
        return nameMatch;
      }
      return [];
    };

    // eyeOpen keeps the model-Group-first selector (with its slice(0,2) + >=2
    // threshold) for the actual targets; the source is labelled from the same
    // signals resolveStandard uses so it stays consistent without changing targets.
    const eyeOpen = selector.eyeOpenPair(context.groups);
    const eyeBlinkGroupName = STANDARD_PARAM_TABLE.eyeOpen?.group;
    const blinkGroupIds = (
      groups.find((group) => group.Target === "Parameter" && group.Name === eyeBlinkGroupName)?.Ids ?? []
    ).filter((id) => paramIdSet.has(id));

    const eyeSmile = resolveMulti("eyeSmile", selector.pair(["eyesmile", "eye smile", "微笑"], ["ParamEyeLSmile"], ["ParamEyeRSmile"]));
    const gazeX = resolveSingle("gazeX", selector.one(["eyeballx", "eye x", "眼珠x", "眼球x"], ["ParamEyeBallX"]));
    const gazeY = resolveSingle("gazeY", selector.one(["eyebally", "eye y", "眼珠y", "眼球y"], ["ParamEyeBallY"]));
    const headX = resolveSingle("headX", selector.one(["anglex", "角度x"], ["ParamAngleX"]));
    const headY = resolveSingle("headY", selector.one(["angley", "角度y"], ["ParamAngleY"]));
    const headZ = resolveSingle("headZ", selector.one(["anglez", "角度z"], ["ParamAngleZ"]));
    const bodyX = resolveSingle("bodyX", selector.one(["bodyanglex", "身体旋转x", "身体x"], ["ParamBodyAngleX"]));
    const bodyY = resolveSingle("bodyY", selector.one(["bodyangley", "身体旋转y", "身体y"], ["ParamBodyAngleY"]));
    const bodyZ = resolveSingle("bodyZ", selector.one(["bodyanglez", "身体旋转z", "身体z"], ["ParamBodyAngleZ"]));
    const mouthForm = resolveSingle("mouthSmile", selector.one(["mouthform", "嘴变形", "嘴　变形"], ["ParamMouthForm"]));
    const mouthOpen = resolveSingle("mouthOpen", selector.one(["mouthopeny", "嘴张开", "张开和闭合"], ["ParamMouthOpenY"]));
    const mouthPucker = selector.one(["mouthpucker", "鼓嘴", "嘟嘴"], []);
    const browY = resolveMulti("browInnerUp", selector.pair(["brow", "眉", "上下"], ["ParamBrowLY"], ["ParamBrowRY"]));
    const browAngle = resolveMulti("browOuterUp", selector.pair(["brow", "眉", "angle", "角度"], ["ParamBrowLAngle"], ["ParamBrowRAngle"]));
    const browForm = resolveMulti("browDown", selector.pair(["brow", "眉", "form", "変形", "变形"], ["ParamBrowLForm"], ["ParamBrowRForm"]));

    // Generic "cheek" is deliberately excluded: CheekPuff is a mouth-shape
    // control, while canonical ParamCheek is already covered by the standard table.
    const blushName = selector.many(["blush", "脸红", "脸颊泛红", "腮红"], ["脸黑"]);
    const stdBlush = resolveStandard("blush", params, groups);
    let blush: string[];
    if (stdBlush && stdBlush.ids.length) {
      blush = unique([...blushName, ...stdBlush.ids]);
      provenance.blush = stdBlush.source;
    } else if (blushName.length) {
      blush = blushName;
      provenance.blush = "name-match";
    } else {
      blush = [];
    }

    // tear / sweat are name-only (never in the standard table).
    const tear = selector.many(["tear", "泪", "眼泪"], []);
    if (tear.length) provenance.tear = "name-match";
    const sweat = selector.many(["sweat", "汗"], []);
    if (sweat.length) provenance.sweat = "name-match";
    const breath = resolveSingle("breath", selector.one(["breath", "呼吸"], ["ParamBreath"]));

    // mouthPucker is name-only (empty preferred ids, absent from the table).
    if (mouthPucker) provenance.mouthPucker = "name-match";

    if (eyeOpen.length) {
      provenance.eyeOpen = blinkGroupIds.length >= 2
        ? "standard-group"
        : eyeOpen.every((id) => isStandardId(id)) ? "standard-id" : "name-match";
      addRule("eyeOpen", { targets: eyeOpen, mode: "set", scale: 1, min: 0, max: 1.2 });
      // eyeBlinkL/R and eyeSquint are subtract-derived from the eyeOpen targets.
      if (eyeOpen[0]) {
        addRule("eyeBlinkL", { target: eyeOpen[0], mode: "subtract", scale: 1, min: 0, max: 1.2 });
        provenance.eyeBlinkL = "derived";
      }
      if (eyeOpen[1]) {
        addRule("eyeBlinkR", { target: eyeOpen[1], mode: "subtract", scale: 1, min: 0, max: 1.2 });
        provenance.eyeBlinkR = "derived";
      }
      addRule("eyeSquint", { targets: eyeOpen, mode: "subtract", scale: 0.22, min: 0, max: 1.2 });
      provenance.eyeSquint = "derived";
    }

    addRule("eyeSmile", ruleForTargets(eyeSmile, "set", 1, 0, 1));
    addRule("gazeX", ruleForTarget(gazeX, "set", 1, -1, 1));
    addRule("gazeY", ruleForTarget(gazeY, "set", 1, -1, 1));
    addRule("headX", ruleForTarget(headX, "set", 30, -30, 30));
    addRule("headY", ruleForTarget(headY, "set", 30, -30, 30));
    addRule("headZ", ruleForTarget(headZ, "set", 30, -30, 30));
    addRule("bodyX", ruleForTarget(bodyX, "set", 12, -12, 12));
    addRule("bodyY", ruleForTarget(bodyY, "set", 12, -12, 12));
    addRule("bodyZ", ruleForTarget(bodyZ, "set", 12, -12, 12));
    addRule("mouthSmile", ruleForTarget(mouthForm, "set", 1, -1, 1));
    // mouthFrown reuses the mouthSmile (mouth-form) target as a subtract-derived rule.
    addRule("mouthFrown", ruleForTarget(mouthForm, "subtract", 1, -1, 1));
    if (mouthForm) provenance.mouthFrown = "derived";
    addRule("mouthOpen", ruleForTarget(mouthOpen, "set", 1, 0, 1));
    addRule("mouthPucker", ruleForTarget(mouthPucker, "set", 1, 0, 1));
    addRule("browInnerUp", ruleForTargets(browY, "set", 1, -1, 1));
    addRule("browOuterUp", ruleForTargets(browAngle, "set", 0.9, -1, 1));
    addRule("browDown", ruleForTargets(browForm, "set", -0.85, -1, 1));
    addRule("blush", ruleForTargets(blush, "set", 1, 0, 1));
    addRule("tear", ruleForTargets(tear, "set", 1, 0, 1));
    addRule("sweat", ruleForTargets(sweat, "set", 1, 0, 1));
    addRule("breath", ruleForTarget(breath, "set", 1, 0, 1));

    const privateEmotionMap = buildHeuristicPrivateEmotionMap(params, mappedTargetIds(map));

    const catalogNotes: string[] = [];
    const nativeCatalog = await this.buildNativeAnimationCatalog(context, catalogNotes);
    const expressionMap = this.buildExpressionMap(context, nativeCatalog);
    const nativeAnimationEntries = (nativeCatalog.expressions?.length ?? 0) + (nativeCatalog.motions?.length ?? 0);

    const profile: ModelProfile = {
      modelId: `${sanitizeId(context.modelDir)}_${context.signature.hash.slice(0, 8)}`,
      displayName: displayName?.trim() || context.modelDir,
      version: "1.0.0",
      modelPath: context.webModelPath,
      sourceSignature: context.signature,
      autoProfile: {
        provider: "heuristic",
        promptVersion: profileGeneratorVersion,
        generatedAt: context.signature.generatedAt,
        notes: [
          "Generated from model3/cdi3 parameter names.",
          "LLM may refine this profile when OpenAI-compatible settings are enabled.",
          ...catalogNotes
        ]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap: map,
      ...(Object.keys(privateEmotionMap).length ? { privateEmotionMap } : {}),
      idleConfig: this.createIdleConfig(map),
      reactionBias: {
        shy: {
          blushMultiplier: 1.1,
          gazeAwayMultiplier: 1.05
        },
        happy: {
          mouthSmileMultiplier: 1,
          eyeSmileMultiplier: 1
        }
      },
      neutralParams: deriveNeutralParams({ parameterMap: map }),
      parameterSmoothing: deriveParameterSmoothing({ parameterMap: map }),
      ...(nativeAnimationEntries > 0 ? { nativeAnimations: nativeCatalog } : {}),
      ...(expressionMap ? { expressionMap } : {})
    };

    profile.capabilities = detectCapabilities(profile);
    return profile;
  }

  private async generateWithLLM(
    context: Live2DModelContext,
    heuristic: ModelProfile,
    existing: ModelProfile | undefined,
    openAI?: OpenAIClientOptions
  ): Promise<RawProfile> {
    let lastError: unknown;

    for (const responseFormat of responseFormatFallbacks(profileResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: openAI?.model,
          messages: [
            {
              role: "system",
              content: buildProfileSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify({
                task: "Generate soullink.profile.json for this Live2D model.",
                sourceSignature: context.signature,
                modelPathMustEqual: context.webModelPath,
                cdiParameters: context.parameters,
                model3Groups: context.groups,
                expressions: context.expressions,
                heuristicDraft: heuristic,
                existingProfileReference: existing ?? null,
                canonicalReference: canonicalProfileReference()
              })
            }
          ],
          temperature: 0.18,
          max_tokens: 4500,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }, openAI);

        return parseJSON(completion.choices[0]?.message?.content ?? "") as RawProfile;
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async sanitizeProfile(
    raw: RawProfile | ModelProfile,
    heuristic: ModelProfile,
    context: Live2DModelContext,
    provider: "openai-compatible" | "heuristic"
  ): Promise<ModelProfile> {
    const parameterIds = new Set(context.parameters.map((parameter) => parameter.id));
    const profile = raw as RawProfile;
    const rawMap = profile.parameterMap && typeof profile.parameterMap === "object"
      ? profile.parameterMap as Record<string, unknown>
      : {};
    const parameterMap: ParameterMap = { ...heuristic.parameterMap };

    for (const key of facsKeys) {
      if (
        provider === "openai-compatible" &&
        Object.prototype.hasOwnProperty.call(rawMap, key) &&
        rawMap[key] === null
      ) {
        delete parameterMap[key];
        continue;
      }
      const rule = sanitizeRule(rawMap[key], parameterIds);
      if (rule) parameterMap[key] = rule;
    }

    // Sanitize customParams: preserve rules whose sanitized form is valid
    const rawCustomParams = profile.customParams && typeof profile.customParams === "object" && !Array.isArray(profile.customParams)
      ? profile.customParams as Record<string, unknown>
      : {};
    const customParams: Record<string, ParameterMapRule> = {};
    for (const [key, value] of Object.entries(rawCustomParams)) {
      const rule = sanitizeRule(value, parameterIds);
      if (rule) customParams[key] = rule;
    }
    const hasCustomParams = Object.keys(customParams).length > 0;
    const privateEmotionMap = sanitizePrivateEmotionMap(
      profile.privateEmotionMap,
      parameterIds,
      heuristic.privateEmotionMap ?? {},
      provider === "openai-compatible" ? "llm" : "heuristic",
      new Set(context.parameters.filter(isMouthOpenLive2DParameter).map((parameter) => parameter.id))
    );
    const hasPrivateEmotionMap = Object.keys(privateEmotionMap).length > 0;

    const derivedBase = { parameterMap, ...(hasCustomParams ? { customParams } : {}) };

    // C5-T5: nativeAnimations is ALWAYS rebuilt from real files — do not trust
    // the raw value (LLM may inject fake paths). expressionMap entries are
    // validated against the real catalog so LLM can refine but not hallucinate.
    const catalogNotes: string[] = [];
    const nativeCatalog = await this.buildNativeAnimationCatalog(context, catalogNotes);
    const nativeAnimationEntries = (nativeCatalog.expressions?.length ?? 0) + (nativeCatalog.motions?.length ?? 0);

    const catalogExpressionNames = new Set((nativeCatalog.expressions ?? []).map((e) => e.name));
    const rawExpressionMap = profile.expressionMap && typeof profile.expressionMap === "object" && !Array.isArray(profile.expressionMap)
      ? profile.expressionMap as Record<string, unknown>
      : {};
    const expressionMap: Record<string, ExpressionBinding | string> = {};
    for (const [key, value] of Object.entries(rawExpressionMap)) {
      if (typeof key !== "string") continue;
      if (typeof value === "string") {
        // Simple string: expression name must be in catalog
        if (catalogExpressionNames.has(value)) {
          expressionMap[key] = value;
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const exprName = typeof record.expression === "string" ? record.expression : undefined;
        if (exprName && catalogExpressionNames.has(exprName)) {
          const minIntensity = typeof record.minIntensity === "number" && Number.isFinite(record.minIntensity)
            && record.minIntensity >= 0 && record.minIntensity <= 1
            ? record.minIntensity
            : undefined;
          expressionMap[key] = {
            expression: exprName,
            ...(minIntensity !== undefined ? { minIntensity } : {})
          };
        }
      }
    }
    const hasExpressionMap = Object.keys(expressionMap).length > 0;

    const rawMotionMap = profile.motionMap && typeof profile.motionMap === "object" && !Array.isArray(profile.motionMap)
      ? profile.motionMap as Record<string, unknown>
      : {};
    const motionMap: Record<string, MotionBinding> = {};
    const catalogMotions = nativeCatalog.motions ?? [];
    for (const [key, value] of Object.entries(rawMotionMap)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const group = typeof record.group === "string" && record.group.trim() ? record.group.trim() : undefined;
      const index = typeof record.index === "number" && Number.isInteger(record.index) && record.index >= 0
        ? record.index
        : undefined;
      if (!group) continue;
      const exists = catalogMotions.some((motion) => (
        motion.group === group && (index === undefined || motion.index === index)
      ));
      if (!exists) continue;
      const priority = isMotionPriority(record.priority) ? record.priority : undefined;
      motionMap[key] = {
        group,
        ...(index !== undefined ? { index } : {}),
        ...(priority ? { priority } : {})
      };
    }
    const hasMotionMap = Object.keys(motionMap).length > 0;

    const result: ModelProfile = {
      modelId: stringOr(profile.modelId, heuristic.modelId),
      displayName: stringOr(profile.displayName, heuristic.displayName),
      version: stringOr(profile.version, heuristic.version),
      modelPath: context.webModelPath,
      sourceSignature: context.signature,
      autoProfile: {
        provider,
        promptVersion: profileGeneratorVersion,
        generatedAt: context.signature.generatedAt,
        notes: [
          ...(provider === "openai-compatible"
            ? ["Generated with LLM and validated against actual CDI parameters."]
            : heuristic.autoProfile?.notes ?? []),
          ...catalogNotes
        ]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap,
      ...(hasCustomParams ? { customParams } : {}),
      ...(hasPrivateEmotionMap ? { privateEmotionMap } : {}),
      idleConfig: this.sanitizeIdleConfig(profile.idleConfig, heuristic.idleConfig, parameterMap),
      reactionBias: profile.reactionBias && typeof profile.reactionBias === "object"
        ? profile.reactionBias as Record<string, Record<string, number>>
        : heuristic.reactionBias,
      neutralParams: {
        ...deriveNeutralParams(derivedBase),
        ...sanitizeNumericRecord(profile.neutralParams, parameterIds)
      },
      parameterSmoothing: {
        ...deriveParameterSmoothing(derivedBase),
        ...sanitizeNumericRecord(profile.parameterSmoothing, parameterIds)
      },
      ...(nativeAnimationEntries > 0 ? { nativeAnimations: nativeCatalog } : {}),
      ...(hasExpressionMap ? { expressionMap } : {}),
      ...(hasMotionMap ? { motionMap } : {})
    };

    result.capabilities = detectCapabilities(result);
    return result;
  }

  /**
   * C5-T4/C5-T6: Scan expression (.exp3.json) and motion (.motion3.json) files
   * from the model directory and build the NativeAnimationCatalog. All file paths
   * are validated with isInside before access. Files > 256 KB, paths outside the
   * model directory, or unexpected extensions are skipped with a note in the
   * provided notes array.
   */
  private async buildNativeAnimationCatalog(
    context: Live2DModelContext,
    notes: string[] = []
  ): Promise<NativeAnimationCatalog> {
    const MAX_EXPRESSIONS = 64;
    const MAX_MOTIONS = 256;
    const MAX_EXP_BYTES = 256 * 1024;

    const expressions: NativeExpressionEntry[] = [];

    for (const { name, file } of context.expressionFiles) {
      if (expressions.length >= MAX_EXPRESSIONS) {
        notes.push(`Expression limit (${MAX_EXPRESSIONS}) reached; skipping remaining expression files.`);
        break;
      }
      if (!file || !file.toLowerCase().endsWith(".exp3.json")) continue;
      try {
        const resolved = path.resolve(context.directoryPath, normalizeRelativeFile(file));
        if (!isInside(context.directoryPath, resolved)) {
          notes.push(`Expression file "${file}" escapes model directory; skipped.`);
          continue;
        }
        const stat = await statOptional(resolved);
        if (!stat) continue;
        if (stat.size > MAX_EXP_BYTES) {
          notes.push(`Expression file "${file}" skipped (${stat.size} bytes exceeds 256 KB limit).`);
          continue;
        }
        const raw = await readOptionalFile(resolved);
        if (!raw) continue;
        interface Exp3Json { Parameters?: Array<{ Id?: unknown; Value?: unknown }> }
        const exp3 = JSON.parse(raw.toString("utf8")) as Exp3Json;
        const params: string[] = [];
        for (const param of exp3.Parameters ?? []) {
          if (
            typeof param.Id === "string" &&
            param.Id &&
            typeof param.Value === "number" &&
            param.Value !== 0
          ) {
            params.push(param.Id);
          }
        }
        expressions.push({ name, file, ...(params.length ? { params } : {}) });
      } catch {
        notes.push(`Failed to process expression file "${file}"; skipped.`);
      }
    }

    const motions: Array<{ group: string; index: number; file: string }> = [];
    const motionsRecord = context.model3.FileReferences?.Motions ?? {};

    outer: for (const [group, entries] of Object.entries(motionsRecord)) {
      if (!Array.isArray(entries)) continue;
      for (let index = 0; index < entries.length; index++) {
        if (motions.length >= MAX_MOTIONS) {
          notes.push(`Motion limit (${MAX_MOTIONS}) reached; skipping remaining motion entries.`);
          break outer;
        }
        const file = entries[index]?.File;
        if (!file || typeof file !== "string") continue;
        if (!file.toLowerCase().endsWith(".motion3.json")) continue;
        try {
          const resolved = resolveModelFile(context.directoryPath, file);
          if (!isInside(context.directoryPath, resolved)) {
            notes.push(`Motion file "${file}" (group "${group}", index ${index}) escapes model directory; skipped.`);
            continue;
          }
          motions.push({ group, index, file });
        } catch {
          notes.push(`Motion file "${file}" (group "${group}", index ${index}) failed path check; skipped.`);
        }
      }
    }

    return {
      ...(expressions.length ? { expressions } : {}),
      ...(motions.length ? { motions } : {})
    };
  }

  /**
   * C5-T4: Heuristic name->emotion mapping. Returns a Record keyed by emotion
   * name whose values are the best-matching expression name from the catalog.
   * Returns undefined when no expression maps to any known emotion.
   */
  private buildExpressionMap(
    _context: Live2DModelContext,
    catalog: NativeAnimationCatalog
  ): Record<string, ExpressionBinding | string> | undefined {
    const expressionList = catalog.expressions ?? [];
    if (!expressionList.length) return undefined;

    const emotionHeuristics: Array<[string[], string]> = [
      [["blush", "脸红", "embarrassed"], "shy"],
      [["angry", "怒", "anger"], "angry"],
      [["tears", "泪", "tear", "cry", "sad", "悲"], "sad"],
      [["loveeyes", "love", "爱", "heart"], "affectionate"],
      [["stars", "excited", "star", "兴奋"], "excited"],
      [["confused", "幽灵", "ghost"], "confused"],
      [["smile", "happy", "开心"], "happy"],
      [["surprised", "惊", "wow"], "surprised"]
    ];

    // Sort by file path for deterministic first-file-alphabetically semantics
    // when multiple expressions match the same emotion.
    const sorted = [...expressionList].sort((a, b) => a.file.localeCompare(b.file));

    const result: Record<string, ExpressionBinding | string> = {};
    const emotionClaimed = new Set<string>();

    for (const { name } of sorted) {
      const normalized = normalizeText(name);
      for (const [needles, emotion] of emotionHeuristics) {
        if (emotionClaimed.has(emotion)) continue;
        if (needles.some((needle) => normalized.includes(normalizeText(needle)))) {
          result[emotion] = name;
          emotionClaimed.add(emotion);
          break;
        }
      }
    }

    return Object.keys(result).length ? result : undefined;
  }

  private createIdleConfig(map: ParameterMap): ModelProfile["idleConfig"] {
    const idleConfig: ModelProfile["idleConfig"] = {};
    if (map.gazeX) idleConfig.gazeX = [-0.12, 0.12];
    if (map.gazeY) idleConfig.gazeY = [-0.06, 0.08];
    if (map.headX) idleConfig.headX = [-0.08, 0.08];
    if (map.headY) idleConfig.headY = [-0.04, 0.04];
    if (map.headZ) idleConfig.headZ = [-0.05, 0.05];
    if (map.bodyX) idleConfig.bodyX = [-0.045, 0.045];
    if (map.bodyY) idleConfig.bodyY = [-0.014, 0.014];
    if (map.bodyZ) idleConfig.bodyZ = [-0.055, 0.055];
    if (map.mouthSmile) idleConfig.mouthSmile = [0.02, 0.1];
    if (map.browInnerUp) idleConfig.browInnerUp = [0, 0.06];
    if (map.eyeOpen) idleConfig.eyeOpen = [0.9, 1];
    return idleConfig;
  }

  private sanitizeIdleConfig(
    raw: unknown,
    fallback: ModelProfile["idleConfig"],
    map: ParameterMap
  ): ModelProfile["idleConfig"] {
    if (!raw || typeof raw !== "object") return fallback;
    const record = raw as Record<string, unknown>;
    const result: ModelProfile["idleConfig"] = { ...fallback };

    for (const key of facsKeys) {
      if (!map[key]) continue;
      const value = record[key];
      if (!Array.isArray(value) || value.length !== 2) continue;
      const min = typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : undefined;
      const max = typeof value[1] === "number" && Number.isFinite(value[1]) ? value[1] : undefined;
      if (min === undefined || max === undefined || min > max) continue;
      result[key] = [min, max];
    }

    return result;
  }

  private async readExistingProfile(profilePath: string): Promise<ModelProfile | undefined> {
    return await readOptionalJson<ModelProfile>(profilePath);
  }

  private async writeProfile(profilePath: string, profile: ModelProfile) {
    const temporaryPath = `${profilePath}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, profilePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }
}

class ParameterSelector {
  private byId = new Map<string, Live2DParameterInfo>();

  constructor(private parameters: Live2DParameterInfo[]) {
    for (const parameter of parameters) {
      this.byId.set(parameter.id, parameter);
    }
  }

  eyeOpenPair(groups: Live2DModelGroup[]): string[] {
    const blinkGroup = groups.find((group) => group.Target === "Parameter" && group.Name === "EyeBlink");
    const ids = blinkGroup?.Ids?.filter((id) => this.byId.has(id)) ?? [];
    if (ids.length >= 2) return ids.slice(0, 2);

    return this.pair(["eyeopen", "开闭"], ["ParamEyeLOpen"], ["ParamEyeROpen"]);
  }

  pair(sharedNeedles: string[], leftIds: string[], rightIds: string[]): string[] {
    const left = this.preferred(leftIds) ?? this.bestMatch([sharedNeedles, ["left", "左", " l"]]);
    const right = this.preferred(rightIds) ?? this.bestMatch([sharedNeedles, ["right", "右", " r"]]);
    return [left, right].filter((id): id is string => Boolean(id));
  }

  one(needles: string[], preferredIds: string[]): string | undefined {
    return this.preferred(preferredIds) ?? this.bestMatch([needles]);
  }

  many(needles: string[], exclusions: string[]): string[] {
    const normalizedExclusions = exclusions.map(normalizeText).filter(Boolean);
    const result: string[] = [];

    for (const parameter of this.parameters) {
      const haystack = normalizeText(`${parameter.id} ${parameter.name} ${parameter.groupName}`);
      if (normalizedExclusions.some((needle) => haystack.includes(needle))) continue;
      if (needles.some((needle) => matchesSemanticNeedle(parameter, needle))) result.push(parameter.id);
    }

    return unique(result).slice(0, 4);
  }

  private preferred(ids: string[]): string | undefined {
    return ids.find((id) => this.byId.has(id));
  }

  private bestMatch(needleGroups: string[][]): string | undefined {
    let best: { id: string; score: number } | undefined;

    for (const parameter of this.parameters) {
      const groupScores = needleGroups.map((needles) => (
        needles.filter((needle) => matchesSelectorNeedle(parameter, needle)).length
      ));
      if (groupScores.some((score) => score === 0)) continue;
      const score = groupScores.reduce((sum, value) => sum + value, 0);
      if (!best || score > best.score) best = { id: parameter.id, score };
    }

    return best?.id;
  }
}

function mappedTargetIds(map: ParameterMap): Set<string> {
  const result = new Set<string>();
  for (const rule of Object.values(map)) {
    if (rule?.target) result.add(rule.target);
    for (const target of rule?.targets ?? []) result.add(target);
  }
  return result;
}

function buildHeuristicPrivateEmotionMap(
  parameters: Live2DParameterInfo[],
  excludedIds: ReadonlySet<string>
): PrivateEmotionMap {
  const definitions: Array<{
    key: string;
    category: PrivateEmotionCategory;
    needles: string[];
    emotions?: string[];
    priority: number;
    confidence: number;
    exclusiveGroup?: string;
  }> = [
    {
      key: "positiveEye",
      category: "positiveEye",
      needles: ["爱心眼", "星星眼", "heart eye", "love eye", "star eye", "sparkle eye"],
      priority: 90,
      confidence: 0.94,
      exclusiveGroup: "face-effect"
    },
    {
      key: "confusionEffect",
      category: "privateEffect",
      needles: ["困惑", "疑问", "confused", "confusion", "question mark"],
      emotions: ["confused"],
      priority: 95,
      confidence: 0.96,
      exclusiveGroup: "face-effect"
    },
    {
      key: "angerEffect",
      category: "anger",
      needles: ["生气", "愤怒", "怒", "angry", "anger", "mad"],
      priority: 90,
      confidence: 0.95,
      exclusiveGroup: "face-effect"
    },
    {
      key: "shadowEffect",
      category: "shadow",
      needles: ["脸黑", "黑脸", "阴影", "shadow", "dark face"],
      priority: 80,
      confidence: 0.94,
      exclusiveGroup: "face-effect"
    },
    {
      key: "surpriseEffect",
      category: "surprise",
      needles: ["惊讶", "震惊", "surprise", "shock"],
      priority: 80,
      confidence: 0.92,
      exclusiveGroup: "face-effect"
    },
    {
      key: "starEffect",
      category: "privateEffect",
      needles: ["星星", "star", "sparkle"],
      emotions: ["excited", "happy", "surprised"],
      priority: 70,
      confidence: 0.82,
      exclusiveGroup: "face-effect"
    }
  ];
  const result: PrivateEmotionMap = {};
  const claimed = new Set<string>();

  for (const definition of definitions) {
    const targets = parameters
      .filter((parameter) => !excludedIds.has(parameter.id) && !claimed.has(parameter.id))
      .filter((parameter) => definition.needles.some((needle) => matchesSemanticNeedle(parameter, needle)))
      .map((parameter) => parameter.id)
      .slice(0, 4);
    if (!targets.length) continue;
    targets.forEach((target) => claimed.add(target));
    result[definition.key] = {
      targets,
      category: definition.category,
      ...(definition.emotions ? { emotions: definition.emotions } : {}),
      ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
      priority: definition.priority,
      source: "heuristic",
      confidence: definition.confidence
    };
  }

  return result;
}

function buildProfileSystemPrompt(): string {
  return [
    "You are a Live2D Cubism parameter adapter engineer for SoullinkLive.",
    "Your job is to generate a maintainable soullink.profile.json that maps high-level FACS-like emotion keys to actual Live2D parameter IDs.",
    "",
    "Critical rules:",
    "1. Return JSON only. No markdown, no comments.",
    "2. Do not invent parameter IDs. Every target/targets entry must be selected from cdiParameters.id.",
    "3. Keep modelPath exactly equal to modelPathMustEqual.",
    "4. Prefer the heuristicDraft unless CDI parameter names clearly prove a better mapping.",
    "5. If a heuristic FACS mapping is clearly wrong, set that parameterMap key to null to delete it. Otherwise omit uncertain additions.",
    "6. Do not map cosmetic toggles, props, clothing, or hand poses to facial FACS unless their name clearly means the facial effect.",
    "7. Use stable Live2D conventions: eyeOpen is set to eye open params, eyeBlinkL/R subtract from each eye open param, mouthOpen uses mouth-open-y, mouthSmile/mouthFrown use mouth form when available.",
    "8. Directional keys gazeX/gazeY/headX/headY/headZ/bodyX/bodyY/bodyZ use signed ranges. Visual effect keys use 0..1 ranges.",
    "9. neutralParams should include every mapped target. Use eye open = 1, breath = 0.5, most others = 0 unless the reference says otherwise.",
    "10. parameterSmoothing should be modest: mouth/eyes fast, head/body medium, blush/tear/sweat slow.",
    "11. When adding model-specific controls outside the supported FACS keys, put them in customParams with validated target/targets entries.",
    "12. Use privateEmotionMap for semantic effect parameters that should react automatically to VAD/emotion, such as confused, anger symbols, stars, shadows, or surprise effects.",
    "13. privateEmotionMap must never target mouth-open/jaw-open parameters. Use emotions and/or vadRange for model-specific triggers, and an exclusiveGroup for mutually exclusive face effects.",
    "",
    `Supported FACS keys: ${facsKeys.join(", ")}.`,
    "ParameterMapRule format: { target?: string, targets?: string[], mode?: 'set'|'add'|'subtract'|'inverse', scale?: number, offset?: number, min?: number, max?: number, curve?: 'linear'|'easeIn'|'easeOut'|'easeInOut'|'smoothstep', gamma?: number, deadzone?: number, inputRange?: [number, number], outputRange?: [number, number], invertAround?: number }.",
    "PrivateEmotionMapping format: { target?: string, targets?: string[], category?: 'positiveEye'|'blush'|'tear'|'shadow'|'anger'|'sweat'|'surprise'|'privateEffect', emotions?: string[], vadRange?: { valence?: [number,number], arousal?: [number,number], dominance?: [number,number] }, triggerMode?: 'any'|'all', activeValue?: number, neutralValue?: number, intensity?: number, priority?: number, exclusiveGroup?: string, confidence?: number }.",
    "Output a complete ModelProfile object with schemaVersion, modelId, displayName, version, modelPath, capabilities, parameterMap, optional customParams/privateEmotionMap, idleConfig, neutralParams, parameterSmoothing, and optional reactionBias."
  ].join("\n");
}

function canonicalProfileReference() {
  return {
    purpose: "Reference style based on the known LilyaBee adapter. Use as guidance, not as fixed parameter IDs for other models.",
    commonMappings: {
      eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], mode: "set", scale: 1, min: 0, max: 1.2 },
      eyeBlinkL: { target: "ParamEyeLOpen", mode: "subtract", scale: 1, min: 0, max: 1.2 },
      eyeBlinkR: { target: "ParamEyeROpen", mode: "subtract", scale: 1, min: 0, max: 1.2 },
      gazeX: { target: "ParamEyeBallX", mode: "set", scale: 1, min: -1, max: 1 },
      gazeY: { target: "ParamEyeBallY", mode: "set", scale: 1, min: -1, max: 1 },
      headX: { target: "ParamAngleX", mode: "set", scale: 30, min: -30, max: 30 },
      headY: { target: "ParamAngleY", mode: "set", scale: 30, min: -30, max: 30 },
      headZ: { target: "ParamAngleZ", mode: "set", scale: 30, min: -30, max: 30 },
      bodyX: { target: "ParamBodyAngleX", mode: "set", scale: 12, min: -12, max: 12 },
      bodyY: { target: "ParamBodyAngleY", mode: "set", scale: 12, min: -12, max: 12 },
      bodyZ: { target: "ParamBodyAngleZ", mode: "set", scale: 12, min: -12, max: 12 },
      mouthSmile: { target: "ParamMouthForm", mode: "set", scale: 1, min: -1, max: 1 },
      mouthFrown: { target: "ParamMouthForm", mode: "subtract", scale: 1, min: -1, max: 1 },
      mouthOpen: { target: "ParamMouthOpenY", mode: "set", scale: 1, min: 0, max: 1 },
      blush: "Map only to params named blush/cheek/脸红/脸颊泛红.",
      tear: "Map only to params named tear/眼泪/泪.",
      sweat: "Map only to params named sweat/汗."
    },
    privateEmotionExamples: {
      confusionEffect: {
        targets: ["ParamWithConfusedDisplayName"],
        category: "privateEffect",
        emotions: ["confused"],
        exclusiveGroup: "face-effect"
      }
    }
  };
}

function responseFormatFallbacks(schema: OpenAIJsonSchemaResponseFormat): Array<OpenAIResponseFormat | undefined> {
  return [
    schema,
    { type: "json_object" },
    undefined
  ];
}

function shouldUseLLM(openAI: OpenAIClientOptions | undefined, useConfiguredOpenAI: boolean): boolean {
  if (openAI?.apiKey?.trim()) return true;
  return useConfiguredOpenAI;
}

const mapRuleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    targets: {
      type: "array",
      items: { type: "string" }
    },
    mode: {
      type: "string",
      enum: ["set", "add", "subtract", "inverse"]
    },
    scale: { type: "number" },
    offset: { type: "number" },
    min: { type: "number" },
    max: { type: "number" },
    curve: {
      type: "string",
      enum: ["linear", "easeIn", "easeOut", "easeInOut", "smoothstep"]
    },
    gamma: { type: "number" },
    deadzone: { type: "number" },
    inputRange: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" }
    },
    outputRange: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" }
    },
    invertAround: { type: "number" }
  }
} as const;

const parameterMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(facsKeys.map((key) => [key, {
    oneOf: [mapRuleSchema, { type: "null" }]
  }]))
} as const;

const privateEmotionMappingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    targets: { type: "array", items: { type: "string" } },
    category: {
      type: "string",
      enum: ["positiveEye", "blush", "tear", "shadow", "anger", "sweat", "surprise", "privateEffect"]
    },
    emotions: { type: "array", items: { type: "string" } },
    vadRange: {
      type: "object",
      additionalProperties: false,
      properties: {
        valence: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
        arousal: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
        dominance: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } }
      }
    },
    triggerMode: { type: "string", enum: ["any", "all"] },
    activeValue: { type: "number" },
    neutralValue: { type: "number" },
    intensity: { type: "number", minimum: 0, maximum: 1 },
    priority: { type: "number" },
    exclusiveGroup: { type: "string" },
    source: { type: "string", enum: ["heuristic", "llm", "manual"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

const profileResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_live2d_profile",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      required: ["modelId", "displayName", "version", "modelPath", "capabilities", "parameterMap", "idleConfig", "neutralParams", "parameterSmoothing"],
      properties: {
        modelId: { type: "string" },
        displayName: { type: "string" },
        version: { type: "string" },
        modelPath: { type: "string" },
        capabilities: {
          type: "object",
          additionalProperties: { type: "boolean" }
        },
        schemaVersion: { type: "number" },
        parameterMap: parameterMapSchema,
        customParams: {
          type: "object",
          additionalProperties: mapRuleSchema
        },
        privateEmotionMap: {
          type: "object",
          additionalProperties: {
            oneOf: [privateEmotionMappingSchema, { type: "null" }]
          }
        },
        idleConfig: {
          type: "object",
          additionalProperties: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "number" }
          }
        },
        neutralParams: {
          type: "object",
          additionalProperties: { type: "number" }
        },
        parameterSmoothing: {
          type: "object",
          additionalProperties: { type: "number" }
        },
        reactionBias: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: { type: "number" }
          }
        },
        expressionMap: {
          type: "object",
          additionalProperties: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  expression: { type: "string" },
                  minIntensity: { type: "number" }
                },
                required: ["expression"]
              }
            ]
          }
        },
        nativeAnimations: {
          type: "object",
          properties: {
            expressions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  file: { type: "string" },
                  params: { type: "array", items: { type: "string" } }
                },
                required: ["name", "file"]
              }
            },
            motions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  group: { type: "string" },
                  index: { type: "number" },
                  file: { type: "string" }
                },
                required: ["group", "index", "file"]
              }
            }
          }
        },
        motionMap: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              group: { type: "string" },
              index: { type: "number" },
              priority: { type: "string", enum: ["idle", "normal", "force"] }
            },
            required: ["group"]
          }
        }
      }
    }
  }
};

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return undefined;
  }
}

async function readOptionalFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return undefined;
  }
}

async function statOptional(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

function parseJSON(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("LLM returned empty content");

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 160)}`);
  }
}

function buildParameterInfo(cdi3?: Live2DCDI3): Live2DParameterInfo[] {
  const groups = new Map<string, string>();
  for (const group of cdi3?.ParameterGroups ?? []) {
    if (group.Id) groups.set(group.Id, group.Name ?? "");
  }

  return (cdi3?.Parameters ?? [])
    .filter((parameter): parameter is { Id: string; Name?: string; GroupId?: string } => Boolean(parameter.Id))
    .map((parameter) => ({
      id: parameter.Id,
      name: parameter.Name ?? "",
      groupId: parameter.GroupId ?? "",
      groupName: parameter.GroupId ? groups.get(parameter.GroupId) ?? "" : ""
    }));
}

function ruleForTarget(
  target: string | undefined,
  mode: ParameterMapRule["mode"],
  scale: number,
  min: number,
  max: number
): ParameterMapRule | undefined {
  return target ? { target, mode, scale, min, max } : undefined;
}

function ruleForTargets(
  targets: string[],
  mode: ParameterMapRule["mode"],
  scale: number,
  min: number,
  max: number
): ParameterMapRule | undefined {
  const uniqueTargets = unique(targets);
  return uniqueTargets.length ? { targets: uniqueTargets, mode, scale, min, max } : undefined;
}

function sanitizePrivateEmotionMap(
  value: unknown,
  allowedTargets: Set<string>,
  fallback: PrivateEmotionMap,
  source: NonNullable<PrivateEmotionMapping["source"]>,
  blockedTargets: ReadonlySet<string> = new Set()
): PrivateEmotionMap {
  const result: PrivateEmotionMap = { ...fallback };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;

  for (const [rawKey, rawMapping] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim().slice(0, 80);
    if (!key) continue;
    if (rawMapping === null) {
      delete result[key];
      continue;
    }
    const mapping = sanitizePrivateEmotionMapping(rawMapping, allowedTargets, source, blockedTargets);
    if (mapping) result[key] = mapping;
  }

  return result;
}

function sanitizePrivateEmotionMapping(
  value: unknown,
  allowedTargets: Set<string>,
  source: NonNullable<PrivateEmotionMapping["source"]>,
  blockedTargets: ReadonlySet<string>
): PrivateEmotionMapping | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const target = typeof record.target === "string" && allowedTargets.has(record.target) && !blockedTargets.has(record.target)
    ? record.target
    : undefined;
  const targets = Array.isArray(record.targets)
    ? unique(record.targets.filter((entry): entry is string => (
      typeof entry === "string" && allowedTargets.has(entry) && !blockedTargets.has(entry)
    )))
    : [];
  if (!target && targets.length === 0) return undefined;

  const category = isPrivateEmotionCategory(record.category) ? record.category : undefined;
  const emotions = Array.isArray(record.emotions)
    ? unique(record.emotions
      .filter((emotion): emotion is string => typeof emotion === "string" && Boolean(emotion.trim()))
      .map((emotion) => emotion.trim().slice(0, 48)))
      .slice(0, 16)
    : [];
  const vadRange = sanitizePrivateEmotionVADRange(record.vadRange);
  const triggerMode = record.triggerMode === "all" ? "all" : record.triggerMode === "any" ? "any" : undefined;
  const activeValue = finiteOptionalNumber(record.activeValue);
  const neutralValue = finiteOptionalNumber(record.neutralValue);
  const intensity = boundedOptionalNumber(record.intensity, 0, 1);
  const priority = boundedOptionalNumber(record.priority, -1000, 1000);
  const exclusiveGroup = typeof record.exclusiveGroup === "string" && record.exclusiveGroup.trim()
    ? record.exclusiveGroup.trim().slice(0, 80)
    : undefined;
  const confidence = boundedOptionalNumber(record.confidence, 0, 1)
    ?? (source === "llm" ? 0.65 : source === "manual" ? 1 : 0.8);

  return {
    ...(target ? { target } : {}),
    ...(targets.length ? { targets } : {}),
    category: category ?? "privateEffect",
    ...(emotions.length ? { emotions } : {}),
    ...(vadRange ? { vadRange } : {}),
    ...(triggerMode ? { triggerMode } : {}),
    ...(activeValue !== undefined ? { activeValue } : {}),
    ...(neutralValue !== undefined ? { neutralValue } : {}),
    ...(intensity !== undefined ? { intensity } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(exclusiveGroup ? { exclusiveGroup } : {}),
    source,
    confidence
  };
}

function sanitizePrivateEmotionVADRange(value: unknown): PrivateEmotionMapping["vadRange"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result: NonNullable<PrivateEmotionMapping["vadRange"]> = {};
  for (const axis of ["valence", "arousal", "dominance"] as const) {
    const pair = finiteNumberPair(record[axis]);
    if (!pair) continue;
    const first = Math.max(-1, Math.min(1, pair[0]));
    const second = Math.max(-1, Math.min(1, pair[1]));
    result[axis] = [Math.min(first, second), Math.max(first, second)];
  }
  return Object.keys(result).length ? result : undefined;
}

function isPrivateEmotionCategory(value: unknown): value is PrivateEmotionCategory {
  return [
    "positiveEye", "blush", "tear", "shadow", "anger", "sweat", "surprise", "privateEffect"
  ].includes(String(value));
}

function boundedOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const number = finiteOptionalNumber(value);
  return number === undefined ? undefined : Math.max(min, Math.min(max, number));
}

function sanitizeRule(value: unknown, allowedTargets: Set<string>): ParameterMapRule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const target = typeof record.target === "string" && allowedTargets.has(record.target) ? record.target : undefined;
  const targets = Array.isArray(record.targets)
    ? unique(record.targets.filter((item): item is string => typeof item === "string" && allowedTargets.has(item)))
    : [];

  if (!target && targets.length === 0) return undefined;

  const mode = isBlendMode(record.mode) ? record.mode : "set";
  const scale = finiteNumber(record.scale, 1);
  const offset = finiteOptionalNumber(record.offset);
  const min = finiteOptionalNumber(record.min);
  const max = finiteOptionalNumber(record.max);
  const curve = isCurve(record.curve) ? record.curve : undefined;
  const gamma = typeof record.gamma === "number" && Number.isFinite(record.gamma) && record.gamma > 0 ? record.gamma : undefined;
  const deadzone = typeof record.deadzone === "number" && Number.isFinite(record.deadzone) && record.deadzone >= 0 ? record.deadzone : undefined;
  const inputRange = finiteNumberPair(record.inputRange);
  const outputRange = finiteNumberPair(record.outputRange);
  const invertAround = finiteOptionalNumber(record.invertAround);

  return {
    ...(target ? { target } : {}),
    ...(targets.length ? { targets } : {}),
    mode,
    scale,
    ...(offset !== undefined ? { offset } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(curve !== undefined ? { curve } : {}),
    ...(gamma !== undefined ? { gamma } : {}),
    ...(deadzone !== undefined ? { deadzone } : {}),
    ...(inputRange !== undefined ? { inputRange } : {}),
    ...(outputRange !== undefined ? { outputRange } : {}),
    ...(invertAround !== undefined ? { invertAround } : {})
  };
}

function sanitizeNumericRecord(value: unknown, allowedKeys: Set<string>): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (allowedKeys.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }

  return result;
}

function isBlendMode(value: unknown): value is ParameterMapRule["mode"] {
  return value === "set" || value === "add" || value === "subtract" || value === "inverse";
}

function isCurve(value: unknown): value is NonNullable<ParameterMapRule["curve"]> {
  return value === "linear" || value === "easeIn" || value === "easeOut" || value === "easeInOut" || value === "smoothstep";
}

function isMotionPriority(value: unknown): value is NonNullable<MotionBinding["priority"]> {
  return value === "idle" || value === "normal" || value === "force";
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteNumberPair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const first = finiteOptionalNumber(value[0]);
  const second = finiteOptionalNumber(value[1]);
  return first !== undefined && second !== undefined ? [first, second] : undefined;
}

function emptyCapabilities(): ModelProfile["capabilities"] {
  return {
    headControl: false,
    bodyControl: false,
    eyeBlink: false,
    eyeSmile: false,
    gazeControl: false,
    mouthOpen: false,
    mouthSmile: false,
    browControl: false,
    blush: false,
    tear: false,
    sweat: false,
    breath: false
  };
}

function sanitizeModelDir(input: string): string {
  const normalized = input.trim() || "lilyabee";
  if (!/^[a-zA-Z0-9_-]+$/u.test(normalized)) {
    throw new Error("modelDir may only contain letters, numbers, underscore, and dash");
  }

  return normalized;
}

function sanitizeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/gu, "_").toLowerCase();
}

function normalizeRelativeFile(input: string): string {
  return input.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function resolveModelFile(directoryPath: string, relativeFile: string): string {
  const resolved = path.resolve(directoryPath, normalizeRelativeFile(relativeFile));
  if (!isInside(directoryPath, resolved)) {
    throw new Error(`Model file reference escapes its model directory: ${relativeFile}`);
  }

  return resolved;
}

function normalizeText(input: string): string {
  return input
    .replace(/\s+/gu, "")
    .replace(/[＿_\-　]/gu, "")
    .toLowerCase();
}

function isMouthOpenLive2DParameter(parameter: Live2DParameterInfo): boolean {
  const idAndName = normalizeText(`${parameter.id} ${parameter.name}`);
  if ([
    "mouthform", "mouthshape", "lipshape", "lipform", "liptype",
    "嘴型", "口型", "唇形", "唇型"
  ].some((hint) => idAndName.includes(normalizeText(hint)))) return false;

  return [
    "mouthopen", "openmouth", "jawopen", "openjaw",
    "嘴张开", "张嘴", "嘴巴开合", "嘴开合", "口部开合", "下颌开合"
  ].some((hint) => idAndName.includes(normalizeText(hint)));
}

function matchesSemanticNeedle(parameter: Live2DParameterInfo, rawNeedle: string): boolean {
  const needle = normalizeText(rawNeedle);
  if (!needle) return false;
  const fields = [parameter.id, parameter.name, parameter.groupName].filter(Boolean);

  // CJK labels do not have word boundaries, so a normalized substring is the
  // most useful signal. ASCII labels use camel-case/word tokens to avoid cases
  // such as CatEar accidentally matching "tear".
  if (/[^\u0000-\u007f]/u.test(needle)) {
    return fields.some((field) => normalizeText(field).includes(needle));
  }

  const needleTokens = semanticTokens(rawNeedle);
  return fields.some((field) => {
    const tokens = semanticTokens(field);
    return needleTokens.every((needleToken) => tokens.some((token) => token.startsWith(needleToken)));
  });
}

function matchesSelectorNeedle(parameter: Live2DParameterInfo, rawNeedle: string): boolean {
  const needle = normalizeText(rawNeedle);
  if (!needle) return false;
  const fields = [parameter.id, parameter.name, parameter.groupName].filter(Boolean);
  if (/^[a-z]$/u.test(needle)) {
    return fields.some((field) => semanticTokens(field).includes(needle));
  }
  return fields.some((field) => normalizeText(field).includes(needle));
}

function semanticTokens(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
}

function toWebPath(input: string): string {
  return input.replace(/\\/gu, "/");
}

function normalizeModelsBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/\/+$/u, "");
}

function joinModelsUrl(baseUrl: string, ...segments: string[]): string {
  const suffix = segments.map((segment) => segment.replace(/^\/+|\/+$/gu, "")).join("/");
  return `${baseUrl}/${suffix}`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
