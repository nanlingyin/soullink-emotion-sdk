import assert from "node:assert/strict";
import {
  MessageReactionClassifier,
  SoullinkRuntime,
  computeAdaptationCoverage,
  detectCapabilities
} from "./packages/engine/dist/index.js";

// A minimal Cubism-compatible profile. Replace these parameter ids with ids
// from your model's .cdi3.json when integrating a real Live2D model.
const profile = {
  modelId: "smoke-test-model",
  displayName: "Smoke Test Model",
  version: "1.0.0",
  schemaVersion: 2,
  modelPath: "./model.model3.json",
  parameterMap: {
    headX: { target: "ParamAngleX", mode: "set", scale: 30, min: -30, max: 30 },
    headY: { target: "ParamAngleY", mode: "set", scale: 30, min: -30, max: 30 },
    headZ: { target: "ParamAngleZ", mode: "set", scale: 30, min: -30, max: 30 },
    bodyX: { target: "ParamBodyAngleX", mode: "set", scale: 10, min: -10, max: 10 },
    eyeOpen: {
      targets: ["ParamEyeLOpen", "ParamEyeROpen"],
      mode: "set",
      scale: 1,
      min: 0,
      max: 1
    },
    eyeBlinkL: { target: "ParamEyeLOpen", mode: "add", scale: -1, min: 0, max: 1 },
    eyeBlinkR: { target: "ParamEyeROpen", mode: "add", scale: -1, min: 0, max: 1 },
    eyeSmile: {
      targets: ["ParamEyeLSmile", "ParamEyeRSmile"],
      mode: "set",
      scale: 1,
      min: 0,
      max: 1
    },
    browUp: {
      targets: ["ParamBrowLY", "ParamBrowRY"],
      mode: "set",
      scale: 1,
      min: -1,
      max: 1
    },
    mouthOpen: { target: "ParamMouthOpenY", mode: "set", scale: 1, min: 0, max: 1 },
    mouthSmile: { target: "ParamMouthForm", mode: "set", scale: 1, min: -1, max: 1 },
    blush: { target: "ParamCheek", mode: "set", scale: 1, min: 0, max: 1 },
    breath: { target: "ParamBreath", mode: "set", scale: 1, min: 0, max: 1 }
  },
  idleConfig: {}
};

function testClassifier() {
  const classifier = new MessageReactionClassifier();

  assert.equal(classifier.classify("考试通过了，这是好消息").emotion, "happy");
  assert.equal(classifier.classify("今天有点难过").emotion, "sad");
  assert.equal(classifier.classify("为什么会这样？").emotion, "confused");

  console.log("PASS classifier: happy / sad / confused");
}

function testProfileInspection() {
  const capabilities = detectCapabilities(profile);
  const parameterIds = [
    ...new Set(
      Object.values(profile.parameterMap).flatMap((rule) =>
        rule.targets ?? (rule.target ? [rule.target] : [])
      )
    )
  ];
  const cdiParameters = parameterIds.map((id) => ({
    id,
    name: id,
    groupId: "test",
    groupName: "Smoke test"
  }));
  const coverage = computeAdaptationCoverage(profile, cdiParameters, {
    modelDir: ".",
    provider: "manual"
  });

  assert.equal(capabilities.headControl, true);
  assert.equal(capabilities.eyeBlink, true);
  assert.equal(capabilities.mouthOpen, true);
  assert.ok(coverage.mappedKeyCount > 0);

  console.log(
    `PASS profile: ${coverage.mappedKeyCount} FACS channels mapped, ` +
      `${coverage.usedCdiParameterCount} Live2D parameters used`
  );
}

function testRuntime() {
  const runtime = new SoullinkRuntime({ profile });
  const intent = runtime.sendMessage("考试通过了，这是好消息", 0);

  assert.equal(intent.emotion, "happy");

  const frames = [];
  for (let frame = 0; frame < 120; frame += 1) {
    const time = frame / 60;
    frames.push(runtime.update(time, 1 / 60));
  }

  const last = frames.at(-1);
  assert.equal(last.emotionIntent?.emotion, "happy");
  assert.ok(last.vad.current.valence > 0, "happy intent should produce positive valence");
  assert.ok(Object.keys(last.live2dParams).length > 0, "runtime should emit Live2D parameters");

  for (const snapshot of frames) {
    for (const value of Object.values(snapshot.live2dParams)) {
      assert.ok(Number.isFinite(value), "every Live2D parameter must be finite");
    }
  }

  const headSamples = frames.map((frame) => frame.live2dParams.ParamAngleX ?? 0);
  const headRange = Math.max(...headSamples) - Math.min(...headSamples);
  assert.ok(headRange > 0.001, "idle/reaction animation should vary the head angle");

  console.log(
    `PASS runtime: emotion=${last.emotionIntent.emotion}, ` +
      `valence=${last.vad.current.valence.toFixed(3)}, ` +
      `parameters=${Object.keys(last.live2dParams).length}, ` +
      `headRange=${headRange.toFixed(3)}`
  );
}

testClassifier();
testProfileInspection();
testRuntime();
console.log("All engine smoke tests passed.");
