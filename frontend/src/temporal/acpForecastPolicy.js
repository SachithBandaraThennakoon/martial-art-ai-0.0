const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : 0;
}

function pointDistance(first, second) {
  if (!first || !second) return null;
  return Math.hypot(
    (first.x || 0) - (second.x || 0),
    (first.y || 0) - (second.y || 0),
    (first.z || 0) - (second.z || 0)
  );
}

function bodyScale(landmarks = []) {
  const shoulderWidth = pointDistance(landmarks[11], landmarks[12]) || 0;
  const hipWidth = pointDistance(landmarks[23], landmarks[24]) || 0;
  const shoulderCenter = landmarks[11] && landmarks[12]
    ? {
        x: (landmarks[11].x + landmarks[12].x) / 2,
        y: (landmarks[11].y + landmarks[12].y) / 2,
        z: ((landmarks[11].z || 0) + (landmarks[12].z || 0)) / 2
      }
    : null;
  const hipCenter = landmarks[23] && landmarks[24]
    ? {
        x: (landmarks[23].x + landmarks[24].x) / 2,
        y: (landmarks[23].y + landmarks[24].y) / 2,
        z: ((landmarks[23].z || 0) + (landmarks[24].z || 0)) / 2
      }
    : null;
  return Math.max(shoulderWidth, hipWidth, pointDistance(shoulderCenter, hipCenter) || 0, 0.001);
}

export function getAcpHorizonBaseWeight(horizonFrame) {
  if (horizonFrame <= 3) return 1;
  if (horizonFrame <= 6) return 0.85;
  if (horizonFrame <= 12) return 0.6;
  if (horizonFrame <= 18) return 0.4;
  if (horizonFrame <= 24) return 0.25;
  return 0.15;
}

export function normalizedPoseError(predicted = [], observed = []) {
  const error = average(
    KEY_JOINTS.map((index) => pointDistance(predicted[index], observed[index]))
  );
  return error / bodyScale(observed);
}

export function reliabilityFromPoseError(error) {
  if (!Number.isFinite(error)) return 0;
  return clamp(Math.exp(-error / 0.22));
}

function annotateFrames(frames, reliability, trackingConfidence) {
  return frames.map((frame) => {
    const horizonFrame = frame.horizon_frame ?? frame.horizonFrame;
    const horizonReliability = reliability[horizonFrame] ?? 1;
    return {
      ...frame,
      horizon_reliability: Number(horizonReliability.toFixed(3)),
      weight: Number((
        getAcpHorizonBaseWeight(horizonFrame) *
        clamp(trackingConfidence) *
        horizonReliability
      ).toFixed(3))
    };
  });
}

export function summarizeAcpTrajectory(frames = [], sourceLandmarks = []) {
  if (!frames.length || !sourceLandmarks.length) {
    return {
      intent: "unavailable",
      confidence: 0,
      peak_horizon_frame: null,
      peak_eta_ms: null,
      return_likely: false
    };
  }

  const scale = bodyScale(sourceLandmarks);
  const samples = frames.map((frame) => {
    const normalizedJointDisplacements = KEY_JOINTS
      .map((index) => pointDistance(frame.landmarks?.[index], sourceLandmarks[index]))
      .filter(Number.isFinite)
      .map((distance) => distance / scale);
    const normalizedHandDisplacements = [15, 16]
      .map((index) => pointDistance(frame.landmarks?.[index], sourceLandmarks[index]))
      .filter(Number.isFinite)
      .map((distance) => distance / scale);
    // A punch can move one wrist substantially while most of the body stays still.
    // Preserve that signal instead of diluting it across all tracked joints.
    const displacement = Math.max(
      average(normalizedJointDisplacements),
      Math.max(0, ...normalizedHandDisplacements) * 0.55
    );
    return { frame, displacement };
  });
  const peak = samples.reduce(
    (best, sample) => sample.displacement > best.displacement ? sample : best,
    samples[0]
  );
  const final = samples[samples.length - 1];
  const totalWeight = frames.reduce((total, frame) => total + (frame.weight || 0), 0);
  const confidence = totalWeight / Math.max(
    frames.reduce(
      (total, frame) => total + getAcpHorizonBaseWeight(frame.horizon_frame),
      0
    ),
    0.001
  );

  return {
    intent: peak.displacement >= 0.08 ? "movement_likely" : "hold_likely",
    confidence: Number(clamp(confidence).toFixed(3)),
    peak_displacement: Number(peak.displacement.toFixed(4)),
    peak_horizon_frame: peak.frame.horizon_frame,
    peak_eta_ms: peak.frame.horizon_ms,
    return_likely:
      peak.frame.horizon_frame < final.frame.horizon_frame &&
      final.displacement <= peak.displacement * 0.72,
    terminal_displacement: Number(final.displacement.toFixed(4))
  };
}

function createBand(frames, start, end, sourceLandmarks) {
  const selected = frames.filter(
    (frame) => frame.horizon_frame >= start && frame.horizon_frame <= end
  );
  return {
    start_frame: start,
    end_frame: end,
    horizon_ms: selected[selected.length - 1]?.horizon_ms || 0,
    frames: selected,
    summary: summarizeAcpTrajectory(selected, sourceLandmarks)
  };
}

export function buildAcpForecastBands({
  frames = [],
  sourceLandmarks = [],
  reliability = {},
  trackingConfidence = 0
} = {}) {
  const annotated = annotateFrames(frames, reliability, trackingConfidence);
  return {
    level1: createBand(annotated, 1, 6, sourceLandmarks),
    level2: createBand(annotated, 1, 12, sourceLandmarks),
    awareness: createBand(annotated, 4, 12, sourceLandmarks),
    level3: createBand(annotated, 1, 30, sourceLandmarks)
  };
}
