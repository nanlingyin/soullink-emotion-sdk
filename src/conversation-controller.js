import { createIcons, Send, Square, Play, RotateCcw, Download, ZoomIn, ZoomOut, Scan } from "lucide";
import { validateReplay, sampleReplay, blendParameterPoses, smoothParameterPose, replayOwnedParameterIds, selectParameters } from "./parameter-replay.js";

const entryDurationSec = 0.85;
const releaseDurationSec = 0.6;
const replayFollowSpeed = 20;
const replayBinaryFollowSpeed = 6;

export function refreshConversationIcons() { createIcons({ icons: { Send, Square, Play, RotateCcw, Download, ZoomIn, ZoomOut, Scan } }); }

export function createConversationController({ getMetadata, capturePose, getModel, setStatus, onStart }) {
  const $ = id => document.getElementById(id);
  const history = [];
  let audioContext, current, prepared, phase = "idle", token = 0, aborter;
  let displayed = null, release = null, lastUi = 0;
  const labels = { idle: "就绪", reply: "生成回复", preparing: "生成语音和动作", tts: "合成语音", motion: "JEV 规划中", ready: "等待播放", playing: "播放中", complete: "播放完成", stopped: "已停止", error: "失败" };
  function status(next, detail = "") {
    phase = next;
    $("conversation-result").hidden = false;
    $("conversation-status").textContent = labels[next];
    $("conversation-status").title = detail;
    $("conversation-error").textContent = next === "error" ? detail : "";
    $("conversation-replay").disabled = !prepared;
    $("conversation-stop").disabled = !["reply", "preparing", "tts", "motion", "playing", "ready"].includes(next);
    setStatus(detail || labels[next], next === "error" ? "error" : ["reply", "preparing", "tts", "motion"].includes(next) ? "loading" : "ready");
  }
  function addTurn(role, content) {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = role === "user" ? "你" : getModel().displayName;
    const p = document.createElement("p");
    p.textContent = content;
    li.dataset.role = role;
    li.append(name, p);
    $("conversation-history").append(li);
    $("conversation-history").scrollTop = $("conversation-history").scrollHeight;
  }
  async function post(path, body, signal, binary = false) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return binary ? response.arrayBuffer() : response.json();
  }
  function context() { audioContext ??= new AudioContext(); return audioContext; }
  function releasePose(strictDiscreteParameterIds = current?.telemetry?.strictDiscreteParameterIds ?? []) {
    if (displayed) release = {
      from: displayed,
      startedAt: performance.now() / 1000,
      strictDiscreteParameterIds
    };
  }
  function stop(show = true) {
    token++;
    aborter?.abort();
    aborter = null;
    const strictDiscreteParameterIds = current?.telemetry?.strictDiscreteParameterIds ?? [];
    if (current) {
      const active = current;
      active.source.onended = null;
      if (!active.audioEnded) active.source.stop();
      active.source.disconnect();
      void post("/api/conversation/playback", { id: current.plan.id, telemetry: { ...current.telemetry, state: "stopped", elapsedSec: Math.max(0, context().currentTime - current.startedAt) } }).catch(() => {});
      current = null;
    }
    releasePose(strictDiscreteParameterIds);
    if (show) status("stopped"); else phase = "idle";
  }
  function rmsEnvelope(buffer) {
    const data = buffer.getChannelData(0), hop = Math.max(1, Math.floor(buffer.sampleRate * 0.02));
    const values = [];
    for (let start = 0; start < data.length; start += hop) {
      let sum = 0;
      const end = Math.min(data.length, start + hop);
      for (let i = start; i < end; i++) sum += data[i] ** 2;
      values.push(Math.sqrt(sum / (end - start)));
    }
    return values;
  }
  async function play() {
    if (!prepared) return;
    const data = prepared;
    stop(false);
    const playToken = token;
    await context().resume();
    if (playToken !== token) return;
    if (context().state !== "running") { status("ready", "音频尚未解锁，请点击播放"); return; }
    const ownedIds = replayOwnedParameterIds(data.plan, getMetadata());
    const entryFrom = selectParameters(capturePose(), ownedIds);
    const strictDiscreteParameterIds = (data.plan.strictDiscreteParameterIds
      ?? data.plan.handParameterIds
      ?? []).filter(id => ownedIds.includes(id));
    const smoothedDiscreteParameterIds = (data.plan.smoothedDiscreteParameterIds
      ?? data.plan.discreteParameterIds
      ?? []).filter(id => ownedIds.includes(id) && !strictDiscreteParameterIds.includes(id));
    onStart();
    const source = context().createBufferSource();
    source.buffer = data.buffer;
    source.connect(context().destination);
    const startedAt = context().currentTime + 0.06;
    const telemetry = { audioDurationSec: data.buffer.duration, motionDurationSec: data.plan.durationSec, audioStartContextSec: startedAt,
      entryTransition: {
        durationSec: entryDurationSec,
        source: "last rendered pose after generation",
        easing: "smootherstep + continuous follow smoothing",
        followSpeed: replayFollowSpeed,
        binaryFollowSpeed: replayBinaryFollowSpeed,
        strictDiscreteParameterIds,
        smoothedDiscreteParameterIds,
        initialParameters: entryFrom
      },
      plannedDurationSec: data.plan.plannedDurationSec, timingAdjustment: data.plan.timingAdjustment,
      motionPacing: data.plan.motionPacing,
      ownedParameterIds: ownedIds, idleContinues: true,
      strictDiscreteParameterIds,
      smoothedDiscreteParameterIds,
      timeSource: "AudioContext.currentTime", samples: [], binarySamples: [], mouthMin: 1, mouthMax: 0, state: "playing" };
    release = null;
    current = { ...data, source, startedAt, telemetry, entryFrom, ownedIds, lastSampleTime: null };
    displayed = entryFrom;
    const finish = () => {
      if (current?.source !== source || current.motionEnded) return;
      const strictDiscreteParameterIds = current.telemetry.strictDiscreteParameterIds ?? [];
      current.motionEnded = true;
      telemetry.state = "complete";
      telemetry.motionEndedAtContextSec = context().currentTime;
      $("conversation-progress").value = 1;
      $("conversation-clock").textContent = `${data.plan.durationSec.toFixed(2)} / ${data.plan.durationSec.toFixed(2)} s`;
      source.disconnect();
      current = null;
      releasePose(strictDiscreteParameterIds);
      status("complete");
      void post("/api/conversation/playback", { id: data.plan.id, telemetry }).catch(() => {});
    };
    current.finish = finish;
    source.onended = () => {
      if (current?.source !== source) return;
      current.audioEnded = true;
      telemetry.audioEndedAtContextSec = context().currentTime;
      source.disconnect();
      if (context().currentTime - startedAt >= data.plan.durationSec) finish();
    };
    source.start(startedAt);
    status("playing");
  }
  async function submit(message) {
    if (!Object.keys(getMetadata()).length) { status("error", "模型未就绪"); return; }
    stop(false);
    prepared = null;
    $("conversation-progress").value = 0;
    $("conversation-clock").textContent = "0.00 s";
    $("conversation-motion-stats").textContent = "";
    $("conversation-actions").replaceChildren();
    $("conversation-report").setAttribute("aria-disabled", "true");
    const requestToken = token;
    aborter = new AbortController();
    const { signal } = aborter;
    // Resume inside the user gesture, before any network awaits.
    void context().resume();
    addTurn("user", message);
    $("conversation-error").textContent = "";
    status("reply");
    let id;
    try {
      const reply = await post("/api/conversation/reply", { message, conversation: history, characterName: getModel().displayName }, signal);
      signal.throwIfAborted();
      id = reply.id;
      addTurn("assistant", reply.reply);
      history.push({ role: "user", content: message }, { role: "assistant", content: reply.reply });
      if (history.length > 40) history.splice(0, history.length - 40);
      const link = $("conversation-report");
      link.href = reply.reportUrl;
      link.download = `${id}.json`;
      link.removeAttribute("aria-disabled");
      status("preparing");
      const initial = capturePose();
      let audioReady = false, motionReady = false;
      const audioTask = post("/api/tts/fish", { id, model: $("fish-model").value }, signal, true)
        .then(bytes => context().decodeAudioData(bytes)).then(buffer => {
          signal.throwIfAborted();
          audioReady = true;
          $("conversation-duration").textContent = `${buffer.duration.toFixed(2)} s`;
          if (!motionReady) status("motion");
          return buffer;
        });
      const motionTask = post("/api/jev/parameter-plan", { id, keyframesPerSecond: Number($("conversation-hz").value),
        modelAssetDir: getModel().assetDir, availableParameters: getMetadata(), initialParameters: initial }, signal).then(plan => {
          signal.throwIfAborted();
          validateReplay(plan, getMetadata());
          motionReady = true;
          if (!audioReady) status("tts");
          return plan;
        });
      const [buffer] = await Promise.all([audioTask, motionTask]);
      signal.throwIfAborted();
      const plan = await post("/api/conversation/ready", { id, durationSec: buffer.duration }, signal);
      signal.throwIfAborted();
      validateReplay(plan, getMetadata());
      prepared = { plan, buffer, envelope: rmsEnvelope(buffer) };
      const pacing = plan.durationSec > buffer.duration + 0.01
        ? ` · 音频 ${buffer.duration.toFixed(2)}s / 动作 ${plan.durationSec.toFixed(2)}s`
        : ` · ${buffer.duration.toFixed(2)}s`;
      $("conversation-motion-stats").textContent = `${plan.frameCount} 帧 · ${plan.ownedParameterIds.length} 接管参数${pacing} · ${(plan.generationMs / 1000).toFixed(1)} s 生成`;
      $("conversation-actions").replaceChildren(...plan.actions.map(action => {
        const li = document.createElement("li");
        li.textContent = `${action.time.toFixed(2)}s  ${action.gesture} / ${action.expression} / ${action.hand}`;
        return li;
      }));
      if (requestToken === token) await play();
    } catch (error) {
      if (requestToken !== token || signal.aborted) return;
      aborter?.abort();
      releasePose();
      status("error", error.message);
      if (id) void post("/api/conversation/playback", { id, telemetry: { state: "client-error", message: error.message } }).catch(() => {});
    }
  }
  function update(base) {
    if (current) {
      const rawTime = Math.max(0, context().currentTime - current.startedAt);
      const time = Math.min(current.plan.durationSec, rawTime);
      const target = selectParameters(sampleReplay(current.plan, time), current.ownedIds);
      const audioTime = Math.min(current.buffer.duration, rawTime);
      const energy = rawTime <= current.buffer.duration
        ? current.envelope[Math.min(current.envelope.length - 1, Math.floor(audioTime / 0.02))] ?? 0
        : 0;
      const mouth = Math.min(1, Math.max(0, (energy - 0.008) * 8));
      if (getMetadata().ParamMouthOpenY) target.ParamMouthOpenY = mouth * Math.min(1, getMetadata().ParamMouthOpenY.max);
      const entryProgress = Math.min(1, time / entryDurationSec);
      // Binary channels declared as strict remain 0/1. Other declared binary
      // effects may use the slower rendered transition below.
      const strictDiscreteParameterIds = current.telemetry.strictDiscreteParameterIds ?? [];
      const easedTarget = blendParameterPoses(current.entryFrom, target, entryProgress);
      // A strict switch cannot be eased without sending an invalid fractional
      // value to the model, so it follows the scheduled JEV target directly.
      for (const id of strictDiscreteParameterIds) {
        if (Object.hasOwn(target, id)) easedTarget[id] = target[id];
      }
      const previousTime = current.lastSampleTime;
      current.lastSampleTime = time;
      displayed = previousTime === null
        ? easedTarget
        : smoothParameterPose(
          displayed ?? current.entryFrom,
          easedTarget,
          time - previousTime,
          strictDiscreteParameterIds,
          replayFollowSpeed,
          { smoothedDiscreteParameterIds: current.telemetry.smoothedDiscreteParameterIds, discreteSpeed: replayBinaryFollowSpeed }
        );
      const renderedMouth = displayed.ParamMouthOpenY ?? mouth;
      current.telemetry.mouthMin = Math.min(current.telemetry.mouthMin, renderedMouth);
      current.telemetry.mouthMax = Math.max(current.telemetry.mouthMax, renderedMouth);
      if (performance.now() - lastUi > 80) {
        lastUi = performance.now();
        $("conversation-progress").value = time / current.plan.durationSec;
        $("conversation-clock").textContent = `${time.toFixed(2)} / ${current.plan.durationSec.toFixed(2)} s`;
        if (current.telemetry.samples.length < 150) current.telemetry.samples.push({ time, entryProgress, headY: displayed.ParamAngleY ?? base.ParamAngleY, breath: displayed.ParamBreath ?? base.ParamBreath, mouth: renderedMouth });
        if (current.telemetry.binarySamples.length < 150 && current.telemetry.smoothedDiscreteParameterIds.length) {
          current.telemetry.binarySamples.push({
            time,
            values: Object.fromEntries(current.telemetry.smoothedDiscreteParameterIds.map(id => [id, displayed[id]]))
          });
        }
      }
      if (rawTime >= current.plan.durationSec && (current.audioEnded || rawTime >= current.buffer.duration)) current.finish?.();
      return displayed;
    }
    if (release) {
      const t = Math.min(1, (performance.now() / 1000 - release.startedAt) / releaseDurationSec);
      const meta = getMetadata();
      const target = Object.fromEntries(Object.entries(release.from).map(([id, value]) => [id, base[id] ?? meta[id]?.default ?? value]));
      const strictDiscreteParameterIds = release.strictDiscreteParameterIds ?? [];
      const output = blendParameterPoses(release.from, target, t, strictDiscreteParameterIds);
      displayed = output;
      if (t === 1) { release = null; displayed = null; }
      return output;
    }
    return null;
  }
  $("conversation-stop").addEventListener("click", () => stop());
  $("conversation-replay").addEventListener("click", () => void play().catch(error => status("error", error.message)));
  $("conversation-reset").addEventListener("click", () => {
    stop(false); prepared = null; history.length = 0;
    $("conversation-history").replaceChildren();
    $("conversation-actions").replaceChildren();
    $("conversation-motion-stats").textContent = "";
    $("conversation-progress").value = 0;
    $("conversation-clock").textContent = "0.00 s";
    $("conversation-duration").textContent = "0.00 s";
    $("conversation-report").removeAttribute("href");
    $("conversation-report").setAttribute("aria-disabled", "true");
    status("idle");
  });
  window.addEventListener("beforeunload", () => { stop(false); void audioContext?.close(); });
  return { submit, stop, update, get state() { return { phase, history: [...history], plan: prepared?.plan, telemetry: current?.telemetry, parameters: displayed, audioTime: current ? context().currentTime - current.startedAt : null }; } };
}
