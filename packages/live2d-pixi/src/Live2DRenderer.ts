import * as PIXI from "pixi.js";
import type { NativeAnimationDirective } from "@soullink-emotion/engine";
import type { Live2DModelInstance } from "./live2dModel";
import { buildMotionParameters, loadCDIParameterMeta } from "./motionParameters";
import type { Live2DMotionParameterInfo, Live2DParamState, Live2DRendererDeps } from "./types";

/**
 * Renders a Live2D Cubism 4 model into a host element using PIXI v7 and
 * `pixi-live2d-display`. The Cubism Core runtime is supplied by the integrator
 * through `deps.cubismLoader`, keeping this package free of any bundler-specific
 * asset import.
 */
export class Live2DRenderer {
  private app: PIXI.Application;
  private container: HTMLElement;
  private deps: Live2DRendererDeps;
  private model: Live2DModelInstance | null = null;
  private latestParams: Live2DParamState = {};
  private lastNativeAnimToken = -1;
  private suppressedParamIds: Set<string> = new Set();
  private viewScale = 1;
  private viewOffset = { x: 0, y: 0 };
  private beforeModelUpdate = () => this.applyParametersNow();
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, deps: Live2DRendererDeps = {}) {
    this.container = container;
    this.deps = deps;
    window.PIXI = PIXI;

    this.app = new PIXI.Application({
      resizeTo: container,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      antialias: true,
      backgroundAlpha: 0
    });

    container.appendChild(this.app.view as HTMLCanvasElement);
    this.resizeObserver = new ResizeObserver(() => this.fitModel());
    this.resizeObserver.observe(container);
  }

  async load(modelUrl: string): Promise<Record<string, Live2DMotionParameterInfo>> {
    if (!this.deps.cubismLoader) {
      throw new Error(
        "[Live2DRenderer] No cubismLoader provided. Pass a CubismCoreLoader via the constructor deps " +
          "(e.g. createScriptTagCubismLoader(coreUrl)) so the Cubism Core runtime can be loaded."
      );
    }

    await this.deps.cubismLoader();
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");

    this.removeModel();
    const cdiMeta = await loadCDIParameterMeta(modelUrl);
    const model = await Live2DModel.from(modelUrl, {
      autoInteract: false,
      autoUpdate: true
    });

    this.model = model as Live2DModelInstance;
    this.disableInternalEyeBlink();
    this.model.internalModel?.on?.("beforeModelUpdate", this.beforeModelUpdate);
    this.model.anchor?.set(0.5, 0.52);
    this.app.stage.addChild(this.model);
    this.fitModel();
    return buildMotionParameters(this.model, cdiMeta);
  }

  setParameters(params: Live2DParamState) {
    this.latestParams = params;
  }

  get suppressedParameterIds(): ReadonlySet<string> {
    return this.suppressedParamIds;
  }

  applyNativeAnimation(directive: NativeAnimationDirective | null): void {
    this.suppressedParamIds = new Set(directive?.suppressParamIds ?? []);

    if (directive === null) {
      if (this.lastNativeAnimToken !== 0) {
        this.applyExpression();
        this.lastNativeAnimToken = 0;
      }
      return;
    }

    if (!this.model) return;
    if (directive.token === this.lastNativeAnimToken) return;

    if (directive.expression !== null) {
      this.applyExpression(directive.expression);
    }

    if (directive.motion !== null) {
      this.applyMotion(
        directive.motion.group,
        directive.motion.index ?? 0,
        priorityFor(directive.motion.priority ?? "normal")
      );
    }

    this.lastNativeAnimToken = directive.token;
  }

  setViewScale(scale: number) {
    this.viewScale = Math.min(2.2, Math.max(0.45, scale));
    this.fitModel();
  }

  setViewOffset(offset: { x: number; y: number }) {
    this.viewOffset = { ...offset };
    this.fitModel();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.removeModel();
    this.app.destroy(true, {
      children: true,
      texture: true,
      baseTexture: true
    });
  }

  private applyExpression(name?: string): void {
    const expression = (this.model as any)?.expression;
    if (typeof expression !== "function") return;

    try {
      const result = name === undefined
        ? expression.call(this.model)
        : expression.call(this.model, name);
      void Promise.resolve(result).catch((cause) => {
        console.warn("[Live2DRenderer] Failed to apply native expression", cause);
      });
    } catch (cause) {
      console.warn("[Live2DRenderer] Failed to apply native expression", cause);
    }
  }

  private applyMotion(group: string, index: number, priority: number): void {
    const motion = (this.model as any)?.motion;
    if (typeof motion !== "function") return;

    try {
      void Promise.resolve(motion.call(this.model, group, index, priority)).catch((cause) => {
        console.warn("[Live2DRenderer] Failed to apply native motion", cause);
      });
    } catch (cause) {
      console.warn("[Live2DRenderer] Failed to apply native motion", cause);
    }
  }

  private removeModel() {
    if (!this.model) return;

    this.model.internalModel?.off?.("beforeModelUpdate", this.beforeModelUpdate);
    this.app.stage.removeChild(this.model);
    this.model.destroy({
      children: true,
      texture: true,
      baseTexture: true
    });
    this.model = null;
    // Reset native animation state so a fresh load re-applies the current directive.
    this.lastNativeAnimToken = -1;
    this.suppressedParamIds = new Set();
  }

  private disableInternalEyeBlink() {
    if (!this.model?.internalModel) return;
    this.model.internalModel.eyeBlink = undefined;
  }

  private fitModel() {
    if (!this.model) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const originalWidth = (this.model.internalModel?.originalWidth ?? this.model.width) || 1;
    const originalHeight = (this.model.internalModel?.originalHeight ?? this.model.height) || 1;
    const scale = Math.min(width / originalWidth, height / originalHeight) * 1.02 * this.viewScale;

    this.model.scale.set(scale);
    this.model.x = width * 0.5 + this.viewOffset.x;
    this.model.y = height * 0.56 + this.viewOffset.y;
  }

  private applyParametersNow() {
    const coreModel = this.model?.internalModel?.coreModel;
    if (!coreModel?.setParameterValueById) return;

    for (const [id, value] of Object.entries(this.latestParams)) {
      if (this.suppressedParamIds.has(id)) continue;

      if (coreModel.getParameterIndex && coreModel.getParameterIndex(id) < 0) {
        this.deps.onMissingParameter?.(id);
        continue;
      }
      coreModel.setParameterValueById(id, value, 1);
    }
  }
}

function priorityFor(priority: NonNullable<NativeAnimationDirective["motion"]>["priority"]): number {
  // pixi-live2d-display declares MotionPriority as NONE=0, IDLE=1, NORMAL=2, FORCE=3.
  if (priority === "idle") return 1;
  if (priority === "force") return 3;
  return 2;
}
