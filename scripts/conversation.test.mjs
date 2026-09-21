import test from "node:test";
import assert from "node:assert/strict";
import { validateReplay, sampleReplay, blendParameterPoses, smoothParameterPose, retimeReplay, replayOwnedParameterIds, selectParameters } from "../src/parameter-replay.js";
import { modelAssetDirectory, modelAssetUrl } from "../src/model-catalog.js";
import { buildFrameTimes, decodeChoice, parameterAnchors, parameterValueOptions, estimateSpeechDuration, pacedMotionDuration, isDiscreteActionParameter, isHandActionParameter, inferSemanticParameterIds, inferExplicitEffectParameterIds, selectJevParameterIds, compactDecisionAnswers, summarizeDecisionConfidence } from "./conversation-service.mjs";

const metadata = { head: { min: -30, max: 30, default: 0 }, hand: { min: 0, max: 1, default: 0 } };
const replay = () => ({ durationSec: 1, initialParameters: { head: 0, hand: 0 }, discreteParameterIds: ["hand"], smoothedDiscreteParameterIds: ["hand"], keyframes: [
  { time: 0.5, parameters: { head: -6, hand: 1 } }, { time: 1, parameters: { head: 0, hand: 0 } }
] });

test("model URLs use asset directories for public models and model directories for legacy layouts", () => {
  const model = { assetDir: "avatar-public", modelDir: "avatar-legacy" };
  assert.equal(modelAssetUrl(model, "avatar.model3.json", "/models"), "/models/avatar-public/avatar.model3.json");
  assert.equal(modelAssetUrl(model, "avatar.model3.json", "/l2d"), "/l2d/avatar-legacy/avatar.model3.json");
  assert.equal(modelAssetDirectory(model, "/models"), "avatar-public");
  assert.equal(modelAssetDirectory(model, "/l2d"), "avatar-legacy");
});

test("continuous and binary action targets both interpolate with smootherstep", () => {
  const plan = validateReplay(replay(), metadata);
  assert.deepEqual(sampleReplay(plan, -1), { head: 0, hand: 0 });
  assert.deepEqual(sampleReplay(plan, 0.25), { head: -3, hand: 0.5 });
  assert.deepEqual(sampleReplay(plan, 0.5), { head: -6, hand: 1 });
  assert.deepEqual(sampleReplay(plan, 0.75), { head: -3, hand: 0.5 });
  assert.deepEqual(sampleReplay(plan, 1), { head: 0, hand: 0 });
  assert.deepEqual(sampleReplay(plan, 2), { head: 0, hand: 0 });
});

test("discrete keyframes remain stepwise when no playback smoothing is requested", () => {
  const step = replay();
  delete step.smoothedDiscreteParameterIds;
  assert.equal(sampleReplay(step, 0.25).hand, 0);
  assert.equal(sampleReplay(step, 0.5).hand, 1);
  assert.equal(sampleReplay(step, 0.75).hand, 1);
});

test("strict hand switches stay binary after audio retiming", () => {
  const handPlan = replay();
  handPlan.handParameterIds = ["hand"];
  handPlan.strictDiscreteParameterIds = ["hand"];
  const adjusted = retimeReplay(handPlan, 2);
  assert.deepEqual(adjusted.strictDiscreteParameterIds, ["hand"]);
  assert.deepEqual(adjusted.smoothedDiscreteParameterIds, []);
  assert.equal(sampleReplay(adjusted, 0.99).hand, 0);
  assert.equal(sampleReplay(adjusted, 1).hand, 1);
  assert.equal(sampleReplay(adjusted, 1.5).hand, 1);
  assert.equal(sampleReplay(adjusted, 2).hand, 0);
  assert.equal(blendParameterPoses({ hand: 0 }, { hand: 1 }, 0.5, ["hand"]).hand, 0);
});

test("semantic gestures reinforce the channels that implement them", () => {
  const parameters = [
    { id: "ParamAngleX", name: "Head yaw" },
    { id: "ParamAngleY", name: "Head pitch" },
    { id: "ParamAngleZ", name: "Head roll" },
    { id: "ParamMouthForm", name: "Mouth form" },
    { id: "ParamEyeLSmile", name: "Left eye smile" },
    { id: "ParamEyeRSmile", name: "Right eye smile" },
    { id: "ParamEyeBallY", name: "Gaze Y" }
  ];
  const ids = inferSemanticParameterIds(parameters, [
    { gesture: "dip", expression: "warm", gaze: "down" },
    { gesture: "tilt", expression: "neutral", gaze: "contact" }
  ]);
  assert.deepEqual(new Set(ids), new Set([
    "ParamAngleY", "ParamAngleZ", "ParamMouthForm", "ParamEyeLSmile", "ParamEyeRSmile", "ParamEyeBallY"
  ]));
});

test("continuous replay following eases toward a new target while discrete switches stay binary", () => {
  const first = smoothParameterPose({ head: 0, hand: 0 }, { head: 12, hand: 1 }, 1 / 60, ["hand"], 20);
  assert.ok(first.head > 0 && first.head < 12);
  assert.equal(first.hand, 1);
  const smoothed = smoothParameterPose({ head: 0, hand: 0 }, { head: 12, hand: 1 }, 1 / 60, [], 20);
  assert.ok(smoothed.hand > 0 && smoothed.hand < 1);
  let pose = { head: 0, hand: 0 };
  for (let i = 0; i < 90; i++) pose = smoothParameterPose(pose, { head: 12, hand: 1 }, 1 / 60, ["hand"], 20);
  assert.ok(pose.head > 11.9);
  assert.equal(pose.hand, 1);
});

test("declared binary channels can use a slower rendered follow without changing targets", () => {
  const first = smoothParameterPose(
    { head: 0, hand: 0 },
    { head: 12, hand: 1 },
    1 / 60,
    [],
    20,
    { smoothedDiscreteParameterIds: ["hand"], discreteSpeed: 6 }
  );
  assert.ok(first.head > first.hand * 12);
  assert.ok(first.hand > 0 && first.hand < 1);
  let pose = { head: 0, hand: 0 };
  for (let i = 0; i < 60; i++) {
    pose = smoothParameterPose(pose, { head: 12, hand: 1 }, 1 / 60, [], 20, {
      smoothedDiscreteParameterIds: ["hand"], discreteSpeed: 6
    });
  }
  assert.ok(pose.hand > 0.98 && pose.hand < 1);
});

test("incomplete, invalid or misaligned provider output is rejected before playback", () => {
  const invalid = [
    p => { delete p.keyframes[0].parameters.head; },
    p => { p.keyframes[0].parameters.head = NaN; },
    p => { p.keyframes[0].parameters.head = 31; },
    p => { p.keyframes[0].parameters.hand = 0.5; },
    p => { p.keyframes[1].time = 0.5; },
    p => { p.durationSec = 2; },
    p => { p.initialParameters = {}; }
  ];
  for (const mutate of invalid) { const p = replay(); mutate(p); assert.throws(() => validateReplay(p, metadata)); }
});

test("decoded durations near a frame boundary do not create a tiny final transition", () => {
  for (const hz of [1, 2, 4]) {
    for (const duration of [0.12, 1, 3.5003958333, 6.71345833, 60]) {
      const times = buildFrameTimes(duration, hz);
      assert.equal(times.length, Math.ceil(duration * hz));
      assert.equal(times.at(-1), duration);
      assert.ok(times.every((t, i) => t > (times[i - 1] ?? 0)));
      const intervals = times.map((t, i) => t - (times[i - 1] ?? 0));
      assert.ok(Math.max(...intervals) - Math.min(...intervals) < 1e-10);
    }
  }
});

test("JEV choices map to declared values without filling in missing decisions", () => {
  assert.equal(decodeChoice({ type: "choice", choice: "down" }, { down: -6, up: 6 }), -6);
  assert.throws(() => decodeChoice({ type: "choice", choice: "unknown" }, { down: -6 }));
  assert.throws(() => decodeChoice({ type: "score", score: 0 }, { down: -6 }));
  assert.throws(() => decodeChoice(null, { down: -6 }));
  const anchors = parameterAnchors(metadata.head, 0.27);
  assert.ok(anchors.includes(0.27) && anchors.includes(-30) && anchors.includes(30));
  assert.ok(anchors.every((v, i) => v >= -30 && v <= 30 && (!i || v > anchors[i - 1])));
});

test("JEV decision diagnostics preserve choices and summarize confidence bands", () => {
  const answers = {
    clear: { type: "choice", choice: "yes", probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.8 },
    unsure: { type: "choice", choice: "maybe", probabilities: { maybe: 0.4, other: 0.35, no: 0.25 }, confidence: 0.2 },
    missing: { type: "choice", choice: "no" }
  };
  assert.deepEqual(compactDecisionAnswers(answers), {
    clear: { type: "choice", choice: "yes", confidence: 0.8 },
    unsure: { type: "choice", choice: "maybe", confidence: 0.2 },
    missing: { type: "choice", choice: "no" }
  });
  assert.deepEqual(summarizeDecisionConfidence(answers), {
    count: 3,
    withConfidence: 2,
    confidenceThresholds: { lowBelow: 0.5, highAtOrAbove: 0.75 },
    bands: { low: 1, medium: 0, high: 1 },
    min: 0.2,
    average: 0.5,
    max: 0.8
  });
});

test("continuous parameter choices use semantic levels mapped to each cdi3 range", () => {
  const symmetric = parameterValueOptions({ min: -30, max: 30, default: 0 });
  assert.deepEqual(Object.keys(symmetric), ["neutral", "smallNegative", "mediumNegative", "largeNegative", "smallPositive", "mediumPositive", "largePositive"]);
  assert.equal(symmetric.neutral, 0);
  assert.ok(symmetric.largeNegative < symmetric.mediumNegative && symmetric.mediumNegative < symmetric.smallNegative);
  assert.ok(symmetric.smallPositive < symmetric.mediumPositive && symmetric.mediumPositive < symmetric.largePositive);
  const topBound = parameterValueOptions({ min: 0, max: 1, default: 1 });
  assert.deepEqual(Object.keys(topBound), ["neutral", "smallNegative", "mediumNegative", "largeNegative"]);
  assert.equal(topBound.neutral, 1);
  assert.ok(Object.values(topBound).every(value => value >= 0 && value <= 1));
  assert.equal(parameterValueOptions({ min: -1, max: 1, default: 8 }).neutral, 1);
  assert.equal(symmetric.smallNegative, -10.5);
  assert.equal(symmetric.mediumNegative, -19.5);
});

test("explicit named effects remain discoverable despite reply wording", () => {
  const parameters = [
    { id: "Param8", name: "生气", min: 0, max: 1, default: 0 },
    { id: "Param9", name: "眼泪", min: 0, max: 1, default: 0 },
    { id: "ParamMouthForm", name: "嘴变形", min: -1, max: 1, default: 0 }
  ];
  assert.deepEqual(inferExplicitEffectParameterIds(parameters, "你做一个生气的表情我看看"), ["Param8"]);
  assert.deepEqual(inferExplicitEffectParameterIds(parameters, "请表现伤心，流眼泪"), ["Param9"]);
});

test("named wave switches are discoverable as hand action candidates", () => {
  const parameters = [
    { id: "Action_Wave", name: "挥手", min: 0, max: 1, default: 0 },
    { id: "Param74", name: "比心", min: 0, max: 1, default: 0 }
  ];
  assert.equal(isHandActionParameter(parameters[0]), true);
  assert.equal(isHandActionParameter(parameters[1]), true);
});

test("parameter ownership follows JEV gates and consistency selections", () => {
  const parameters = [{ id: "head" }, { id: "effect" }, { id: "idle" }];
  const firstPass = {
    o_head: { type: "choice", choice: "animate" },
    o_effect: { type: "choice", choice: "idle" },
    o_idle: { type: "choice", choice: "idle" }
  };
  assert.deepEqual(selectJevParameterIds(parameters, firstPass), ["head"]);
  assert.deepEqual(selectJevParameterIds(parameters, firstPass, ["effect"]), ["head", "effect"]);
  assert.deepEqual(selectJevParameterIds(parameters, firstPass, ["idle"]), ["head", "idle"]);
  assert.throws(() => selectJevParameterIds(parameters, { ...firstPass, o_head: { type: "choice", choice: "unknown" } }));
});

test("distinctive binary switches are discrete while standard channels remain continuous", () => {
  assert.equal(isDiscreteActionParameter({ id: "Param22", name: "手", min: 0, max: 1 }), true);
  assert.equal(isDiscreteActionParameter({ id: "Param40", name: "爱心眼", min: 0, max: 1 }), true);
  assert.equal(isDiscreteActionParameter({ id: "ParamEyeLOpen", name: "左眼开闭", min: 0, max: 1 }), false);
  assert.equal(isDiscreteActionParameter({ id: "ParamMouthOpenY", name: "嘴开闭", min: 0, max: 1 }), false);
  assert.equal(isDiscreteActionParameter({ id: "ParamBreath", name: "呼吸", min: 0, max: 1 }), false);
});

test("entry begins at the live pose and converges to JEV without changing its keyframes", () => {
  const plan = replay();
  const original = structuredClone(plan);
  const live = { head: 15, hand: 0 };
  assert.deepEqual(blendParameterPoses(live, sampleReplay(plan, 0), 0), live);
  assert.deepEqual(blendParameterPoses(live, { head: -5, hand: 1 }, 0.5), { head: 5, hand: 0.5 });
  assert.deepEqual(blendParameterPoses(live, sampleReplay(plan, 0.65), 1), sampleReplay(plan, 0.65));
  const frames = Array.from({ length: 40 }, (_, i) => blendParameterPoses(live, sampleReplay(plan, i / 60), i / 60 / 0.65));
  assert.ok(frames.every(p => p.head >= -6 && p.head <= 15 && p.hand >= 0 && p.hand <= 1));
  assert.ok(Math.max(...frames.slice(1).map((p, i) => Math.abs(p.head - frames[i].head))) < 1.2);
  assert.deepEqual(plan, original);
});

test("entry and release blends clamp time and ease into their endpoints", () => {
  const start = { head: 15, hand: 1 }, end = { head: -5, hand: 0 };
  assert.deepEqual(blendParameterPoses(start, end, -1), start);
  assert.deepEqual(blendParameterPoses(start, end, 2), end);
  assert.ok(Math.abs(blendParameterPoses(start, end, 0.001).head - start.head) < 1e-6);
  assert.ok(Math.abs(blendParameterPoses(start, end, 0.999).head - end.head) < 1e-6);
  const interrupted = blendParameterPoses(start, end, 0.3);
  assert.deepEqual(blendParameterPoses(interrupted, start, 0, ["hand"]), interrupted);
});

test("approximate motion timing stretches to audio without changing JEV parameters", () => {
  const original = replay();
  original.actions = [{ time: 0.5, gesture: "dip" }, { time: 1, gesture: "lift" }];
  const before = structuredClone(original);
  const adjusted = retimeReplay(original, 1.7);
  validateReplay(adjusted, metadata);
  assert.equal(adjusted.durationSec, 1.7);
  assert.equal(adjusted.plannedDurationSec, 1);
  assert.equal(adjusted.keyframes[0].time, 0.85);
  assert.equal(adjusted.actions[1].time, 1.7);
  assert.deepEqual(adjusted.keyframes.map(f => f.parameters), original.keyframes.map(f => f.parameters));
  assert.deepEqual(adjusted.smoothedDiscreteParameterIds, original.smoothedDiscreteParameterIds);
  assert.deepEqual(original, before);
  assert.throws(() => retimeReplay(original, NaN));
  assert.throws(() => retimeReplay(original, 0));
  assert.ok(estimateSpeechDuration("欢迎回来，我们一起聊聊天吧。") > estimateSpeechDuration("你好。"));
  assert.ok(estimateSpeechDuration("Hello, welcome back!") > 1);
});

test("relaxed motion pacing leaves a tail after audio and preserves keyframe values", () => {
  const original = replay();
  const duration = pacedMotionDuration(original.durationSec, 1.1);
  assert.ok(Math.abs(duration - 2.15) < 1e-9);
  const adjusted = retimeReplay(original, duration);
  assert.equal(adjusted.keyframes.at(-1).time, duration);
  assert.deepEqual(adjusted.keyframes.map(frame => frame.parameters), original.keyframes.map(frame => frame.parameters));
  assert.ok(adjusted.keyframes[0].time > 0.5);
  assert.throws(() => pacedMotionDuration(0, 1));
  assert.throws(() => pacedMotionDuration(1, 1, 0.9));
});

test("JEV takes only changed channels and leaves idle and physics live", () => {
  const plan = replay();
  const meta = { ...metadata, breath: { min: 0, max: 1 }, hair: { min: -1, max: 1 } };
  plan.initialParameters = { ...plan.initialParameters, breath: 0.5, hair: 0.2 };
  plan.keyframes.forEach(f => { f.parameters.breath = 0.5; f.parameters.hair = 0.2; });
  plan.directParameterIds = ["head", "breath"];
  const ids = replayOwnedParameterIds(plan, meta);
  assert.deepEqual(ids, ["head"]);
  const from = selectParameters({ head: 12, breath: 0.8 }, ids);
  for (const t of [0, 0.25, 0.65, 0.9]) {
    const idle = { head: 20, breath: t, hair: 0.7 - t };
    const overlay = blendParameterPoses(from, selectParameters(sampleReplay(plan, t), ids), t / 0.65);
    const mixed = { ...idle, ...overlay };
    assert.equal(mixed.breath, idle.breath);
    assert.equal(mixed.hair, idle.hair);
    if (t >= 0.65) assert.equal(mixed.head, sampleReplay(plan, t).head);
  }
});

test("active hands own all exclusive switches; inactive hands stay with idle", () => {
  const plan = replay();
  plan.directParameterIds = ["head"];
  plan.handParameterIds = ["hand", "otherHand"];
  plan.initialParameters.otherHand = 0;
  plan.keyframes.forEach(f => { f.parameters.otherHand = 0; });
  const meta = { ...metadata, otherHand: metadata.hand };
  assert.deepEqual(replayOwnedParameterIds(plan, meta), ["head", "hand", "otherHand"]);
  plan.keyframes.forEach(f => { f.parameters.hand = 0; });
  assert.deepEqual(replayOwnedParameterIds(plan, meta), ["head"]);
});
