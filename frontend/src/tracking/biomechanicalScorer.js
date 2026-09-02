function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function targetRangeFalloff(value, { target, preferred_range: range }) {
  if (!Number.isFinite(value)) return null;
  const [minimum, maximum] = range || [target, target];
  if (value >= minimum && value <= maximum) return 1;
  const width = Math.max(1, maximum - minimum);
  const distance = value < minimum ? minimum - value : value - maximum;
  return clamp(1 - distance / width);
}

export function scoreRepetition(repetition, config = {}) {
  const qualityMetrics = config.metrics || [];
  const scored = qualityMetrics.map((metric) => {
    const value = repetition.metrics?.[metric.feature];
    const score = targetRangeFalloff(value, metric);
    return { ...metric, value, score };
  }).filter((metric) => Number.isFinite(metric.score));
  const weightTotal = scored.reduce((sum, metric) => sum + (metric.weight || 1), 0);
  const techniqueQuality = weightTotal
    ? scored.reduce((sum, metric) => sum + metric.score * (metric.weight || 1), 0) / weightTotal
    : average(repetition.state_confidences || []);
  return {
    technique_quality: Number((techniqueQuality ?? 0).toFixed(3)),
    quality_evidence: scored
  };
}

