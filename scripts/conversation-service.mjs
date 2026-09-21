import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
import { retimeReplay, replayOwnedParameterIds } from "../src/parameter-replay.js";

const knownHandActionIds = ["Param68", "Param69", "Param70", "Param72", "Param71", "Param73", "Param74", "Param75", "Param76", "Param77", "Param108"];
const knownHandSwitchIds = new Set([...knownHandActionIds, "Param86", "Param87"]);
// Keep only parameters that can damage the presentation out of JEV's action pool.
// Effect, prop, clothing and gesture switches remain available as deliberate actions.
const appearanceIds = new Set(["Param96", "Param97", "Param98"]);
const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const continuousBinaryPattern = /(?:^|[ _-])(eye(?:[lr])?(?:open|smile)|eyeball|mouth|brow|cheek|breath|jaw|pucker|funnel|gaze|angle|bodyangle)(?:$|[ _-])/iu;
const continuousParameterIdPattern = /^param(?:eye[lr]?(?:open|smile)|eyeball|mouth|jaw|brow|cheek|breath|angle|bodyangle)/iu;
const protectedAppearancePattern = /(?:watermark|copyright|hidden|hide|invisible|disappear|\u6c34\u5370|\u9690\u85cf|\u6d88\u5931|\u7248\u6743)/iu;
const genericModelRules = `Use only parameter IDs and ranges supplied in modelParameters. Preserve channels that are unrelated to the selected gesture. ParamAngleX/Y/Z are head yaw, pitch and roll when present; ParamBodyAngleX/Y/Z are body rotation; ParamEyeLOpen/ParamEyeROpen are eye openness; ParamEyeBallX/Y are gaze; ParamMouthForm is smile/frown; ParamMouthOpenY is audio mouth opening. Binary action and effect switches are intentional visible actions: actively consider them when their name matches the spoken emotion or gesture, and keep them exactly 0 or 1. Prefer several coherent, clearly readable actions when relevant. For a social greeting such as 你好, 嗨, hello or welcome, choose the model's named wave switch when one exists and hold it across adjacent frames. An explicit user request for a named effect takes priority over a playful or contradictory assistant reply; keep that effect active until the final release frame. Leave unrelated idle and physics channels untouched. Do not invent parameter IDs or change protected appearance channels without a deliberate action.`;

export function isDiscreteActionParameter(parameter) {
  if (parameter.min !== 0 || parameter.max !== 1) return false;
  return !continuousParameterIdPattern.test(parameter.id) &&
    !continuousBinaryPattern.test(`${parameter.id} ${parameter.name ?? ""}`);
}

function isProtectedAppearanceParameter(parameter) {
  return appearanceIds.has(parameter.id) || protectedAppearancePattern.test(`${parameter.id} ${parameter.name ?? ""}`);
}

function buildHandOptions(parameters) {
  const handParameters = parameters.filter(parameter =>
    isHandActionParameter(parameter) &&
    parameter.id !== "Param86" && parameter.id !== "Param87"
  );
  return {
    none: "No hand, prop or accessory action",
    ...Object.fromEntries(handParameters.map(parameter => [
      parameter.id,
      `Activate ${parameter.id} (${parameter.name}) as one visible hand or prop action`
    ]))
  };
}

const handSemanticPattern = /(?:hand|arm|gesture|wave|waving|sign|prop|accessory|挥手|招手|手|手臂|比心|猫手|祈祷|鞭子|碗|糖|歌|游戏|内裤|猫)/iu;

export function isHandActionParameter(parameter) {
  return isDiscreteActionParameter(parameter) &&
    (knownHandSwitchIds.has(parameter.id) || handSemanticPattern.test(`${parameter.id} ${parameter.name ?? ""}`));
}

export function buildFrameTimes(durationSec, hz) {
  const count = Math.ceil(durationSec * hz);
  return Array.from({ length: count }, (_, i) => i === count - 1 ? durationSec : durationSec * (i + 1) / count);
}

export function estimateSpeechDuration(text) {
  const chars = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const words = (text.match(/[a-zA-Z0-9]+/g) ?? []).length;
  const pauses = (text.match(/[,.!?;\u3002\uff0c\uff01\uff1f\uff1b]/gu) ?? []).length;
  return clamp(Math.round((chars / 5.5 + words / 2.5 + pauses * 0.15 + 0.3) * 2) / 2, 1, 60);
}

export function pacedMotionDuration(plannedDurationSec, audioDurationSec, scale = 1.35, tailSec = 0.8) {
  if (![plannedDurationSec, audioDurationSec, scale, tailSec].every(Number.isFinite) || plannedDurationSec <= 0 || audioDurationSec <= 0 || scale < 1 || tailSec < 0) {
    throw new Error("Invalid motion pacing values");
  }
  return Math.min(60, Math.max(audioDurationSec, plannedDurationSec * scale + tailSec));
}

export function parameterAnchors(p, initial) {
  const span = p.max - p.min;
  const ratios = [-1, -0.5, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5, 1];
  return [...new Set([...ratios.map(r => clamp(p.default + r * span / 2, p.min, p.max)), p.min, p.max, p.default, initial])].sort((a, b) => a - b);
}

// Jev is more reliable at selecting semantic intensity levels than at
// comparing a long list of raw numeric anchors. Map those levels to the
// model's actual range in code after the choice is returned.
export function parameterValueOptions(p) {
  const neutral = clamp(p.default, p.min, p.max);
  const options = { neutral };
  const levels = [
    // The old 20/50/80% ladder made a "small" facial action nearly
    // invisible on models whose neutral pose is already expressive. Keep
    // semantic choices, but give each non-neutral level a readable floor.
    ["smallNegative", -0.35], ["mediumNegative", -0.65], ["largeNegative", -0.9],
    ["smallPositive", 0.35], ["mediumPositive", 0.65], ["largePositive", 0.9]
  ];
  for (const [key, ratio] of levels) {
    const distance = ratio < 0 ? neutral - p.min : p.max - neutral;
    if (distance <= 1e-9) continue;
    const value = clamp(neutral + distance * ratio, p.min, p.max);
    if (!Object.values(options).some(existing => Math.abs(existing - value) <= 1e-9)) options[key] = value;
  }
  return options;
}

function parameterLevelMeaning(key) {
  return {
    neutral: "Neutral/rest value for this channel",
    smallNegative: "Small negative movement from neutral",
    mediumNegative: "Medium negative movement from neutral",
    largeNegative: "Large negative movement from neutral; use sparingly",
    smallPositive: "Small positive movement from neutral",
    mediumPositive: "Medium positive movement from neutral",
    largePositive: "Large positive movement from neutral; use sparingly"
  }[key] ?? key;
}

export function decodeChoice(answer, values) {
  if (answer?.type !== "choice" || !Object.hasOwn(values, answer.choice)) throw new Error("Invalid or missing JEV choice");
  return values[answer.choice];
}

function compactDecision(answer) {
  if (!answer || typeof answer !== "object") return null;
  const result = { type: answer.type };
  if (typeof answer.choice === "string") result.choice = answer.choice;
  if (Number.isFinite(answer.score)) result.score = answer.score;
  if (Number.isFinite(answer.noul)) result.noul = answer.noul;
  if (Number.isFinite(answer.confidence)) result.confidence = clamp(answer.confidence, 0, 1);
  return result;
}

export function compactDecisionAnswers(answers = {}) {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, compactDecision(answer)]));
}

export function summarizeDecisionConfidence(answers = {}) {
  const rows = Object.entries(answers).map(([id, answer]) => ({ id, answer: compactDecision(answer) }));
  const confident = rows.filter(row => Number.isFinite(row.answer?.confidence));
  const values = confident.map(row => row.answer.confidence);
  const bands = {
    low: confident.filter(row => row.answer.confidence < 0.5).length,
    medium: confident.filter(row => row.answer.confidence >= 0.5 && row.answer.confidence < 0.75).length,
    high: confident.filter(row => row.answer.confidence >= 0.75).length
  };
  return {
    count: rows.length,
    withConfidence: confident.length,
    confidenceThresholds: { lowBelow: 0.5, highAtOrAbove: 0.75 },
    bands,
    min: values.length ? Math.min(...values) : null,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    max: values.length ? Math.max(...values) : null
  };
}

function parameterMeaning(p, value) {
  const v = Number(value.toFixed(4));
  const direction = value < 0 ? "negative" : value > 0 ? "positive" : "neutral";
  if (p.id === "ParamAngleY") return `${v} degrees, ${value < 0 ? "head down" : value > 0 ? "head up" : "head upright"}`;
  if (p.id === "ParamAngleX") return `${v} degrees, ${value < 0 ? "head left" : value > 0 ? "head right" : "head facing user"}`;
  if (p.id === "ParamAngleZ") return `${v} degrees, ${direction} sideways head tilt`;
  if (p.id.startsWith("ParamBodyAngle")) return `${v} degrees, ${direction} body rotation`;
  if (/^ParamEye[LR]Open$/.test(p.id)) return `${v}, ${value === 0 ? "eye fully closed" : value < 0.7 ? "eye partly closed" : "eye open"}`;
  if (p.id === "ParamMouthForm") return `${v}, ${value < 0 ? "frown" : value > 0 ? "smile" : "relaxed mouth"}`;
  if (/Eye[LR]Smile|Cheek|^Param(79|80|81|82|83|84|85|95|100|101|102|103)$/.test(p.id)) return `${v}, ${p.name} effect ${value === 0 ? "off" : "intensity"}`;
  return `${v}, ${p.name}${value === p.default ? " at neutral rest" : ""}`;
}

// JEV can select a semantic gesture without selecting the standard channel that
// implements it. Reinforce those channels after the semantic timeline is known.
// This keeps the model in charge of timing and amplitude while preventing an
// internally contradictory plan such as "dip" with no pitch parameter owned.
export function inferSemanticParameterIds(parameters, actions = []) {
  const ids = new Set();
  const add = (exactIds, pattern, limit = 2) => {
    let matches = parameters.filter(parameter => exactIds.includes(parameter.id));
    if (!matches.length && pattern) matches = parameters.filter(parameter => pattern.test(`${parameter.id} ${parameter.name ?? ""}`));
    for (const parameter of matches.slice(0, limit)) ids.add(parameter.id);
  };
  for (const action of actions) {
    switch (action?.gesture) {
      case "dip":
      case "lift":
        add(["ParamAngleY"], /(?:head|pitch|俯仰|抬头|低头|上下)/iu);
        add(["ParamBodyAngleY"], /(?:body.*(?:angle|pitch)|身体.*(?:俯仰|上下))/iu, 1);
        break;
      case "left":
      case "right":
        add(["ParamAngleX"], /(?:head|yaw|左右|转头)/iu);
        add(["ParamBodyAngleX"], /(?:body.*(?:angle|yaw)|身体.*(?:左右|转身))/iu, 1);
        break;
      case "tilt":
        add(["ParamAngleZ"], /(?:head|roll|tilt|歪头|倾斜)/iu);
        add(["ParamBodyAngleZ"], /(?:body.*(?:angle|roll)|身体.*(?:倾斜|侧倾))/iu, 1);
        break;
      default:
        break;
    }
    switch (action?.expression) {
      case "warm":
      case "shy":
        add(["ParamMouthForm"], /(?:mouth.*(?:form|smile)|smile|嘴型|嘴角|微笑|笑容)/iu, 1);
        add(["ParamEyeLSmile", "ParamEyeRSmile"], /(?:eye.*smile|笑眼)/iu, 2);
        break;
      case "concern":
      case "firm":
        add(["ParamMouthForm"], /(?:mouth.*(?:form|frown)|frown|嘴型|嘴角|下压)/iu, 1);
        add(["ParamBrowLY", "ParamBrowRY"], /(?:brow|眉)/iu, 2);
        break;
      case "surprised":
        add(["ParamEyeLOpen", "ParamEyeROpen"], /(?:eye.*open|眼.*开|睁眼)/iu, 2);
        add(["ParamMouthForm"], /(?:mouth.*form|嘴型)/iu, 1);
        break;
      default:
        break;
    }
    switch (action?.gaze) {
      case "down":
        add(["ParamEyeBallY"], /(?:eyeball.*y|gaze.*y|视线.*上下|视线.*y)/iu, 1);
        break;
      case "side":
        add(["ParamEyeBallX"], /(?:eyeball.*x|gaze.*x|视线.*左右|视线.*x)/iu, 1);
        break;
      case "blink":
        add(["ParamEyeLOpen", "ParamEyeROpen"], /(?:eye.*open|眼.*开|眨眼)/iu, 2);
        break;
      default:
        break;
    }
  }
  return [...ids];
}

// Explicit effect requests must survive a polite or contradictory assistant
// reply. JEV still chooses the surrounding gesture and continuous intensity;
// this only identifies a model switch whose name matches the request.
export function inferExplicitEffectParameterIds(parameters, text = "") {
  const message = String(text);
  const requests = [
    { text: /(?:生气|愤怒|恼怒|发火|怒气|angry|anger)/iu, parameter: /(?:生气|愤怒|恼怒|怒|anger|angry)/iu },
    { text: /(?:伤心|难过|悲伤|哭|眼泪|流泪|sad|tear)/iu, parameter: /(?:眼泪|泪|悲伤|难过|tear|sad)/iu },
    { text: /(?:脸红|害羞|腼腆|blush|shy)/iu, parameter: /(?:脸红|害羞|红|blush|shy)/iu },
    { text: /(?:惊讶|吃惊|震惊|surpris)/iu, parameter: /(?:惊讶|吃惊|震惊|surpris)/iu }
  ];
  const ids = new Set();
  for (const request of requests) {
    if (!request.text.test(message)) continue;
    for (const parameter of parameters) {
      if (isDiscreteActionParameter(parameter) && request.parameter.test(`${parameter.id} ${parameter.name ?? ""}`)) ids.add(parameter.id);
    }
  }
  return [...ids];
}

export function selectJevParameterIds(parameters, actionAnswers = {}, consistencyParameterIds = []) {
  const consistency = new Set(consistencyParameterIds);
  return parameters
    .filter(parameter => decodeChoice(actionAnswers[`o_${parameter.id}`], { idle: false, animate: true }) || consistency.has(parameter.id))
    .map(parameter => parameter.id);
}

export function createConversationService(root, providers, options = {}) {
  const directory = resolve(root, "output/conversations");
  const modelsRoot = resolve(root, options.modelsRoot ?? "apps/web/public/models");
  const dispatcher = new EnvHttpProxyAgent();
  const turns = new Map();
  const pendingWrites = new Map();
  const save = turn => {
    // TTS and JEV update the same report concurrently; serialize disk writes.
    const pending = (pendingWrites.get(turn.id) ?? Promise.resolve()).catch(() => {})
      .then(() => writeFile(resolve(directory, `${turn.id}.json`), JSON.stringify(turn, null, 2) + "\n"));
    pendingWrites.set(turn.id, pending);
    return pending;
  };
  const updateGenerationStatus = turn => {
    if (!["failed", "cancelled"].includes(turn.status)) turn.status = turn.audio && turn.plan ? "ready" : "generating";
  };
  async function getTurn(id) {
    if (!/^[a-f0-9-]{36}$/.test(id ?? "")) throw new Error("Invalid conversation ID");
    if (turns.has(id)) return turns.get(id);
    const turn = JSON.parse(await readFile(resolve(directory, `${id}.json`), "utf8"));
    turns.set(id, turn);
    return turn;
  }

  async function request(turn, stage, provider, url, body, signal, headers = {}) {
    if (!provider.apiKey) throw new Error(`${stage} is not configured`);
    const record = { stage, startedAt: new Date().toISOString(), endpoint: url, request: body, status: "pending" };
    turn.requests.push(record);
    await save(turn);
    const started = performance.now();
    try {
      const response = await proxyFetch(url, {
        dispatcher, method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)])
      });
      record.httpStatus = response.status;
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && /audio|octet-stream/.test(contentType)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        record.response = { contentType, byteLength: bytes.length, requestedModel: headers.model };
        record.status = "success";
        return { bytes, contentType };
      }
      const raw = await response.text();
      try { record.response = JSON.parse(raw); } catch { record.response = { raw }; }
      if (!response.ok || record.response.error) {
        const error = new Error(`${stage}: HTTP ${response.status}: ${raw.slice(0, 400)}`);
        error.status = response.status;
        throw error;
      }
      record.status = "success";
      return record.response;
    } catch (error) {
      record.status = signal.aborted ? "cancelled" : "failed";
      record.error = error.message;
      throw error;
    } finally {
      record.elapsedMs = Math.round(performance.now() - started);
      await save(turn);
    }
  }

  async function reply(input, signal) {
    const text = String(input.message ?? "").trim();
    if (!text || text.length > 4000) throw new Error("Message must contain 1 to 4000 characters");
    await mkdir(directory, { recursive: true });
    const history = (Array.isArray(input.conversation) ? input.conversation : []).slice(-20)
      .filter(t => ["user", "assistant"].includes(t?.role) && typeof t.content === "string")
      .map(t => ({ role: t.role, content: t.content.slice(0, 4000) }));
    const turn = { schemaVersion: 2, id: randomUUID(), startedAt: new Date().toISOString(), userMessage: text, history, requests: [], status: "reply" };
    turns.set(turn.id, turn);
    await save(turn);
    try {
      const result = await request(turn, "rivo-reply", providers.rivo, `${providers.rivo.baseURL}/chat/completions`, {
        model: providers.rivo.model, temperature: 0.7, max_tokens: 350,
        messages: [{ role: "system", content: `You are ${String(input.characterName ?? "LilyaBee").slice(0, 80)}, a warm, thoughtful conversational companion. Remember the conversation. Reply in natural Chinese, 1-3 short sentences, normally within 65 Chinese characters. Answer the actual question. Plain spoken text only, no emoji, stage directions or parameter instructions.` }, ...history, { role: "user", content: text }]
      }, signal);
      const replyText = result.choices?.[0]?.message?.content;
      if (typeof replyText !== "string" || !replyText.trim()) throw new Error("Rivo returned an empty reply");
      turn.reply = replyText.trim();
      turn.replyModel = result.model ?? providers.rivo.model;
      turn.status = "reply-ready";
      await save(turn);
      return { id: turn.id, reply: turn.reply, model: turn.replyModel, reportUrl: `/api/conversation/report/${turn.id}` };
    } catch (error) { turn.status = signal.aborted ? "cancelled" : "failed"; turn.error = error.message; await save(turn); throw error; }
  }

  async function tts(input, signal) {
    const turn = await getTurn(input.id);
    const requestedModel = input.model ?? providers.fish.model;
    if (!["s2.1-pro", "s2.1-pro-free", "s2-pro"].includes(requestedModel)) throw new Error("Unsupported Fish model");
    updateGenerationStatus(turn);
    try {
      const result = await request(turn, "fish-tts", providers.fish, `${providers.fish.baseURL}/tts`, {
        text: turn.reply, reference_id: providers.fish.referenceId, format: "mp3", latency: "normal"
      }, signal, { model: requestedModel, Accept: "audio/mpeg" });
      if (!result.bytes?.length) throw new Error("Fish did not return audio");
      const file = `${turn.id}.mp3`;
      await writeFile(resolve(directory, file), result.bytes);
      turn.audio = { file, byteLength: result.bytes.length, requestedModel, durationSec: null };
      updateGenerationStatus(turn);
      await save(turn);
      return result;
    } catch (error) { turn.status = signal.aborted ? "cancelled" : "failed"; turn.error = error.message; await save(turn); throw error; }
  }

  async function plan(input, signal) {
    const turn = await getTurn(input.id);
    const durationSec = input.durationSec ?? estimateSpeechDuration(turn.reply);
    const durationSource = input.durationSec == null ? "estimated from reply text" : "provided planning duration";
    const hz = Number(input.keyframesPerSecond ?? 2);
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 60 || ![1, 2, 4].includes(hz)) throw new Error("Invalid planning duration or keyframe rate (maximum 60 seconds)");
    if (!turn.reply) throw new Error("Generate a reply before planning motion");
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(input.modelAssetDir ?? "")) throw new Error("Invalid model asset directory");
    const modelDirectory = resolve(modelsRoot, input.modelAssetDir);
    const modelFiles = await readdir(modelDirectory);
    const physicsFile = modelFiles.find(file => /\.physics3\.json$/iu.test(file));
    if (!physicsFile) throw new Error(`No physics3 file found for model ${input.modelAssetDir}`);
    const physics = JSON.parse(await readFile(resolve(modelDirectory, physicsFile), "utf8"));
    const promptFile = modelFiles.find(file => file === "model_prompt.txt");
    const rules = promptFile ? await readFile(resolve(modelDirectory, promptFile), "utf8") : genericModelRules;
    const physicsIds = new Set(physics.PhysicsSettings.flatMap(s => s.Output ?? []).map(o => o.Destination.Id));
    const entries = Object.entries(input.availableParameters ?? {});
    if (!entries.length || entries.length > 256) throw new Error("Invalid model parameter metadata");
    const parameters = entries.map(([id, p]) => {
      if (!/^[\w]+$/.test(id) || ![p?.min, p?.max, p?.default].every(Number.isFinite) || p.max < p.min) throw new Error(`Invalid metadata: ${id}`);
      return { id, name: String(p.name ?? id), min: p.min, max: p.max, default: p.default };
    });
    const discreteParameterIds = parameters.filter(isDiscreteActionParameter).map(p => p.id);
    const discreteParameterSet = new Set(discreteParameterIds);
    const handParameterIds = parameters.filter(p =>
      !physicsIds.has(p.id) && isHandActionParameter(p)
    ).map(p => p.id);
    const handParameterSet = new Set(handParameterIds);
    const initial = Object.fromEntries(parameters.map(p => {
      let value = input.initialParameters?.[p.id];
      if (!Number.isFinite(value) || value < p.min || value > p.max) throw new Error(`Invalid current pose: ${p.id}`);
      // Normalize tiny floating-point residues before discrete replay validation.
      if (discreteParameterSet.has(p.id)) value = value >= (p.min + p.max) / 2 ? p.max : p.min;
      return [p.id, value];
    }));
    const controlled = parameters.filter(p =>
      !physicsIds.has(p.id) &&
      !isProtectedAppearanceParameter(p) &&
      !handParameterSet.has(p.id) &&
      p.id !== "ParamMouthOpenY" &&
      !p.id.startsWith("Param_Angle_")
    );
    const frameCount = Math.ceil(durationSec * hz);
    const times = buildFrameTimes(durationSec, hz);
    const timeline = times.map((time, i) => ({ index: i, time, approximateSpeech: turn.reply.slice(Math.floor(turn.reply.length * i / frameCount), Math.ceil(turn.reply.length * (i + 1) / frameCount)) }));
    updateGenerationStatus(turn);
    turn.motionInput = { ...input, durationSec, durationSource, timeline, modelRules: rules };
    await save(turn);
    const started = performance.now();
    const decide = async (questions, state, stage) => {
      const items = Object.entries(questions);
      const answers = {};
      // Serial bounded batches retain a complete action timeline in every request.
      for (let offset = 0; offset < items.length; offset += 96) {
        signal.throwIfAborted();
        const response = await request(turn, stage, providers.jev, `${providers.jev.baseURL}/decisions`, {
          model: providers.jev.model, state, questions: Object.fromEntries(items.slice(offset, offset + 96))
        }, signal);
        for (const [id] of items.slice(offset, offset + 96)) {
          if (!response.answers?.[id]) throw new Error(`JEV missing decision ${id}`);
          answers[id] = response.answers[id];
        }
      }
      return answers;
    };
    try {
      const common = { userMessage: turn.userMessage, assistantReply: turn.reply, recentConversation: turn.history.slice(-6), durationSec, timeline,
        timing: "Approximate speaking duration. Audio is synthesized in parallel. Focus on coherent action rhythm; timestamps will be adjusted after audio is ready.",
        constraints: "Plan a coherent expressive spoken response. For a social greeting such as 你好, 嗨, hello or welcome, use the authored wave switch when the model exposes one. For a non-neutral reply, deliberately use at least one meaningful head, face or gaze channel; do not make every continuous channel idle. Vary the gesture through preparation, peak and recovery. Keep visual contact most of the time. A nod needs down and up phases; a shake needs opposite yaw phases. Do not blink in every frame. Preserve appearance. No procedural motion templates will be added locally. Speech timing is proportional text alignment, not measured word timestamps." };
      const gestures = { neutral: "No deliberate head gesture", dip: "Head gently downward, acknowledgement nod down phase", lift: "Head gently up or nod recovery", left: "Turn slightly left or shake left phase", right: "Turn slightly right or shake right phase", tilt: "Small curious or affectionate head tilt" };
      const expressions = { neutral: "Relaxed attentive", warm: "Warm smile", shy: "Shy warmth", concern: "Concern or sadness", curious: "Curiosity", surprised: "Pleasant surprise", firm: "Firm disagreement" };
      const looks = { contact: "Look at user", down: "Brief shy downward glance", side: "Brief side glance", blink: "Both eyes close briefly; reopen next frame" };
      const handOptions = buildHandOptions(parameters.filter(parameter => !physicsIds.has(parameter.id)));
      const actionAnswers = await decide(Object.fromEntries([...timeline.flatMap(t => [
        [`g${t.index}`, choice(`Head gesture at ${t.time.toFixed(2)}s of ${durationSec.toFixed(2)}s (${Math.round(t.time / durationSec * 100)}% through reply), spoken fragment: ${t.approximateSpeech}. ${t.index === frameCount - 1 ? "This is the FINAL frame: select neutral to settle." : "Consider the entire timeline. One nod is a brief dip followed by lift, not a prolonged downward hold. Choose its timing to match the words. Use neutral rest between gestures."}`, gestures)],
        [`e${t.index}`, choice(`Expression at ${t.time}s`, expressions)],
        [`l${t.index}`, choice(`Gaze at ${t.time}s`, looks)],
        [`h${t.index}`, choice(`Choose the primary hand or prop action at ${t.time}s of ${durationSec}s using the supplied modelRules, parameter names and the entire user/reply context. Match greetings, explicit actions and character-specific actions to the parameter whose model name and rule describe them. Do not invent IDs or substitute a generic action. ${t.index === frameCount - 1 ? "This is the FINAL frame: release the hand action, select none." : "Choose none when no authored action fits. Hold a selected action across adjacent frames; do not flicker on and off."}`, handOptions)]
      ]), ...controlled.map(p => [`o_${p.id}`, choice(
        `Should JEV take control of ${p.id} (${p.name}) for this entire reply? ${parameterMeaning(p, p.default)}. This parameter is a distinctive binary action/effect switch when its range is 0..1. If its ID or name matches an action explicitly requested by the user or reply, choose animate; if several switches match, choose all compatible ones. For continuous channels, choose animate whenever THIS channel implements a non-neutral direction in the action timeline; do not be overly conservative about standard head, face, gaze or body channels. Head pitch Y is for nod/dip/lift; yaw X for left/right; roll Z for tilt. Breathing, incidental body sway, normal blinking and hair movement already run continuously in idle. Unrelated channels must remain idle.`,
        { idle: "Keep this channel's ongoing idle and physics movement, no JEV override", animate: "Deliberately animate this channel with JEV-generated target values" }
      )])]), common, "jev-actions");
      const actions = timeline.map(t => ({ ...t,
        gesture: decodeChoice(actionAnswers[`g${t.index}`], Object.fromEntries(Object.keys(gestures).map(k => [k, k]))),
        expression: decodeChoice(actionAnswers[`e${t.index}`], Object.fromEntries(Object.keys(expressions).map(k => [k, k]))),
        gaze: decodeChoice(actionAnswers[`l${t.index}`], Object.fromEntries(Object.keys(looks).map(k => [k, k]))),
        hand: decodeChoice(actionAnswers[`h${t.index}`], Object.fromEntries(Object.keys(handOptions).map(k => [k, k])))
      }));
      // The final frame is a deterministic release point. Keep the raw JEV
      // answers in requests[].response, while making the playable timeline
      // agree with the pose reset performed below.
      if (actions.length) Object.assign(actions.at(-1), { gesture: "neutral", expression: "neutral", gaze: "contact", hand: "none" });
      const semanticParameterIds = inferSemanticParameterIds(parameters, actions)
        .filter(id => controlled.some(parameter => parameter.id === id));
      const explicitEffectParameterIds = inferExplicitEffectParameterIds(parameters, turn.userMessage)
        .filter(id => controlled.some(parameter => parameter.id === id));
      const consistencyCandidates = [...new Set([...semanticParameterIds, ...explicitEffectParameterIds])]
        .filter(id => controlled.some(parameter => parameter.id === id))
        .filter(id => actionAnswers[`o_${id}`]?.choice !== "animate");
      const consistencyAnswers = consistencyCandidates.length
        ? await decide(Object.fromEntries(consistencyCandidates.map(id => {
          const parameter = controlled.find(candidate => candidate.id === id);
          const semanticReason = semanticParameterIds.includes(id)
            ? "the selected semantic timeline uses this channel"
            : "the user explicitly named an effect matching this switch";
          return [`c_${id}`, choice(
            `Reconsider whether JEV should animate ${id} (${parameter.name}) for this reply because ${semanticReason}. The first gate selected idle. Respect idle when this channel is not needed; choose animate only when the supplied model meaning makes the requested action visibly coherent. Do not invent or substitute another parameter.`,
            { idle: "Keep this channel with idle and physics", animate: "JEV deliberately owns this channel" }
          )];
        })), { ...common, actionTimeline: actions, modelParameters: controlled.filter(p => consistencyCandidates.includes(p.id)), initialParameters: initial, modelRules: rules }, "jev-consistency")
        : {};
      const jevConsistencyParameterIds = consistencyCandidates.filter(id =>
        decodeChoice(consistencyAnswers[`c_${id}`], { idle: false, animate: true })
      );
      const selectedIds = selectJevParameterIds(controlled, actionAnswers, jevConsistencyParameterIds);
      const selected = controlled.filter(p => selectedIds.includes(p.id));
      const scalarEntries = timeline.flatMap(t => selected.map(p => {
        const values = discreteParameterSet.has(p.id)
          ? { off: p.min, on: p.max }
          : parameterValueOptions(p);
        const action = actions[t.index];
        const criteria = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
          discreteParameterSet.has(p.id) ? `${key === "on" ? "Activate" : "Keep off"} this binary action (${p.name})` : `${parameterLevelMeaning(key)} for ${p.name}`
        ]));
        return { id: `f${t.index}_${p.id}`, p, frame: t.index, values, question: choice(
          `Choose a qualitative intensity for ${p.id} (${p.name}) at ${t.time}s. THIS FRAME's JEV direction: head=${action.gesture}, expression=${action.expression}, gaze=${action.gaze}, hand=${action.hand}. Spoken fragment: ${t.approximateSpeech}. Select the semantic level that makes this channel clearly visible without distorting the model. Head pitch Y expresses dip/lift; yaw X expresses left/right; roll Z expresses tilt; do not apply the same movement to all axes. Smile affects mouth form and eye smile. Gaze blink closes both eyes, contact opens them. For a binary action switch, use only off or on and release it in the final frame. Choose neutral for unrelated effects. The application maps your qualitative choice to a safe absolute value from this model's cdi3 range; do not estimate decimal values. ${t.index === frameCount - 1 ? "Final frame: return to the live starting pose and release transient binary actions." : "Use at least a small readable level when this channel implements the requested direction; use medium or large for an explicitly requested effect."}`,
          criteria
        ) };
      }));
      const scalarAnswers = await decide(Object.fromEntries(scalarEntries.map(e => [e.id, e.question])), {
        ...common, actionTimeline: actions, modelParameters: selected, initialParameters: initial, modelRules: rules
      }, "jev-parameters");
      const keyframes = timeline.map(t => ({ time: t.time, parameters: { ...initial }, action: actions[t.index] }));
      for (const e of scalarEntries) keyframes[e.frame].parameters[e.p.id] = decodeChoice(scalarAnswers[e.id], e.values);
      for (const [i, frame] of keyframes.entries()) {
        for (const id of handParameterIds) if (Object.hasOwn(frame.parameters, id)) frame.parameters[id] = actions[i].hand === id ? 1 : 0;
        if (Object.hasOwn(frame.parameters, "Param86")) frame.parameters.Param86 = actions[i].hand === "none" ? 0 : 1;
        if (Object.hasOwn(frame.parameters, "Param87")) frame.parameters.Param87 = ["Param74", "Param73"].includes(actions[i].hand) ? 1 : 0;
      }
      const finalFrame = keyframes.at(-1);
      for (const p of selected) finalFrame.parameters[p.id] = discreteParameterSet.has(p.id) ? p.min : initial[p.id];
      const movingParameterIds = selected.filter(p => keyframes.some(f => Math.abs(f.parameters[p.id] - initial[p.id]) > (p.max - p.min) * 0.01)).map(p => p.id);
      // LilyaBee hand and arm switches are authored as strict booleans. Keep
      // them stepwise at playback time; face effects can still use the slower
      // rendered transition used by the conversation player.
      const strictDiscreteParameterIds = handParameterIds.filter(id => discreteParameterSet.has(id));
      const decisionAnswers = {
        actions: compactDecisionAnswers(actionAnswers),
        parameters: compactDecisionAnswers(scalarAnswers),
        consistency: Object.fromEntries(consistencyCandidates.map(id => [id, compactDecision(consistencyAnswers[`c_${id}`])] ))
      };
      const planResult = {
        schemaVersion: 2, provider: "jev", id: turn.id, durationSec, durationSource, frameCount, keyframesPerSecond: hz,
        parameterCount: parameters.length, eligibleParameterIds: controlled.map(p => p.id), directParameterIds: selected.map(p => p.id), movingParameterIds, handParameterIds,
        semanticParameterIds, consistencyCandidates, jevConsistencyParameterIds,
        // Kept for report consumers from the previous schema. These are JEV's
        // second-pass selections, never local value overrides.
        selectionOverrides: jevConsistencyParameterIds,
        selectionOverrideDetails: jevConsistencyParameterIds.map(id => ({
          id,
          reason: "JEV consistency pass selected this channel"
        })),
        explicitEffectParameterIds,
        decisionAnswers,
        decisionConfidence: {
          actions: summarizeDecisionConfidence(actionAnswers),
          parameters: summarizeDecisionConfidence(scalarAnswers),
          consistency: summarizeDecisionConfidence(consistencyAnswers),
          policy: "Confidence is diagnostic for this low-stakes animation. JEV's action and consistency choices determine ownership; full probability distributions stay in requests[].response.",
          selectionOverrides: jevConsistencyParameterIds
        },
        ownership: { direct: "JEV chooses channels, then absolute targets; only changed channels override idle", hands: "JEV exclusive action choice mapped to model switches", mouthOpen: "decoded audio RMS", otherParameters: "live idle/runtime values; full keyframe values are reference only", physics: "native physics continues without frozen output overrides" },
        initialParameters: initial, discreteParameterIds,
        strictDiscreteParameterIds,
        smoothedDiscreteParameterIds: discreteParameterIds.filter(id => !strictDiscreteParameterIds.includes(id)),
        keyframes, actions,
        generationMs: Math.round(performance.now() - started), reportUrl: `/api/conversation/report/${turn.id}`,
        resolvedModels: [...new Set(turn.requests.filter(r => r.stage.startsWith("jev")).map(r => r.response?.model).filter(Boolean))]
      };
      planResult.ownedParameterIds = replayOwnedParameterIds(planResult, input.availableParameters);
      planResult.passthroughParameterIds = parameters.map(p => p.id).filter(id => !planResult.ownedParameterIds.includes(id));
      planResult.preservedParameterIds = planResult.passthroughParameterIds;
      turn.plan = planResult;
      updateGenerationStatus(turn);
      await save(turn);
      return planResult;
    } catch (error) { turn.status = signal.aborted ? "cancelled" : "failed"; turn.error = error.message; await save(turn); throw error; }
  }

  return {
    reply, tts, plan, getTurn,
    async ready(input) {
      const turn = await getTurn(input.id);
      if (!turn.audio || !turn.plan || ["cancelled", "failed"].includes(turn.status)) throw new Error("Audio and motion must both finish before playback");
      const audioDurationSec = input.durationSec;
      const motionDurationSec = pacedMotionDuration(turn.plan.durationSec, audioDurationSec);
      const playbackPlan = retimeReplay(turn.plan, motionDurationSec);
      playbackPlan.audioDurationSec = audioDurationSec;
      playbackPlan.motionPacing = { scale: 1.35, tailSec: 0.8, source: "relaxed playback timeline", audioDurationSec, durationSec: motionDurationSec };
      turn.audio.durationSec = audioDurationSec;
      turn.audio.durationSource = "browser decoded AudioBuffer";
      turn.playbackPlan = playbackPlan;
      turn.status = "ready";
      await save(turn);
      return playbackPlan;
    },
    async playback(input) {
      const turn = await getTurn(input.id);
      turn.playback = input.telemetry;
      (turn.playbacks ??= []).push({ recordedAt: new Date().toISOString(), ...input.telemetry });
      await save(turn);
      return { ok: true };
    },
    close: () => dispatcher.close()
  };
}
