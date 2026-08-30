import test from "node:test";
import assert from "node:assert/strict";

import { getApiErrorMessage } from "../src/services/apiError.js";

test("API errors preserve ordinary string details", () => {
  assert.equal(
    getApiErrorMessage("Email already registered", "Fallback"),
    "Email already registered"
  );
});

test("FastAPI validation arrays become readable text", () => {
  const detail = [{
    type: "missing",
    loc: ["body", "confirm_minimum_age"],
    msg: "Field required",
    input: null
  }];

  assert.equal(
    getApiErrorMessage(detail, "Fallback"),
    "Confirm Minimum Age: Field required"
  );
});

test("unknown API error shapes use the safe fallback", () => {
  assert.equal(getApiErrorMessage({ unexpected: true }, "Try again"), "Try again");
});
