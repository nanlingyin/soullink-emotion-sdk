export const modelCatalog = [
  {
    id: "blondegirl",
    modelDir: "Blondegirl-test",
    modelFile: "Blondegirl.model3.json",
    displayName: "Blondegirl",
    profileOverrides: {
      expressionMap: {
        angry: "exp_03",
        shy: "exp_02",
        confused: "exp_01",
        excited: "exp_04",
        sad: "exp_05"
      }
    },
    view: { scale: 1, x: 0, y: 0 }
  },
  {
    id: "bee",
    modelDir: "bee-special",
    modelFile: "LilyaBee.model3.json",
    displayName: "Lilya Bee",
    profileOverrides: {
      parameterMap: {
        mouthPucker: { target: "Param2", mode: "set", scale: 1, min: 0, max: 1 },
        blush: { targets: ["Param84", "ParamCheek"], mode: "set", scale: 1, min: 0, max: 1 },
        tear: { target: "Param100", mode: "set", scale: 1, min: 0, max: 1 },
        sweat: { target: "Param79", mode: "set", scale: 1, min: 0, max: 1 }
      },
      privateEmotionMap: {
        shadowEffect: null,
        positiveEye: {
          target: "Param103",
          category: "positiveEye",
          emotions: ["affectionate", "happy"],
          priority: 95,
          exclusiveGroup: "face-effect",
          source: "manual",
          confidence: 1
        },
        confusionEffect: {
          target: "Param82",
          category: "privateEffect",
          emotions: ["confused"],
          priority: 95,
          exclusiveGroup: "face-effect",
          source: "manual",
          confidence: 1
        },
        angerEffect: {
          targets: ["Param80", "Param85"],
          category: "anger",
          emotions: ["anger", "angry"],
          priority: 90,
          exclusiveGroup: "face-effect",
          source: "manual",
          confidence: 1
        },
        starEffect: {
          targets: ["Param83", "Param101"],
          category: "privateEffect",
          emotions: ["excited", "happy", "surprised"],
          priority: 80,
          exclusiveGroup: "face-effect",
          source: "manual",
          confidence: 1
        }
      },
      expressionMap: {
        angry: "angry",
        shy: "blush",
        confused: "confused",
        affectionate: "loveEyes",
        excited: "starsEyes",
        sad: "tears"
      }
    },
    view: { scale: 1, x: 0, y: 0 }
  },
  {
    id: "hiyori",
    modelDir: "hiyori",
    modelFile: "hiyori_pro_t11.model3.json",
    displayName: "Hiyori",
    view: { scale: 1, x: 0, y: 0 }
  },
  {
    id: "shizuku",
    modelDir: "shizuku",
    modelFile: "shizuku.model3.json",
    displayName: "Shizuku",
    unsupportedFallbackParameters: ["eyeSmile", "tear"],
    profileOverrides: {
      parameterMap: {
        eyeOpen: { targets: ["PARAM_EYE_L_OPEN", "PARAM_EYE_R_OPEN"], mode: "set", scale: 1, min: 0, max: 1.2 },
        eyeBlinkL: { target: "PARAM_EYE_L_OPEN", mode: "subtract", scale: 1, min: 0, max: 1.2 },
        eyeBlinkR: { target: "PARAM_EYE_R_OPEN", mode: "subtract", scale: 1, min: 0, max: 1.2 },
        eyeSquint: { targets: ["PARAM_EYE_L_OPEN", "PARAM_EYE_R_OPEN"], mode: "subtract", scale: 0.22, min: 0, max: 1.2 },
        gazeX: { target: "PARAM_EYE_BALL_X", mode: "set", scale: 1, min: -1, max: 1 },
        gazeY: { target: "PARAM_EYE_BALL_Y", mode: "set", scale: 1, min: -1, max: 1 },
        headX: { target: "PARAM_ANGLE_X", mode: "set", scale: 30, min: -30, max: 30 },
        headY: { target: "PARAM_ANGLE_Y", mode: "set", scale: 30, min: -30, max: 30 },
        headZ: { target: "PARAM_ANGLE_Z", mode: "set", scale: 30, min: -30, max: 30 },
        bodyX: { target: "PARAM_BODY_X", mode: "set", scale: 12, min: -12, max: 12 },
        bodyY: { target: "PARAM_BODY_Y", mode: "set", scale: 12, min: -12, max: 12 },
        bodyZ: { target: "PARAM_BODY_Z", mode: "set", scale: 12, min: -12, max: 12 },
        mouthSmile: { target: "PARAM_MOUTH_FORM", mode: "set", scale: 1, min: -1, max: 1 },
        mouthFrown: { target: "PARAM_MOUTH_FORM", mode: "subtract", scale: 1, min: -1, max: 1 },
        mouthOpen: { target: "PARAM_MOUTH_OPEN_Y", mode: "set", scale: 1, min: 0, max: 1 },
        browInnerUp: { targets: ["PARAM_BROW_L_Y", "PARAM_BROW_R_Y"], mode: "set", scale: 1, min: -1, max: 1 },
        browOuterUp: { targets: ["PARAM_BROW_L_ANGLE", "PARAM_BROW_R_ANGLE"], mode: "set", scale: 0.9, min: -1, max: 1 },
        browDown: { targets: ["PARAM_BROW_L_FORM", "PARAM_BROW_R_FORM"], mode: "set", scale: -0.85, min: -1, max: 1 },
        blush: { target: "PARAM_TERE", mode: "set", scale: 1, min: 0, max: 1 },
        breath: { target: "PARAM_BREATH", mode: "set", scale: 1, min: 0, max: 1 }
      }
    },
    view: { scale: 1, x: 0, y: 0 }
  }
];

export function findModel(modelId) {
  return modelCatalog.find((model) => model.id === modelId) ?? modelCatalog[0];
}

export function modelAssetUrl(model, fileName) {
  return `/l2d/${model.modelDir}/${fileName}`;
}
