import type { CubismCoreLoader } from "./types";

/**
 * Builds a {@link CubismCoreLoader} that injects the Live2D Cubism Core runtime
 * via a `<script>` tag pointing at `coreUrl`. The loader resolves once
 * `window.Live2DCubismCore` is present, and the underlying script is injected
 * at most once regardless of how many times the loader is invoked.
 *
 * The URL is supplied by the integrator (e.g. resolved through a bundler asset
 * import) so this package carries no bundler-specific import of the core asset.
 */
export function createScriptTagCubismLoader(coreUrl: string): CubismCoreLoader {
  let cubismCoreReady: Promise<void> | null = null;

  return () => {
    if (window.Live2DCubismCore) return Promise.resolve();

    cubismCoreReady ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = coreUrl;
      script.async = true;
      script.onload = () => {
        if (window.Live2DCubismCore) resolve();
        else reject(new Error("Cubism Core script loaded, but window.Live2DCubismCore is missing."));
      };
      script.onerror = () => reject(new Error("Failed to load Live2D Cubism Core."));
      document.head.appendChild(script);
    });

    return cubismCoreReady;
  };
}
