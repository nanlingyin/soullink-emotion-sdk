import { describe, expect, it } from "vitest";
import { buildPrivateEmotionMapPatch, clonePrivateEmotionMap } from "../privateEmotionMap";

describe("privateEmotionMap calibration patch", () => {
  it("emits only changed and added mappings as manual rules", () => {
    const patch = buildPrivateEmotionMapPatch({
      confusion: {
        targets: ["Param6"], category: "privateEffect", emotions: ["confused"], source: "llm", confidence: 0.7
      },
      blush: { targets: ["Param10"], category: "blush" }
    }, {
      confusion: {
        targets: ["Param6", "Param7"], category: "privateEffect", emotions: ["confused"],
        vadRange: { arousal: [0.2, 1] }, source: "llm", confidence: 0.7
      },
      blush: { targets: ["Param10"], category: "blush" },
      anger: { target: "Param8", category: "anger", emotions: ["angry"] }
    });

    expect(patch.confusion).toMatchObject({
      targets: ["Param6", "Param7"], vadRange: { arousal: [0.2, 1] }, source: "manual", confidence: 0.7
    });
    expect(patch.anger).toMatchObject({ target: "Param8", source: "manual", confidence: 1 });
    expect(patch).not.toHaveProperty("blush");
  });

  it("emits null tombstones for deleted or renamed mappings", () => {
    expect(buildPrivateEmotionMapPatch({
      oldName: { target: "Param6", category: "privateEffect" }
    }, {
      newName: { target: "Param6", category: "privateEffect" }
    })).toEqual({
      oldName: null,
      newName: { target: "Param6", category: "privateEffect", source: "manual", confidence: 1 }
    });
  });

  it("clones nested arrays without mutating the source profile", () => {
    const source = { confusion: { targets: ["Param6"], vadRange: { valence: [-1, 0] as [number, number] } } };
    const clone = clonePrivateEmotionMap(source);
    clone.confusion.targets?.push("Param7");
    expect(source.confusion.targets).toEqual(["Param6"]);
  });
});
