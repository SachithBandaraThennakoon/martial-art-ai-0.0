const BAND_NAMES = ["level1", "level2", "awareness", "level3"];

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((total, value) => total + value, 0) / finite.length
    : null;
}

function increment(counts, key) {
  if (!key || ["unknown", "unavailable", "none"].includes(key)) return;
  counts[key] = (counts[key] || 0) + 1;
}

function compactBand(band) {
  if (!band) return null;
  return {
    start_frame: band.start_frame ?? null,
    end_frame: band.end_frame ?? null,
    horizon_ms: band.horizon_ms ?? null,
    available_frames: band.available_frames ?? band.frames?.length ?? 0,
    intent: band.summary?.intent || band.intent || "unavailable",
    confidence: band.summary?.confidence ?? band.confidence ?? 0,
    peak_eta_ms: band.summary?.peak_eta_ms ?? band.peak_eta_ms ?? null,
    return_likely: Boolean(band.summary?.return_likely ?? band.return_likely)
  };
}

export function compactAcpFrameEvidence({
  acpForecast,
  forecastAwareness,
  predictedTransition
} = {}) {
  if (!acpForecast && !forecastAwareness && !predictedTransition) return null;

  return {
    model_name: acpForecast?.model_name || "ACP-STGAT",
    status: acpForecast?.status || "unavailable",
    bands: Object.fromEntries(
      BAND_NAMES.map((name) => [name, compactBand(acpForecast?.bands?.[name])])
    ),
    warning: forecastAwareness
      ? {
          trusted: forecastAwareness.trusted === true,
          risk: forecastAwareness.risk ?? 0,
          body_part: forecastAwareness.likely_mistake?.body_part || null,
          issue: forecastAwareness.likely_mistake?.issue || null
        }
      : null,
    transition: predictedTransition
      ? {
          intent: predictedTransition.intent || "unavailable",
          transition: predictedTransition.transition || "unknown",
          next_phase: predictedTransition.next_phase || null,
          confidence: predictedTransition.confidence || 0,
          eta_ms: predictedTransition.eta_ms ?? null,
          advisory_only: true
        }
      : null
  };
}

export function buildAcpSessionSummary(frames = []) {
  const seenSourceTimes = new Set();
  const uniqueFrames = frames.filter((frame) => {
    const sourceTime = Number(frame?.sourceTimestampMs ?? frame?.timestamp);
    if (!Number.isFinite(sourceTime)) return true;
    if (seenSourceTimes.has(sourceTime)) return false;
    seenSourceTimes.add(sourceTime);
    return true;
  });
  const evidence = uniqueFrames
    .map((frame) => frame?.acpEvidence || compactAcpFrameEvidence(frame))
    .filter(Boolean);
  const ready = evidence.filter((item) => String(item.status).startsWith("ready"));
  const intentCounts = {};
  const transitionCounts = {};
  let trustedWarnings = 0;
  let peakWarningRisk = 0;

  ready.forEach((item) => {
    increment(intentCounts, item.bands?.level3?.intent);
    increment(transitionCounts, item.transition?.transition);
    if (item.warning?.trusted) trustedWarnings += 1;
    peakWarningRisk = Math.max(peakWarningRisk, Number(item.warning?.risk) || 0);
  });

  const bandReliability = Object.fromEntries(BAND_NAMES.map((name) => {
    const mean = average(ready.map((item) => Number(item.bands?.[name]?.confidence)));
    return [name, mean === null ? null : Number(clamp(mean).toFixed(3))];
  }));
  const topEntry = (counts) => Object.entries(counts)
    .sort((first, second) => second[1] - first[1])[0] || null;
  const topIntent = topEntry(intentCounts);
  const topTransition = topEntry(transitionCounts);

  return {
    model_name: evidence[0]?.model_name || "ACP-STGAT",
    role: "advisory_only",
    affects_rep_count: false,
    observed_samples: uniqueFrames.length,
    forecast_samples: ready.length,
    coverage_percentage: uniqueFrames.length
      ? Number((ready.length / uniqueFrames.length * 100).toFixed(1))
      : 0,
    bands: {
      level1: "frames 1-6",
      level2: "frames 1-12",
      awareness: "frames 4-12",
      level3: "frames 1-30"
    },
    band_reliability: bandReliability,
    dominant_intent: topIntent?.[0] || "unavailable",
    dominant_transition: topTransition?.[0] || "unavailable",
    transition_candidates: Object.values(transitionCounts)
      .reduce((total, count) => total + count, 0),
    trusted_warning_samples: trustedWarnings,
    peak_warning_risk: Number(clamp(peakWarningRisk).toFixed(3))
  };
}
