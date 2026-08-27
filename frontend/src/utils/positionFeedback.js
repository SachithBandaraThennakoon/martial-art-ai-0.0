const LANDMARK_INDEX = {
  head: 0,
  shoulder_left: 11,
  shoulder_right: 12,
  elbow_left: 13,
  elbow_right: 14,
  wrist_left: 15,
  wrist_right: 16,
  hip_left: 23,
  hip_right: 24,
  knee_left: 25,
  knee_right: 26,
  ankle_left: 27,
  ankle_right: 28,
  foot_left: 31,
  foot_right: 32
};

const MIN_VISIBILITY = 0.55;
const MIN_DEPTH_VISIBILITY = 0.7;
const DEFAULT_DEPTH_TOLERANCE_SCALE = 1.75;
const WORLD_METERS_TO_CENTIMETERS = 100;

const averagePoint = (first, second) => ({
  x: (Number(first.x) + Number(second.x)) / 2,
  y: (Number(first.y) + Number(second.y)) / 2,
  z: (Number(first.z || 0) + Number(second.z || 0)) / 2
});

function usable(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    (point.visibility == null || point.visibility >= MIN_VISIBILITY);
}

const subtract = (first, second) => ({
  x: Number(first.x) - Number(second.x),
  y: Number(first.y) - Number(second.y),
  z: Number(first.z || 0) - Number(second.z || 0)
});

const dot = (first, second) =>
  first.x * second.x + first.y * second.y + first.z * second.z;

const scale = (vector, amount) => ({
  x: vector.x * amount,
  y: vector.y * amount,
  z: vector.z * amount
});

const cross = (first, second) => ({
  x: first.y * second.z - first.z * second.y,
  y: first.z * second.x - first.x * second.z,
  z: first.x * second.y - first.y * second.x
});

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0.0001 ? scale(vector, 1 / length) : null;
}

function normalizedCandidates(pose) {
  const leftHip = pose?.[23];
  const rightHip = pose?.[24];
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(usable)) return null;

  const hipCenter = averagePoint(leftHip, rightHip);
  const shoulderCenter = averagePoint(leftShoulder, rightShoulder);
  const torsoLength = Math.hypot(
    shoulderCenter.x - hipCenter.x,
    shoulderCenter.y - hipCenter.y,
    shoulderCenter.z - hipCenter.z
  );
  if (!Number.isFinite(torsoLength) || torsoLength < 0.02) return null;

  const rightAxis = unit(subtract(rightHip, leftHip));
  const rawUpAxis = unit(subtract(shoulderCenter, hipCenter));
  if (!rightAxis || !rawUpAxis) return null;
  // Remove camera-view roll from the vertical axis and construct a complete
  // body-local frame. This makes XYZ comparisons follow the athlete rather
  // than the camera when the athlete shifts or turns.
  const upAxis = unit(subtract(rawUpAxis, scale(rightAxis, dot(rawUpAxis, rightAxis))));
  const forwardAxis = upAxis ? unit(cross(rightAxis, upAxis)) : null;
  if (!upAxis || !forwardAxis) return null;

  const build = (xSign, zSign) => {
    const result = Object.fromEntries(Object.entries(LANDMARK_INDEX).flatMap(([name, index]) => {
      const point = pose[index];
      if (!usable(point)) return [];
      const relative = subtract(point, hipCenter);
      const normalizedX = xSign * dot(relative, rightAxis) / torsoLength;
      const normalizedY = dot(relative, upAxis) / torsoLength;
      const normalizedZ = zSign * dot(relative, forwardAxis) / torsoLength;
      return [[name, {
        x: Object.is(normalizedX, -0) ? 0 : normalizedX,
        y: Object.is(normalizedY, -0) ? 0 : normalizedY,
        z: Object.is(normalizedZ, -0) ? 0 : normalizedZ,
        visibility: point.visibility ?? 1
      }]];
    }));
    Object.defineProperty(result, "__normalization", {
      value: {
        coordinateFrame: "body_oriented_v2",
        torsoLengthMeters: torsoLength
      },
      enumerable: false
    });
    return result;
  };
  return [build(1, 1), build(1, -1), build(-1, 1), build(-1, -1)];
}

function alignmentError(candidate, reference) {
  return Object.keys(reference)
    .reduce((sum, name) => {
      const live = candidate[name];
      const target = reference[name];
      if (!live || !Array.isArray(target)) return sum;
      return sum +
        Math.abs(live.x - Number(target[0])) +
        Math.abs(live.y - Number(target[1])) +
        Math.abs(live.z - Number(target[2]));
    }, 0);
}

function bodyOrientReference(reference) {
  const point = (name) => {
    const value = reference?.[name];
    return Array.isArray(value)
      ? { x: Number(value[0]), y: Number(value[1]), z: Number(value[2] || 0) }
      : null;
  };
  const leftHip = point("hip_left");
  const rightHip = point("hip_right");
  const leftShoulder = point("shoulder_left");
  const rightShoulder = point("shoulder_right");
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(Boolean)) return reference;

  const hipCenter = averagePoint(leftHip, rightHip);
  const shoulderCenter = averagePoint(leftShoulder, rightShoulder);
  const torsoLength = Math.hypot(
    shoulderCenter.x - hipCenter.x,
    shoulderCenter.y - hipCenter.y,
    shoulderCenter.z - hipCenter.z
  );
  const rightAxis = unit(subtract(rightHip, leftHip));
  const rawUpAxis = unit(subtract(shoulderCenter, hipCenter));
  if (!rightAxis || !rawUpAxis || torsoLength < 0.001) return reference;
  const upAxis = unit(subtract(rawUpAxis, scale(rightAxis, dot(rawUpAxis, rightAxis))));
  const forwardAxis = upAxis ? unit(cross(rightAxis, upAxis)) : null;
  if (!upAxis || !forwardAxis) return reference;

  return Object.fromEntries(Object.entries(reference).map(([name, value]) => {
    if (!Array.isArray(value)) return [name, value];
    const relative = subtract(
      { x: Number(value[0]), y: Number(value[1]), z: Number(value[2] || 0) },
      hipCenter
    );
    return [name, [
      dot(relative, rightAxis) / torsoLength,
      dot(relative, upAxis) / torsoLength,
      dot(relative, forwardAxis) / torsoLength
    ]];
  }));
}

export function normalizeLivePoseForReference(pose, referenceLandmarks = {}) {
  const candidates = normalizedCandidates(pose);
  if (!candidates) return null;
  const comparableReference = bodyOrientReference(referenceLandmarks);
  const selected = candidates.sort(
    (first, second) =>
      alignmentError(first, comparableReference) - alignmentError(second, comparableReference)
  )[0];
  selected.__normalization.referenceLandmarks = comparableReference;
  return selected;
}

function positionDirection(bodyPart, axis, delta) {
  if (axis === "y") return delta > 0 ? "raise" : "lower";
  if (axis === "z") return delta > 0 ? "forward" : "backward";
  const isLeft = bodyPart.endsWith("_left");
  const towardOutside = isLeft ? delta < 0 : delta > 0;
  return towardOutside ? "outward" : "inward";
}

export function evaluatePositionFeedback({
  livePose,
  referencePose,
  positionTargets,
  toleranceScale = 1
}) {
  const reference = referencePose?.landmarks;
  if (!reference || referencePose.coordinate_space !== "body_normalized_v1") return [];
  const normalized = normalizeLivePoseForReference(livePose, reference);
  if (!normalized) return [];
  const comparableReference = normalized.__normalization?.referenceLandmarks || reference;

  const configured = Array.isArray(positionTargets) && positionTargets.length
    ? positionTargets
    : Object.keys(reference).map((body_part) => ({ body_part }));

  return configured.flatMap((target) => {
    const bodyPart = target.body_part;
    const live = normalized[bodyPart];
    const expected = comparableReference[bodyPart];
    if (!live || !Array.isArray(expected)) return [];
    const configuredTolerance = target.tolerance ?? referencePose.tolerance ?? 0.12;
    const toleranceFor = (axis) => {
      const axisValue = typeof configuredTolerance === "object"
        ? configuredTolerance?.[axis]
        : configuredTolerance;
      const base = Math.max(0.01, Number(axisValue) || 0.12);
      return base * toleranceScale * (axis === "z" ? DEFAULT_DEPTH_TOLERANCE_SCALE : 1);
    };
    const axes = Array.isArray(target.axes)
      ? target.axes.filter((axis) => ["x", "y", "z"].includes(axis))
      : ["x", "y", "z"];
    const differences = axes.map((axis) => ({
      axis,
      delta: Number(expected[{ x: 0, y: 1, z: 2 }[axis]]) - live[axis],
      tolerance: toleranceFor(axis)
    })).filter((item) =>
      Number.isFinite(item.delta) &&
      (item.axis !== "z" || live.visibility >= MIN_DEPTH_VISIBILITY)
    );
    const dominant = differences
      .filter((item) => Math.abs(item.delta) > item.tolerance)
      .sort((a, b) =>
        (Math.abs(b.delta) / b.tolerance) - (Math.abs(a.delta) / a.tolerance)
      )[0];
    if (!dominant) return [];
    const severity = Math.abs(dominant.delta) / dominant.tolerance;
    const torsoLengthMeters = normalized.__normalization?.torsoLengthMeters;
    const deviationCm = Number.isFinite(torsoLengthMeters)
      ? dominant.delta * torsoLengthMeters * WORLD_METERS_TO_CENTIMETERS
      : null;
    const toleranceCm = Number.isFinite(torsoLengthMeters)
      ? dominant.tolerance * torsoLengthMeters * WORLD_METERS_TO_CENTIMETERS
      : null;
    return [{
      bodyPart,
      label: target.label || bodyPart.replace(/_/g, " "),
      kind: "position",
      group: "position",
      direction: positionDirection(bodyPart, dominant.axis, dominant.delta),
      axis: dominant.axis,
      deviation: dominant.delta,
      deviationCm: Number.isFinite(deviationCm) ? Math.round(deviationCm) : null,
      toleranceCm: Number.isFinite(toleranceCm) ? Math.round(toleranceCm) : null,
      unit: "cm",
      coordinateFrame: normalized.__normalization?.coordinateFrame,
      score: Math.max(0, Math.round(80 - (severity - 1) * 40)),
      weight: Number(target.weight) || 0.5,
      visibility: live.visibility
    }];
  }).sort((first, second) => first.score - second.score);
}
