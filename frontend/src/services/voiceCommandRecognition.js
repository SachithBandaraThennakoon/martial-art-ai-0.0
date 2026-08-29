const COMMAND_ALIASES = {
  ready: ["ready", "yes", "yeah", "okay", "ok", "start", "begin", "go", "lets go", "get start", "get started", "continue"],
  "next step": [
    "next",
    "next step",
    "neck step",
    "existed",
    "and existed",
    "this step",
    "this is tip",
    "move on",
    "go next",
    "continue",
    "yes",
    "okay"
  ],
  "no, repeat step": ["no", "repeat", "repeat step", "same step", "again", "one more time"],
  wait: ["wait", "pause", "hold", "hold on", "not ready", "one moment"],
  "practice mode": ["practice", "practice mode", "drill it"],
  "no, continue training": ["continue", "keep training", "training", "no"],
  "train again": ["train again", "again", "restart", "start again"],
  "finish session": ["finish", "finish session", "end", "end session", "done", "im done"]
};

export function normalizeVoicePhrase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
  }
  return rows[left.length][right.length];
}

function phraseScore(transcript, phrase) {
  if (!transcript || !phrase) return 0;
  if (transcript === phrase) return 1;
  if (transcript.includes(phrase) || phrase.includes(transcript)) return 0.9;
  const longest = Math.max(transcript.length, phrase.length);
  return longest ? 1 - editDistance(transcript, phrase) / longest : 0;
}

export function selectExpectedVoiceCommand(alternatives, options = []) {
  const expected = options.length
    ? options
    : Object.keys(COMMAND_ALIASES).map((value) => ({ label: value, value }));
  let best = null;

  for (const alternative of alternatives || []) {
    const transcript = normalizeVoicePhrase(alternative?.transcript);
    const confidence = Number.isFinite(alternative?.confidence) ? alternative.confidence : 0.5;
    if (!transcript) continue;

    for (const option of expected) {
      const command = option.value || option.label;
      const aliases = [option.label, command, ...(COMMAND_ALIASES[command] || [])]
        .map(normalizeVoicePhrase)
        .filter(Boolean);
      const languageScore = Math.max(...aliases.map((phrase) => phraseScore(transcript, phrase)));
      const score = languageScore * 0.88 + confidence * 0.12;
      if (!best || score > best.score) {
        best = { command, transcript, score };
      }
    }
  }

  return best?.score >= 0.72 ? best : null;
}
