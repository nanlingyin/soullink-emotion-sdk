import { describe, expect, it } from "vitest";
import { transformRuleValue } from "../ParameterTransform";

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 10);
};

describe("transformRuleValue", () => {
  it("preserves legacy set/add math", () => {
    expect(transformRuleValue(0.5, { mode: "set", scale: 2, offset: 1 })).toBe(2);
    expect(transformRuleValue(0.5, { mode: "add", scale: 2, offset: 1 })).toBe(2);
  });

  it("preserves legacy subtract math", () => {
    expect(transformRuleValue(0.5, { mode: "subtract", scale: 2, offset: 1 })).toBe(0);
  });

  it("preserves legacy inverse math", () => {
    expect(transformRuleValue(0.5, { mode: "inverse", scale: 2, offset: 1 })).toBe(1);
  });

  it("supports inverse around an explicit center", () => {
    expect(transformRuleValue(0.5, {
      mode: "inverse",
      scale: 2,
      offset: 1,
      invertAround: 0,
    })).toBe(0);
  });

  it("maps deadzone values to 0", () => {
    expect(transformRuleValue(0.1, { deadzone: 0.2 })).toBe(0);
  });

  it("remaps inputRange to outputRange", () => {
    closeTo(transformRuleValue(5, {
      inputRange: [0, 10],
      outputRange: [-1, 1],
    }), 0);

    closeTo(transformRuleValue(10, {
      inputRange: [0, 10],
      outputRange: [-1, 1],
    }), 1);
  });
});
