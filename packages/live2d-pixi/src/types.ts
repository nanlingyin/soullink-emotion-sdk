import type { Live2DParamState } from "@soullink-emotion/engine";

/**
 * Metadata describing a single Live2D model parameter, used to drive motion
 * planning and calibration UIs. This is the canonical definition for the
 * SoulLink Live ecosystem; the web app re-exports it for backwards
 * compatibility.
 */
export interface Live2DMotionParameterInfo {
  name?: string;
  groupId?: string;
  groupName?: string;
  min: number;
  max: number;
  default: number;
}

/**
 * A loader responsible for making the Live2D Cubism Core runtime available on
 * the global scope (i.e. `window.Live2DCubismCore`). The renderer stays free of
 * any bundler-specific asset import; the integrator supplies this loader.
 */
export type CubismCoreLoader = () => Promise<void>;

/**
 * Integration hooks for {@link Live2DRenderer}. All hooks are optional so the
 * renderer can be constructed with no dependencies for testing, but `load()`
 * requires `cubismLoader` to be present.
 */
export interface Live2DRendererDeps {
  /**
   * Ensures the Cubism Core runtime is loaded before a model is created.
   * If omitted, {@link Live2DRenderer.load} throws with a clear message.
   */
  cubismLoader?: CubismCoreLoader;
  /**
   * Invoked with a parameter id when the current model has no matching
   * parameter while applying values. The parameter is skipped regardless.
   */
  onMissingParameter?: (id: string) => void;
}

export type { Live2DParamState };
