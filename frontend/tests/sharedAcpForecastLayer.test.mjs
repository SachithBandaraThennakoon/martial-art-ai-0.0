import assert from "node:assert/strict";
import test from "node:test";

import { SharedAcpForecastLayer } from "../src/temporal/sharedAcpForecastLayer.js";

test("shared ACP forecast exposes only six initial frames and displays frame three", () => {
  const layer = new SharedAcpForecastLayer();
  layer.predictor = {
    status: "ready",
    latestPrediction: {
      model_name: "ACP-STGAT",
      status: "ready_stabilized",
      future_landmark_frames: Array.from({ length: 30 }, (_, index) => ({
        horizon_frame: index + 1,
        horizon_ms: (index + 1) * (1000 / 30),
        landmarks: [{ x: index + 1, y: 0 }]
      }))
    }
  };

  const state = layer.getState();

  assert.equal(state.initial_frames.length, 6);
  assert.equal(state.all_frames.length, 30);
  assert.equal(state.display_frame.horizon_frame, 3);
  assert.equal(state.display_frame.landmarks[0].x, 3);
  assert.equal(Math.round(state.short_horizon_ms), 200);
  assert.equal(state.bands.level1.frames.length, 6);
  assert.equal(state.bands.level2.frames.length, 12);
  assert.equal(state.bands.awareness.frames.length, 9);
  assert.equal(state.bands.level3.frames.length, 30);
});

test("shared ACP forecast reports disabled without loading the model", () => {
  const layer = new SharedAcpForecastLayer();

  assert.equal(layer.getState().status, "disabled");
  assert.equal(layer.getState().initial_frames.length, 0);
});
