import type { EmotionArchetype } from "./EmotionArchetype";

export const emotionArchetypes: Record<string, EmotionArchetype> = {
  neutral: {
    emotion: "neutral",
    baseTendency: {
      mouthSmile: [0.02, 0.12],
      eyeOpen: [0.9, 1],
      eyeSmile: [0, 0.12],
      browInnerUp: [0, 0.06],
      gazeX: [-0.06, 0.06],
      gazeY: [-0.03, 0.04],
      headZ: [-0.03, 0.03]
    },
    variants: {
      neutral_ack: {
        ranges: {
          mouthSmile: [0.04, 0.16],
          eyeSmile: [0, 0.1],
          headY: [-0.03, 0.03]
        }
      },
      attentive: {
        ranges: {
          eyeOpen: [0.96, 1.06],
          browInnerUp: [0.04, 0.12],
          gazeX: [-0.02, 0.02],
          gazeY: [-0.02, 0.02]
        }
      }
    }
  },
  happy: {
    emotion: "happy",
    baseTendency: {
      mouthSmile: [0.35, 0.85],
      eyeSmile: [0.15, 0.55],
      eyeOpen: [0.88, 1.08],
      browInnerUp: [0, 0.18],
      headZ: [-0.08, 0.08],
      gazeX: [-0.12, 0.12],
      gazeY: [-0.04, 0.08]
    },
    variants: {
      soft_smile: {
        ranges: {
          mouthSmile: [0.3, 0.55],
          eyeSmile: [0.1, 0.3],
          headZ: [-0.04, 0.04]
        }
      },
      bright_smile: {
        ranges: {
          mouthSmile: [0.6, 0.9],
          eyeSmile: [0.35, 0.65],
          browInnerUp: [0.05, 0.18],
          headY: [-0.03, 0.06]
        }
      },
      surprised_happy: {
        ranges: {
          eyeOpen: [1.05, 1.2],
          browOuterUp: [0.2, 0.45],
          mouthOpen: [0.12, 0.35],
          mouthSmile: [0.55, 0.85],
          headX: [-0.04, 0.04]
        }
      },
      shy_happy: {
        ranges: {
          mouthSmile: [0.35, 0.65],
          eyeSmile: [0.2, 0.45],
          gazeX: [-0.35, -0.12],
          gazeY: [-0.18, 0.02],
          blush: [0.35, 0.85],
          headZ: [-0.12, -0.03]
        },
        tags: ["shy"]
      }
    }
  },
  calm: {
    emotion: "calm",
    baseTendency: {
      mouthSmile: [0.08, 0.24],
      eyeOpen: [0.82, 0.98],
      eyeSmile: [0.08, 0.28],
      browInnerUp: [0, 0.08],
      gazeX: [-0.04, 0.04],
      gazeY: [-0.04, 0.02],
      headZ: [-0.04, 0.04],
      bodyY: [-0.03, 0.03]
    },
    variants: {
      soft_calm: {
        ranges: {
          mouthSmile: [0.1, 0.22],
          eyeSmile: [0.08, 0.22],
          eyeOpen: [0.82, 0.94]
        }
      },
      quiet_listen: {
        ranges: {
          eyeOpen: [0.86, 1],
          browInnerUp: [0.03, 0.1],
          headY: [-0.02, 0.05]
        }
      }
    }
  },
  excited: {
    emotion: "excited",
    baseTendency: {
      mouthSmile: [0.58, 0.95],
      mouthOpen: [0.14, 0.42],
      eyeOpen: [1.04, 1.24],
      eyeSmile: [0.22, 0.56],
      browOuterUp: [0.18, 0.48],
      headX: [-0.08, 0.08],
      headY: [-0.05, 0.08],
      bodyY: [-0.06, 0.08]
    },
    variants: {
      sparkle: {
        ranges: {
          mouthSmile: [0.68, 0.95],
          eyeOpen: [1.08, 1.24],
          browOuterUp: [0.24, 0.56]
        }
      },
      bounce: {
        ranges: {
          mouthOpen: [0.22, 0.48],
          headY: [-0.08, 0.1],
          bodyY: [-0.08, 0.1]
        }
      }
    }
  },
  shy: {
    emotion: "shy",
    baseTendency: {
      mouthSmile: [0.2, 0.55],
      eyeOpen: [0.82, 1],
      eyeSmile: [0.16, 0.42],
      browInnerUp: [0.04, 0.18],
      gazeX: [-0.38, -0.1],
      gazeY: [-0.2, 0.02],
      headZ: [-0.14, -0.03],
      blush: [0.35, 0.9]
    },
    variants: {
      bashful: {
        ranges: {
          mouthSmile: [0.28, 0.58],
          eyeSmile: [0.22, 0.46],
          blush: [0.52, 0.95]
        }
      },
      embarrassed: {
        ranges: {
          mouthSmile: [0.08, 0.32],
          mouthOpen: [0.02, 0.16],
          browInnerUp: [0.12, 0.32],
          sweat: [0.04, 0.22]
        }
      }
    }
  },
  affectionate: {
    emotion: "affectionate",
    baseTendency: {
      mouthSmile: [0.22, 0.62],
      eyeSmile: [0.18, 0.5],
      eyeOpen: [0.82, 1.02],
      browInnerUp: [0.06, 0.22],
      gazeX: [-0.05, 0.05],
      gazeY: [-0.02, 0.06],
      headZ: [-0.08, 0.08],
      blush: [0.08, 0.42]
    },
    variants: {
      warm: {
        ranges: {
          mouthSmile: [0.28, 0.6],
          eyeSmile: [0.22, 0.48],
          browInnerUp: [0.08, 0.24]
        }
      },
      close: {
        ranges: {
          mouthSmile: [0.18, 0.46],
          gazeY: [0.02, 0.08],
          blush: [0.2, 0.5]
        }
      }
    }
  },
  curious: {
    emotion: "curious",
    baseTendency: {
      browOuterUp: [0.1, 0.34],
      browInnerUp: [0.02, 0.18],
      eyeOpen: [0.98, 1.16],
      mouthOpen: [0.02, 0.18],
      mouthSmile: [0.08, 0.28],
      gazeX: [-0.16, 0.16],
      headZ: [-0.16, 0.16],
      headY: [-0.04, 0.06]
    },
    variants: {
      tilt: {
        ranges: {
          browOuterUp: [0.16, 0.38],
          headZ: [-0.18, 0.18],
          mouthOpen: [0.04, 0.18]
        }
      },
      attentive_question: {
        ranges: {
          eyeOpen: [1, 1.18],
          browInnerUp: [0.08, 0.22],
          gazeX: [-0.04, 0.04]
        }
      }
    }
  },
  concerned: {
    emotion: "concerned",
    baseTendency: {
      browInnerUp: [0.22, 0.55],
      eyeOpen: [0.78, 0.98],
      mouthSmile: [0.04, 0.22],
      mouthFrown: [0.05, 0.25],
      headZ: [-0.08, 0.08],
      gazeX: [-0.05, 0.05],
      gazeY: [-0.05, 0.05]
    },
    variants: {
      soft_concern: {
        ranges: {
          browInnerUp: [0.2, 0.4],
          mouthSmile: [0.08, 0.22],
          eyeOpen: [0.82, 0.95]
        }
      },
      worried: {
        ranges: {
          browInnerUp: [0.4, 0.65],
          mouthFrown: [0.18, 0.35],
          eyeOpen: [0.88, 1.05],
          sweat: [0.05, 0.25]
        }
      },
      comfort: {
        ranges: {
          browInnerUp: [0.25, 0.45],
          mouthSmile: [0.12, 0.32],
          eyeSmile: [0.05, 0.2],
          headZ: [-0.06, 0.06]
        },
        tags: ["warm"]
      }
    }
  },
  tired: {
    emotion: "tired",
    baseTendency: {
      eyeOpen: [0.58, 0.84],
      eyeSquint: [0.08, 0.28],
      browInnerUp: [0.06, 0.22],
      mouthFrown: [0.04, 0.2],
      mouthSmile: [0, 0.1],
      gazeY: [-0.2, -0.04],
      headY: [-0.1, -0.02],
      bodyY: [-0.08, -0.02]
    },
    variants: {
      sleepy: {
        ranges: {
          eyeOpen: [0.52, 0.76],
          mouthOpen: [0.02, 0.14],
          headY: [-0.12, -0.04]
        }
      },
      drained: {
        ranges: {
          eyeOpen: [0.62, 0.84],
          browInnerUp: [0.12, 0.3],
          mouthFrown: [0.1, 0.24]
        }
      }
    }
  },
  sad: {
    emotion: "sad",
    baseTendency: {
      browInnerUp: [0.28, 0.6],
      eyeOpen: [0.64, 0.92],
      eyeSquint: [0.04, 0.2],
      mouthFrown: [0.18, 0.5],
      mouthSmile: [0, 0.08],
      gazeY: [-0.24, -0.06],
      headY: [-0.12, -0.02],
      tear: [0, 0.32]
    },
    variants: {
      downcast: {
        ranges: {
          browInnerUp: [0.3, 0.56],
          mouthFrown: [0.22, 0.48],
          gazeY: [-0.26, -0.08]
        }
      },
      teary: {
        ranges: {
          browInnerUp: [0.38, 0.68],
          eyeOpen: [0.68, 0.95],
          tear: [0.22, 0.58]
        }
      }
    }
  },
  anxiety: {
    emotion: "anxiety",
    baseTendency: {
      browInnerUp: [0.24, 0.58],
      browOuterUp: [0.08, 0.32],
      eyeOpen: [1.02, 1.22],
      mouthFrown: [0.12, 0.36],
      mouthOpen: [0.02, 0.18],
      gazeX: [-0.22, 0.22],
      headZ: [-0.12, 0.12],
      sweat: [0.12, 0.46]
    },
    variants: {
      nervous: {
        ranges: {
          eyeOpen: [1.04, 1.22],
          browInnerUp: [0.32, 0.62],
          sweat: [0.18, 0.52]
        }
      },
      uneasy: {
        ranges: {
          gazeX: [-0.28, 0.28],
          mouthFrown: [0.16, 0.38],
          headZ: [-0.16, 0.16]
        }
      }
    }
  },
  confused: {
    emotion: "confused",
    baseTendency: {
      browInnerUp: [0.08, 0.28],
      browDown: [0.08, 0.25],
      eyeOpen: [0.92, 1.1],
      mouthOpen: [0.02, 0.16],
      mouthFrown: [0.04, 0.18],
      gazeX: [-0.18, 0.18],
      headZ: [-0.14, 0.14]
    },
    variants: {
      confused: {
        ranges: {
          browInnerUp: [0.12, 0.3],
          browDown: [0.08, 0.24],
          mouthOpen: [0.04, 0.18],
          headZ: [-0.16, 0.16]
        }
      }
    }
  },
  surprised: {
    emotion: "surprised",
    baseTendency: {
      eyeOpen: [1.08, 1.22],
      browOuterUp: [0.28, 0.55],
      mouthOpen: [0.18, 0.42],
      mouthSmile: [0, 0.18],
      gazeX: [-0.03, 0.03],
      gazeY: [-0.02, 0.04],
      headX: [-0.05, 0.05]
    },
    variants: {
      startled: {
        ranges: {
          eyeOpen: [1.12, 1.24],
          browOuterUp: [0.34, 0.6],
          mouthOpen: [0.2, 0.45],
          headY: [-0.05, 0.02]
        }
      }
    }
  },
  anger: {
    emotion: "anger",
    baseTendency: {
      browDown: [0.28, 0.6],
      eyeOpen: [0.76, 0.98],
      eyeSquint: [0.12, 0.38],
      mouthFrown: [0.18, 0.46],
      mouthOpen: [0, 0.16],
      gazeX: [-0.04, 0.04],
      headZ: [-0.08, 0.08],
      sweat: [0, 0.18]
    },
    variants: {
      annoyed: {
        ranges: {
          browDown: [0.22, 0.44],
          eyeSquint: [0.08, 0.26],
          mouthFrown: [0.12, 0.34]
        }
      },
      firm: {
        ranges: {
          browDown: [0.36, 0.62],
          eyeSquint: [0.18, 0.42],
          mouthFrown: [0.24, 0.48],
          headY: [0.02, 0.08]
        }
      }
    }
  },
  angry: {
    emotion: "angry",
    baseTendency: {
      browDown: [0.28, 0.58],
      eyeOpen: [0.78, 0.96],
      eyeSquint: [0.1, 0.35],
      mouthFrown: [0.18, 0.42],
      mouthOpen: [0, 0.12],
      gazeX: [-0.04, 0.04],
      headZ: [-0.08, 0.08],
      sweat: [0, 0.16]
    },
    variants: {
      annoyed: {
        ranges: {
          browDown: [0.22, 0.42],
          eyeSquint: [0.08, 0.24],
          mouthFrown: [0.12, 0.32]
        }
      }
    }
  }
};

export function getEmotionArchetype(emotion: string): EmotionArchetype {
  return emotionArchetypes[emotion] ?? emotionArchetypes.neutral;
}
