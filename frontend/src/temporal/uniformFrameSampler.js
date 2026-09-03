const DEFAULT_MODEL_FPS = 30;

function cloneLandmarks(landmarks = []) {
  return landmarks.map((point) => ({ ...point }));
}

function interpolateLandmarks(first = [], second = [], ratio) {
  const jointCount = Math.max(first.length, second.length);

  return Array.from({ length: jointCount }, (_, index) => {
    const start = first[index] || second[index] || {};
    const end = second[index] || start;
    const interpolate = (key, fallback = 0) => {
      const startValue = Number.isFinite(start[key]) ? start[key] : fallback;
      const endValue = Number.isFinite(end[key]) ? end[key] : startValue;
      return startValue + (endValue - startValue) * ratio;
    };

    return {
      ...start,
      x: interpolate("x"),
      y: interpolate("y"),
      z: interpolate("z"),
      visibility: interpolate(
        "visibility",
        Number.isFinite(start.presence) ? start.presence : 1
      )
    };
  });
}

/**
 * Resample timestamped pose frames onto the fixed cadence expected by ACP-STGAT.
 * Frame timestamps are seconds; missing history is padded with the earliest pose.
 */
export function sampleUniformPoseFrames(
  frames = [],
  sequenceLength,
  modelFps = DEFAULT_MODEL_FPS
) {
  const count = Math.max(1, Math.round(sequenceLength) || 1);
  const intervalSeconds = 1 / Math.max(1, modelFps);
  const ordered = frames
    .filter((frame) => Number.isFinite(frame?.timestamp) && frame?.landmarks?.length)
    .slice()
    .sort((first, second) => first.timestamp - second.timestamp);

  if (!ordered.length) return [];

  const latestTimestamp = ordered[ordered.length - 1].timestamp;
  let upperIndex = 0;

  return Array.from({ length: count }, (_, index) => {
    const targetTimestamp = latestTimestamp - (count - 1 - index) * intervalSeconds;

    while (
      upperIndex < ordered.length - 1 &&
      ordered[upperIndex].timestamp < targetTimestamp
    ) {
      upperIndex += 1;
    }

    const upper = ordered[upperIndex];
    const lower = ordered[Math.max(0, upperIndex - 1)];

    if (targetTimestamp <= ordered[0].timestamp) {
      return {
        ...ordered[0],
        timestamp: targetTimestamp,
        landmarks: cloneLandmarks(ordered[0].landmarks)
      };
    }

    if (upper.timestamp <= targetTimestamp || upper.timestamp === lower.timestamp) {
      return {
        ...upper,
        timestamp: targetTimestamp,
        landmarks: cloneLandmarks(upper.landmarks)
      };
    }

    const ratio =
      (targetTimestamp - lower.timestamp) /
      Math.max(upper.timestamp - lower.timestamp, Number.EPSILON);

    return {
      ...lower,
      timestamp: targetTimestamp,
      landmarks: interpolateLandmarks(lower.landmarks, upper.landmarks, ratio)
    };
  });
}

