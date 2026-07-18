# @soullink-emotion/live2d-pixi

PIXI renderer and browser-side Live2D Cubism metadata helpers for SoulLink Live.

## Parameter metadata

The metadata helpers can be used without constructing `Live2DRenderer`:

```ts
import {
  buildMotionParameters,
  loadCDIParameterMeta,
  type Live2DMetadataFetch
} from "@soullink-emotion/live2d-pixi";

const fetchWithAuth: Live2DMetadataFetch = (url) => fetch(url, {
  headers: { Authorization: "Bearer asset-token" }
});

const cdi = await loadCDIParameterMeta("/models/avatar/avatar.model3.json", {
  fetch: fetchWithAuth,
  documentBaseUrl: "https://assets.example.com/"
});

const parameters = buildMotionParameters(live2dModel, cdi);
```

Use the lightweight `@soullink-emotion/live2d-pixi/metadata` subpath when the
renderer is not needed. It exposes the same metadata functions without loading
PIXI or `pixi-live2d-display` at runtime.

`loadCDIParameterMeta` reads `FileReferences.DisplayInfo`, resolves the CDI3
asset relative to the model, and indexes localized names by their real Cubism
parameter ids. For already parsed files, use `parseModel3DisplayInfo`,
`parseCDIParameterMeta`, `resolveRelativeURL`, or `deriveCDIUrl` independently.

`buildMotionParameters` accepts a structural Core model rather than a PIXI
class, so calibration tools can combine CDI labels with Core min/max/default
ranges without depending on renderer internals.

## Renderer

```ts
import {
  Live2DRenderer,
  createScriptTagCubismLoader
} from "@soullink-emotion/live2d-pixi";

const renderer = new Live2DRenderer(container, {
  cubismLoader: createScriptTagCubismLoader("/live2dcubismcore.min.js")
});

const parameters = await renderer.load("/models/avatar/avatar.model3.json");
```
