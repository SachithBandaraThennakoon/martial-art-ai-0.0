export function getPracticeCueDeadlineMs({
  scheduleStartedAtMs,
  cueNumber,
  countGapMs
}) {
  const anchor = Number(scheduleStartedAtMs);
  const cue = Math.max(1, Number(cueNumber) || 1);
  const gap = Math.max(0, Number(countGapMs) || 0);
  return anchor + (cue - 1) * gap;
}

export function getPracticeCueDelayMs({
  nowMs,
  scheduleStartedAtMs,
  cueNumber,
  countGapMs
}) {
  return Math.max(
    0,
    getPracticeCueDeadlineMs({
      scheduleStartedAtMs,
      cueNumber,
      countGapMs
    }) - Number(nowMs)
  );
}

const percentile = (sortedValues, ratio) => {
  if (!sortedValues.length) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * ratio) - 1)
  );
  return sortedValues[index];
};

export function summarizePracticeSourceTiming(frames = []) {
  const timestamps = [];
  let lastTimestamp = null;

  frames.forEach((frame) => {
    const timestamp = Number(frame?.sourceTimestampMs);
    if (!Number.isFinite(timestamp) || timestamp === lastTimestamp) return;
    timestamps.push(timestamp);
    lastTimestamp = timestamp;
  });

  const gaps = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  const durationMs = timestamps.length > 1
    ? timestamps[timestamps.length - 1] - timestamps[0]
    : 0;

  return {
    recordedFrames: frames.length,
    uniqueSourceFrames: timestamps.length,
    duplicateFrameRatio: frames.length
      ? Number((1 - timestamps.length / frames.length).toFixed(4))
      : 0,
    effectiveFps: durationMs > 0
      ? Number((((timestamps.length - 1) * 1000) / durationMs).toFixed(2))
      : 0,
    medianSourceGapMs: percentile(gaps, 0.5),
    p90SourceGapMs: percentile(gaps, 0.9),
    maxSourceGapMs: gaps.length ? gaps[gaps.length - 1] : null
  };
}
