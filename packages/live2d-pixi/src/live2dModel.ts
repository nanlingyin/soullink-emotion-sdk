import type * as PIXI from "pixi.js";

/**
 * Structural type describing the subset of a `pixi-live2d-display` model
 * instance that this renderer touches. Kept internal to the package.
 */
export type Live2DModelInstance = PIXI.Container & {
  anchor?: { set: (x: number, y?: number) => void };
  internalModel?: {
    originalWidth?: number;
    originalHeight?: number;
    eyeBlink?: unknown;
    coreModel?: {
      getParameterIndex?: (id: string) => number;
      getParameterCount?: () => number;
      getParameterId?: (index: number) => string;
      getParameterMinimumValue?: (index: number) => number;
      getParameterMaximumValue?: (index: number) => number;
      getParameterDefaultValue?: (index: number) => number;
      setParameterValueById?: (id: string, value: number, weight?: number) => void;
      _model?: {
        parameters?: {
          ids?: string[];
          minimumValues?: number[];
          maximumValues?: number[];
          defaultValues?: number[];
        };
      };
    };
    on?: (event: string, handler: () => void) => void;
    off?: (event: string, handler: () => void) => void;
  };
  autoUpdate?: boolean;
  destroy: (options?: unknown) => void;
};
