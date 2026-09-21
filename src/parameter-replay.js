export function validateReplay(replay, metadata) {
  if (!Number.isFinite(replay?.durationSec) || replay.durationSec <= 0 || replay.durationSec > 60) throw new Error("Invalid replay duration");
  if (!Array.isArray(replay.keyframes) || !replay.keyframes.length || replay.keyframes.length > 240) throw new Error("Invalid keyframes");
  const ids = Object.keys(metadata);
  const discrete = new Set(replay.discreteParameterIds ?? []);
  let previous = 0;
  const poses = [{ time: 0, parameters: replay.initialParameters }, ...replay.keyframes];
  for (const [index, pose] of poses.entries()) {
    if (index && (!Number.isFinite(pose.time) || pose.time <= previous || pose.time > replay.durationSec + 1e-6)) throw new Error("Keyframes must have increasing timestamps");
    previous = pose.time;
    if (!pose.parameters || Object.keys(pose.parameters).length !== ids.length) throw new Error("Replay must cover every model parameter in every frame");
    for (const id of ids) {
      const value = pose.parameters[id], p = metadata[id];
      if (!Number.isFinite(value) || value < p.min - 1e-6 || value > p.max + 1e-6) throw new Error(`Invalid parameter: ${id}`);
      if (discrete.has(id) && value !== 0 && value !== 1) throw new Error(`Invalid switch: ${id}`);
    }
  }
  if (Math.abs(previous - replay.durationSec) > 1e-4) throw new Error("Final keyframe does not match audio duration");
  return replay;
}

export function sampleReplay(replay, time) {
  let from = replay.initialParameters, fromTime = 0;
  const discrete = new Set(replay.discreteParameterIds ?? []);
  const smoothedDiscrete = new Set(replay.smoothedDiscreteParameterIds ?? []);
  for (const frame of replay.keyframes) {
    if (time <= frame.time) {
      const t = Math.max(0, Math.min(1, (time - fromTime) / (frame.time - fromTime)));
      // Smootherstep has zero velocity and acceleration at both keyframes.
      const u = t * t * t * (t * (t * 6 - 15) + 10);
      return Object.fromEntries(Object.entries(frame.parameters).map(([id, value]) => [id,
        discrete.has(id) && !smoothedDiscrete.has(id) ? (t >= 1 ? value : from[id]) : from[id] + (value - from[id]) * u
      ]));
    }
    fromTime = frame.time;
    from = frame.parameters;
  }
  return { ...from };
}

export function smoothParameterPose(
  from,
  to,
  deltaSeconds,
  discreteParameterIds = [],
  speed = 18,
  { smoothedDiscreteParameterIds = [], discreteSpeed = Math.min(speed, 8) } = {}
) {
  const delta = Math.max(0, Math.min(0.25, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
  const factor = delta === 0 ? 0 : 1 - Math.exp(-Math.max(0, speed) * delta);
  const discrete = new Set(discreteParameterIds);
  const smoothedDiscrete = new Set(smoothedDiscreteParameterIds);
  const discreteFactor = delta === 0 ? 0 : 1 - Math.exp(-Math.max(0, discreteSpeed) * delta);
  return Object.fromEntries(Object.entries(to).map(([id, target]) => {
    const previous = from[id] ?? target;
    return [id, discrete.has(id)
      ? target
      : previous + (target - previous) * (smoothedDiscrete.has(id) ? discreteFactor : factor)];
  }));
}

export function blendParameterPoses(from, to, progress, discreteParameterIds = []) {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return { ...from };
  if (t === 1) return { ...to };
  // Zero velocity and acceleration at either end of the transition.
  const weight = t * t * t * (t * (t * 6 - 15) + 10);
  const discrete = new Set(discreteParameterIds);
  return Object.fromEntries(Object.entries(to).map(([id, target]) => [id,
    discrete.has(id) ? (t < 1 ? from[id] : target) : from[id] + (target - from[id]) * weight
  ]));
}

export function retimeReplay(replay, durationSec) {
  if (![durationSec, replay.durationSec].every(v => Number.isFinite(v) && v > 0 && v <= 60)) throw new Error("Invalid replay duration");
  const ratio = durationSec / replay.durationSec;
  const retime = (item, index, items) => ({ ...item, time: index === items.length - 1 ? durationSec : item.time * ratio });
  const actions = replay.actions?.map(retime);
  const strictDiscrete = new Set(replay.strictDiscreteParameterIds ?? replay.handParameterIds ?? []);
  const declaredSmoothed = replay.smoothedDiscreteParameterIds
    ? [...replay.smoothedDiscreteParameterIds]
    : replay.discreteParameterIds ? [...replay.discreteParameterIds] : [];
  return {
    ...replay,
    discreteParameterIds: replay.discreteParameterIds ? [...replay.discreteParameterIds] : [],
    strictDiscreteParameterIds: [...strictDiscrete],
    smoothedDiscreteParameterIds: declaredSmoothed.filter(id => !strictDiscrete.has(id)),
    plannedDurationSec: replay.durationSec,
    durationSec,
    timingAdjustment: { source: "decoded audio duration", ratio, parametersChanged: false },
    actions,
    keyframes: replay.keyframes.map((frame, index, frames) => ({ ...retime(frame, index, frames), ...(actions ? { action: actions[index] } : {}) }))
  };
}

export function replayOwnedParameterIds(replay, metadata) {
  const changed = id => {
    const p = metadata[id];
    const epsilon = Math.max(1e-6, (p.max - p.min) * 1e-5);
    return replay.keyframes.some(f => Math.abs(f.parameters[id] - replay.initialParameters[id]) > epsilon);
  };
  const direct = (replay.directParameterIds ?? []).filter(id => metadata[id] && changed(id));
  const hands = (replay.handParameterIds ?? []).filter(id => metadata[id]);
  // Hand switches are one exclusive group; owning just the enabled switch can leave extra hands visible.
  const ownsHands = hands.some(id => changed(id) || replay.keyframes.some(f => f.parameters[id] !== 0));
  return [...new Set([...direct, ...(ownsHands ? hands : []), ...(metadata.ParamMouthOpenY ? ["ParamMouthOpenY"] : [])])];
}

export function selectParameters(pose, ids) {
  return Object.fromEntries(ids.map(id => [id, pose[id]]));
}
