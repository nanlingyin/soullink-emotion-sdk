import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = "https://openrouter.ai/api/alpha/decisions";
const coreUrl = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const modelFile = "apps/web/public/models/lilyabee/lilyabee.model3.json";
const handActions = ["Param68", "Param69", "Param70", "Param72", "Param71", "Param73", "Param74", "Param75", "Param76", "Param77", "Param108"];
const binaryIds = new Set([...handActions, "Param86", "Param87"]);
const times = [0.25, 0.5, 0.75, 1];
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const requestedModels = option("--models", "~typesafe/jev-latest,typesafe/jev-1.13").split(",");
const selectedCases = option("--cases", "blink,nod,shy").split(",");
const mode = option("--numeric-mode", "score");
if (!["score", "choice"].includes(mode)) throw new Error("--numeric-mode must be score or choice");
let batchSize = Number(option("--batch-size", "608"));
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 608) throw new Error("Invalid --batch-size");
const out = resolve(root, option("--out", `output/jev-keyframes/${new Date().toISOString().replace(/[:.]/g, "-")}`));
const scenarios = {
  blink: {
    userText: "\u8bf7\u770b\u7740\u6211\uff0c\u53ea\u7728\u4e00\u6b21\u773c\uff0c\u5176\u4ed6\u90e8\u4f4d\u4fdd\u6301\u4e0d\u52a8\u3002",
    instruction: "Blink both eyes together exactly once. Close at 0.25s, reopen to initial openness at 0.50s, keep open at 0.75s and 1.00s. Keep EVERY other parameter at its initial value.",
    phases: ["both eyes fully closed", "both eyes reopened", "hold initial pose", "hold initial pose"],
    allowedChanges: ["ParamEyeLOpen", "ParamEyeROpen"]
  },
  nod: {
    userText: "\u8bf7\u8f7b\u8f7b\u70b9\u4e00\u4e0b\u5934\u8868\u793a\u540c\u610f\uff0c\u7136\u540e\u56de\u5230\u539f\u6765\u7684\u59ff\u52bf\u3002",
    instruction: "One gentle nod, using only ParamAngleY. Downward is negative for this test. Reach a modest downward dip at 0.25s, remain slightly dipped at 0.50s, return toward zero at 0.75s, reach initial value at 1.00s. Keep EVERY other parameter unchanged.",
    phases: ["modest downward head dip", "slightly dipped", "return toward neutral", "initial pose"],
    allowedChanges: ["ParamAngleY"]
  },
  shy: {
    userText: "\u6211\u597d\u559c\u6b22\u4f60\uff0c\u4f46\u6211\u6709\u70b9\u5bb3\u7f9e\u3002",
    instruction: "React warmly and shyly to the user. A subtle smile, slight downward gaze and small head dip may grow then soften. Do not speak or trigger hand actions. Preserve appearance, visibility, costume and all unrelated parameters. The final pose may retain a small expression.",
    phases: ["notice and begin a shy reaction", "peak shy warmth", "soften the reaction", "settle into a restrained warm pose"]
  },
  wave: {
    userText: "\u8bf7\u6325\u4e00\u4e0b\u624b\u6253\u62db\u547c\uff0c\u7136\u540e\u653e\u4e0b\u624b\u3002",
    instruction: "Wave using the model's Param70 hand-action switch. Activate at 0.25s, hold through 0.75s, deactivate at 1.00s. Keep other hand-action switches off. Preserve other parameters, including appearance and visibility.",
    phases: ["activate wave", "hold wave", "hold wave", "deactivate wave"],
    allowedChanges: ["Param70", "Param86", "Param87"]
  }
};
for (const id of selectedCases) if (!scenarios[id]) throw new Error(`Unknown case: ${id}`);

async function loadModel() {
  const response = await fetch(coreUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cubism Core HTTP ${response.status}`);
  const source = await response.text();
  const context = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, setTimeout, clearTimeout, atob, btoa });
  vm.runInContext(source, context, { timeout: 10000 });
  let coreVersion;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { coreVersion = context.Live2DCubismCore.Version.csmGetVersion(); break; }
    catch { await delay(20); }
  }
  if (!coreVersion) throw new Error("Cubism Core initialization failed");
  const file = resolve(root, modelFile);
  const config = JSON.parse(await readFile(file, "utf8"));
  const refs = config.FileReferences;
  const mocBytes = await readFile(resolve(dirname(file), refs.Moc));
  const moc = context.Live2DCubismCore.Moc.fromArrayBuffer(mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength));
  if (!moc) throw new Error("Cannot load moc3");
  const model = context.Live2DCubismCore.Model.fromMoc(moc);
  const cdi = JSON.parse(await readFile(resolve(dirname(file), refs.DisplayInfo), "utf8"));
  const physics = JSON.parse(await readFile(resolve(dirname(file), refs.Physics), "utf8"));
  const physicsOutputs = new Set(physics.PhysicsSettings.flatMap(s => s.Output ?? []).map(o => o.Destination.Id));
  const groups = Object.fromEntries(cdi.ParameterGroups.map(g => [g.Id, g.Name]));
  const names = Object.fromEntries(cdi.Parameters.map(p => [p.Id, p]));
  const raw = model.parameters;
  const parameters = raw.ids.map((id, index) => ({
    id, index, name: names[id]?.Name ?? id, group: groups[names[id]?.GroupId] ?? "",
    min: raw.minimumValues[index], max: raw.maximumValues[index], default: raw.defaultValues[index],
    interpolation: binaryIds.has(id) ? "step-at-target" : "smoothstep",
    physicsOutput: physicsOutputs.has(id)
  }));
  return { model, moc, parameters, metadata: {
    modelFile, mocSha256: createHash("sha256").update(mocBytes).digest("hex"), coreUrl, coreVersion,
    coreSha256: createHash("sha256").update(source).digest("hex"),
    rangeSource: "Cubism Core loaded from the actual moc3, not profile guesses",
    nameSource: refs.DisplayInfo,
    modelRules: await readFile(resolve(dirname(file), "model_prompt.txt"), "utf8"), parameters
  } };
}

function anchors(parameter) {
  const values = Array.from({ length: 9 }, (_, i) => parameter.min + (parameter.max - parameter.min) * i / 8);
  values.push(parameter.default);
  return [...new Set(values)].sort((a, b) => a - b);
}

function buildEntries(parameters) {
  return times.flatMap((time, frameIndex) => parameters.map(parameter => {
    const values = binaryIds.has(parameter.id) ? [0, 1] : anchors(parameter);
    const type = binaryIds.has(parameter.id) ? "choice" : mode;
    const descriptions = values.map(value => `Absolute ${parameter.id} value ${value}${value === parameter.default ? " (INITIAL DEFAULT; keep this when unchanged)" : ""}`);
    return {
      key: `f${frameIndex}_${parameter.id}`, frameIndex, parameter, values, type,
      question: {
        type,
        instructions: `Choose the target for ${parameter.id} (${parameter.name}) at ${time}s according to the entire requested action and phase. An unchanged parameter MUST retain its initial default. Do not add unrelated motion.`,
        criteria: type === "choice" ? Object.fromEntries(descriptions.map((description, i) => [`v${i}`, description])) : descriptions
      }
    };
  }));
}

function decode(entry, answer) {
  if (!answer || answer.type !== entry.type) return { error: "Missing answer or wrong type" };
  if (entry.type === "choice") {
    const index = /^v\d+$/.test(answer.choice ?? "") ? Number(answer.choice.slice(1)) : -1;
    return index >= 0 && index < entry.values.length ? { value: entry.values[index] } : { error: "Unknown choice" };
  }
  const score = answer.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > entry.values.length - 1) return { error: "Score outside supplied anchors" };
  const lo = Math.floor(score), hi = Math.ceil(score);
  return { value: entry.values[lo] + (entry.values[hi] - entry.values[lo]) * (score - lo) };
}

function interpolate(parameters, frames, time) {
  const index = Math.min(3, Math.floor(time * 4));
  const from = index === 0 ? Object.fromEntries(parameters.map(p => [p.id, p.default])) : frames[index - 1].parameters;
  const to = frames[index].parameters;
  const t = Math.min(1, Math.max(0, (time - index * 0.25) / 0.25));
  const u = t * t * (3 - 2 * t);
  return Object.fromEntries(parameters.map(p => [p.id, binaryIds.has(p.id) ? (t >= 1 ? to[p.id] : from[p.id]) : from[p.id] + (to[p.id] - from[p.id]) * u]));
}

function checkFrames(parameters, frames) {
  const issues = [];
  for (const frame of frames) {
    for (const p of parameters) {
      const value = frame.parameters[p.id];
      if (!Number.isFinite(value)) issues.push({ time: frame.time, parameter: p.id, kind: "missing-or-nonfinite" });
      else if (value < p.min - 1e-8 || value > p.max + 1e-8) issues.push({ time: frame.time, parameter: p.id, kind: "out-of-range", value });
      if (binaryIds.has(p.id) && value !== 0 && value !== 1) issues.push({ time: frame.time, parameter: p.id, kind: "invalid-binary", value });
    }
    const activeHands = handActions.filter(id => frame.parameters[id] === 1);
    if (activeHands.length > 1) issues.push({ time: frame.time, kind: "mutually-exclusive-hands", ids: activeHands });
  }
  return issues;
}

function evaluateCase(id, parameters, frames) {
  if (frames.length !== 4) return { passed: false, reason: "Incomplete frames" };
  const scenario = scenarios[id];
  const changed = parameters.filter(p => frames.some(f => Math.abs(f.parameters[p.id] - p.default) > Math.max(1e-7, (p.max - p.min) * 0.01))).map(p => p.id);
  const unrelated = scenario.allowedChanges ? changed.filter(p => !scenario.allowedChanges.includes(p)) : null;
  const tests = {};
  if (unrelated) tests.unrelatedParametersPreservedWithinOnePercent = unrelated.length === 0;
  if (id === "blink") {
    tests.closedAtQuarterSecond = ["ParamEyeLOpen", "ParamEyeROpen"].every(p => frames[0].parameters[p] <= 0.12);
    tests.reopenedAndHeld = frames.slice(1).every(f => ["ParamEyeLOpen", "ParamEyeROpen"].every(p => Math.abs(f.parameters[p] - 1) <= 0.06));
    tests.eyesSynchronized = frames.every(f => Math.abs(f.parameters.ParamEyeLOpen - f.parameters.ParamEyeROpen) <= 0.06);
  }
  if (id === "nod") {
    tests.visibleDownwardDip = frames[0].parameters.ParamAngleY <= -3;
    tests.returnedToNeutral = Math.abs(frames[3].parameters.ParamAngleY) <= 1.5;
  }
  if (id === "wave") {
    tests.waveActivatedAndReleased = frames.slice(0, 3).every(f => f.parameters.Param70 === 1) && frames[3].parameters.Param70 === 0;
    tests.noOtherHandActions = frames.every(f => handActions.every(p => p === "Param70" || f.parameters[p] === 0));
  }
  return { kind: id === "shy" ? "descriptive-only; no automated naturalness claim" : "numeric instruction checks", passed: Object.keys(tests).length ? Object.values(tests).every(Boolean) : null, tests, changedParametersAboveOnePercent: changed, unrelatedChangedParameters: unrelated };
}

async function main() {
  await mkdir(out, { recursive: true });
  const loaded = await loadModel();
  const { parameters, model, moc } = loaded;
  const entries = buildEntries(parameters);
  let key = process.env.OPENROUTER_API_KEY ?? process.env.OR_KEY;
  if (key?.startsWith("k-or-v1-")) key = `s${key}`;
  const dryRun = args.includes("--dry-run");
  if (!dryRun && !key) throw new Error("Set OPENROUTER_API_KEY before running this experiment");
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), status: "running", endpoint,
    experiment: { durationSec: 1, targetTimesSec: times, fps: 60, initialPoseSource: "moc3 defaults, not a captured live pose", parameterCount: parameters.length,
      scalarTargetsPerClip: entries.length, numericMode: mode, decoding: mode === "score" ? "JEV ordinal score mapped piecewise through absolute value anchors" : "JEV selection of absolute parameter values on an eight-interval grid plus exact default",
      binaryIds: [...binaryIds], mutuallyExclusiveHandActions: handActions,
      physics: "disabled; all parameter targets owned by this experiment", vad: "disabled for this isolated test", lipSync: "disabled; silent clips",
      localParameterCompletion: false, localSemanticCorrections: false,
      interpolation: "smoothstep for continuous parameters; known binary switches change at their target time",
      limitations: ["Numeric and Cubism geometry checks do not establish visual naturalness", "Score expectations may move unchanged parameters away from exact defaults", "Only model-rule-confirmed binary switches use step interpolation; other custom channels need visual calibration", "Phases are test instructions, not generated by JEV", "Generating one second of animation is not a one-second inference deadline"] },
    model: loaded.metadata, requestedModels, cases: selectedCases.map(id => ({ id, ...scenarios[id] })), requests: [], results: []
  };
  const save = () => writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  async function call(body, label) {
    const record = { index: report.requests.length, label, startedAt: new Date().toISOString(), status: "pending", questionCount: Object.keys(body.questions).length, request: body };
    report.requests.push(record);
    await save();
    const start = performance.now();
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost", "X-Title": "soullink-direct-keyframe-test" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      record.httpStatus = response.status;
      const rawText = await response.text();
      try { record.response = JSON.parse(rawText); } catch { record.rawResponseText = rawText; }
      record.status = response.ok && record.response?.answers ? "success" : "failed";
    } catch (error) { record.status = "failed"; record.error = { name: error.name, message: error.message }; }
    record.elapsedMs = Math.round(performance.now() - start);
    record.finishedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ request: record.index, label, questions: record.questionCount, status: record.status, httpStatus: record.httpStatus, elapsedMs: record.elapsedMs, error: record.response?.error ?? record.error }));
    return record;
  }
  try {
    for (const requestedModel of requestedModels) {
      for (const caseId of selectedCases) {
        const scenario = scenarios[caseId];
        const clip = { id: `${report.results.length + 1}-${caseId}`, requestedModel, caseId, status: "running", requestIndexes: [], generationStartedAt: new Date().toISOString(), rawKeyframes: [], decodeErrors: [] };
        report.results.push(clip);
        const clipStart = performance.now();
        const decoded = new Map();
        const state = {
          task: "Generate actual absolute Live2D parameter targets for a coherent one-second silent animation. Every parameter at every target time requires a decision. This is direct parameter control, not emotion classification.",
          user_text: scenario.userText, actionInstruction: scenario.instruction,
          phases: times.map((time, i) => ({ time, description: scenario.phases[i] })),
          modelRules: loaded.metadata.modelRules,
          constraints: "Preserve initial values for all unrelated channels. No costume, visibility or accessory changes. Physics and lip-sync are OFF. Do not invent physics movement. The known hand action switches are binary and mutually exclusive. Continuous score categories are numeric target anchors; unchanged means the EXACT initial value, not an uncertainty average.",
          parameters: parameters.map(({ index, interpolation, ...p }) => p)
        };
        for (let offset = 0; offset < entries.length;) {
          const batch = entries.slice(offset, offset + batchSize);
          const body = { model: requestedModel, state, questions: Object.fromEntries(batch.map(e => [e.key, e.question])) };
          if (dryRun) { clip.exampleRequest = body; clip.status = "dry-run"; break; }
          const record = await call(body, `${clip.id}:${offset}-${offset + batch.length}`);
          clip.requestIndexes.push(record.index);
          if (record.status !== "success") {
            if ([400, 413, 422].includes(record.httpStatus) && batchSize > 32) {
              batchSize = batchSize > 128 ? 128 : 32;
              record.recovery = { retryWithBatchSize: batchSize };
              continue;
            }
            clip.status = "failed";
            break;
          }
          for (const entry of batch) {
            const value = decode(entry, record.response.answers[entry.key]);
            if (value.error) clip.decodeErrors.push({ question: entry.key, error: value.error });
            else decoded.set(entry.key, { value: value.value, requestIndex: record.index, confidence: record.response.answers[entry.key].confidence ?? null });
          }
          offset += batch.length;
        }
        clip.generationElapsedMs = Math.round(performance.now() - clipStart);
        clip.returnedTargets = decoded.size;
        clip.expectedTargets = entries.length;
        clip.completeness = decoded.size / entries.length;
        clip.rawKeyframes = times.map((time, frameIndex) => ({ time,
          parameters: Object.fromEntries(parameters.filter(p => decoded.has(`f${frameIndex}_${p.id}`)).map(p => [p.id, decoded.get(`f${frameIndex}_${p.id}`).value])),
          provenance: Object.fromEntries(parameters.filter(p => decoded.has(`f${frameIndex}_${p.id}`)).map(p => [p.id, decoded.get(`f${frameIndex}_${p.id}`)]))
        }));
        clip.keyframeIssues = checkFrames(parameters, clip.rawKeyframes);
        if (decoded.size === entries.length && clip.decodeErrors.length === 0) {
          const frames = Array.from({ length: 61 }, (_, frame) => ({ frame, time: frame / 60, parameters: interpolate(parameters, clip.rawKeyframes, frame / 60) }));
          clip.interpolationIssues = checkFrames(parameters, frames);
          clip.instructionChecks = evaluateCase(caseId, parameters, clip.rawKeyframes);
          let nonfiniteVertices = 0;
          for (const frame of frames) {
            for (const p of parameters) model.parameters.values[p.index] = frame.parameters[p.id];
            model.update();
            for (const positions of model.drawables.vertexPositions) for (const v of positions) if (!Number.isFinite(v)) nonfiniteVertices++;
          }
          clip.cubismCheck = { evaluatedSamples: frames.length, nonfiniteVertices, note: "Geometry validity only; no visual quality assessment" };
          const replayFile = `${clip.id}.replay.json`;
          await writeFile(resolve(out, replayFile), JSON.stringify({ schemaVersion: 1, requestedModel, caseId, durationSec: 1, fps: 60,
            sampleCount: 61, note: "60 frame intervals plus the endpoint sample", initialParameters: Object.fromEntries(parameters.map(p => [p.id, p.default])),
            keyframes: clip.rawKeyframes.map(({ time, parameters: values }) => ({ time, parameters: values })),
            parameterPlan: clip.rawKeyframes.map((f, i) => ({ time: i * 0.25, duration: 0.25, label: `${caseId}-${i}`, parameters: f.parameters })),
            playbackCaveat: "Replay frames preserve model defaults and binary steps; the existing runtime sequencer needs baseline and step support before equivalent playback", frames
          }, null, 2) + "\n");
          clip.replayFile = replayFile;
          clip.status = clip.keyframeIssues.length || clip.interpolationIssues.length || nonfiniteVertices ? "invalid" : "complete";
        } else if (clip.status === "running") clip.status = "incomplete";
        await save();
        console.log(JSON.stringify({ clip: clip.id, model: requestedModel, status: clip.status, targets: `${decoded.size}/${entries.length}`, elapsedMs: clip.generationElapsedMs, checks: clip.instructionChecks }));
        if (report.requests.some(r => r.httpStatus === 401 || r.httpStatus === 402 || r.httpStatus === 403)) throw new Error("Authentication or account error; remaining paid requests stopped");
      }
    }
    report.status = dryRun ? "dry-run" : "finished";
  } catch (error) {
    report.status = "failed";
    report.error = { name: error.name, message: error.message };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.summary = { clips: report.results.length, completeClips: report.results.filter(r => r.status === "complete").length,
      requests: report.requests.length, successfulRequests: report.requests.filter(r => r.status === "success").length,
      resolvedModels: [...new Set(report.requests.map(r => r.response?.model).filter(Boolean))],
      totalReportedCost: report.requests.reduce((sum, r) => sum + (r.response?.usage?.cost ?? 0), 0),
      costReportingCoverage: report.requests.filter(r => typeof r.response?.usage?.cost === "number").length,
      totalRequestElapsedMs: report.requests.reduce((sum, r) => sum + (r.elapsedMs ?? 0), 0) };
    await save();
    model.release();
    moc._release();
    console.log(JSON.stringify({ report: relative(root, resolve(out, "report.json")), ...report.summary }));
  }
}

await main();
