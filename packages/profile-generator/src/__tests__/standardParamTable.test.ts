import { describe, expect, it } from "vitest";
import { resolveStandard, STANDARD_PARAM_TABLE } from "../standardParamTable";

describe("resolveStandard", () => {
  it("prefers a declared Cubism group and filters unknown ids", () => {
    const result = resolveStandard(
      "eyeOpen",
      [{ id: "ParamEyeLOpen" }, { id: "ParamEyeROpen" }, { id: "CustomBlink" }],
      [{ Target: "Parameter", Name: "EyeBlink", Ids: ["ParamEyeLOpen", "CustomBlink", "Ghost"] }]
    );
    expect(result).toEqual({ ids: ["ParamEyeLOpen", "CustomBlink"], source: "standard-group" });
  });

  it("keeps name-only and derived keys out of the standard table", () => {
    expect(STANDARD_PARAM_TABLE.tear).toBeUndefined();
    expect(resolveStandard("tear", [{ id: "ParamTear" }], [])).toBeUndefined();
  });

});
