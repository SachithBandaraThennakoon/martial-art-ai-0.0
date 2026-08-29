import assert from "node:assert/strict";
import test from "node:test";

import { StableSituationResolver } from "../src/situationAwareness/StableSituationResolver.js";

const target = (body_part = "elbow_left", issue = "too_closed") => ({
  layer: "level2",
  body_part,
  issue,
  priority: 0.72
});

function resolve(resolver, timestampMs, rawState, options = {}) {
  return resolver.resolve({
    rawState,
    attentionTarget: options.target || target(),
    timestampMs,
    contextKey: options.contextKey || "jab:extend",
    evidence: {
      mistakeRisk: options.mistakeRisk ?? (rawState === "correcting" ? 0.72 : 0.2),
      forecastRisk: options.forecastRisk ?? (rawState === "anticipating" ? 0.75 : 0),
      fatigueRisk: options.fatigueRisk ?? (rawState === "warning" ? 0.7 : 0.1),
      masteryScore: options.masteryScore ?? (["advance_ready", "encouraging"].includes(rawState) ? 0.82 : 0.4)
    }
  });
}

test("isolated correcting frames do not replace the stable observing state", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting");
  resolve(resolver, 450, "observing");
  const state = resolve(resolver, 900, "correcting");

  assert.equal(state.raw_state, "correcting");
  assert.equal(state.stable_state, "observing");
  assert.equal(state.candidate_state, null);
});

test("a same-target correction cluster wins despite interleaved observing labels", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting");
  resolve(resolver, 300, "observing");
  resolve(resolver, 600, "correcting");
  resolve(resolver, 750, "observing");
  const state = resolve(resolver, 1200, "correcting");

  assert.equal(state.stable_state, "correcting");
  assert.equal(state.stable_target.body_part, "elbow_left");
  assert.equal(state.cluster.support, 3);
  assert.equal(state.cluster.sample_count, 5);
  assert.equal(state.cluster.support_ratio, 0.6);
});

test("different correction targets do not form one correction cluster", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting", { target: target("elbow_left") });
  resolve(resolver, 450, "correcting", { target: target("shoulder_left", "too_open") });
  const state = resolve(resolver, 900, "correcting", { target: target("wrist_left", "too_low") });

  assert.equal(state.stable_state, "observing");
  assert.equal(state.candidate_state, null);
});

test("confirmed correction uses hysteresis before returning to observing", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting");
  resolve(resolver, 450, "correcting");
  const entered = resolve(resolver, 900, "correcting");
  const oneClear = resolve(resolver, 1800, "observing");
  const twoClear = resolve(resolver, 2250, "observing");
  const resolved = resolve(resolver, 2700, "observing");

  assert.equal(entered.stable_state, "correcting");
  assert.equal(oneClear.stable_state, "correcting");
  assert.equal(twoClear.stable_state, "correcting");
  assert.equal(resolved.stable_state, "observing");
});

test("tracking and engagement states override clusters immediately", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting");
  resolve(resolver, 450, "correcting");
  resolve(resolver, 900, "correcting");

  const lost = resolve(resolver, 1000, "tracking_unclear", {
    target: target("camera", "tracking_low")
  });
  const returning = resolve(resolver, 1200, "returning", {
    target: target("whole_form", "continue")
  });

  assert.equal(lost.stable_state, "tracking_unclear");
  assert.equal(lost.immediate, true);
  assert.equal(returning.stable_state, "returning");
});

test("prediction, warning, progression, and encouragement use label-specific confirmation", () => {
  const cases = [
    { state: "anticipating", count: 3, spacing: 450 },
    { state: "warning", count: 3, spacing: 450 },
    { state: "advance_ready", count: 4, spacing: 450 },
    { state: "encouraging", count: 3, spacing: 450 }
  ];

  cases.forEach(({ state, count, spacing }) => {
    const resolver = new StableSituationResolver();
    let result;
    for (let index = 0; index < count; index += 1) {
      result = resolve(resolver, index * spacing, state);
    }
    assert.equal(result.stable_state, state);
  });
});

test("changing the training step clears an old correction cluster", () => {
  const resolver = new StableSituationResolver();
  resolve(resolver, 0, "correcting");
  resolve(resolver, 450, "correcting");
  assert.equal(resolve(resolver, 900, "correcting").stable_state, "correcting");

  const changedStep = resolve(resolver, 1350, "correcting", { contextKey: "jab:return" });
  assert.equal(changedStep.stable_state, "observing");
  assert.equal(changedStep.candidate_state, null);
});
