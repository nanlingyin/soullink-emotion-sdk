# @soullink-emotion/sdk

The Soullink Emotion SDK meta package. Installing this package installs all
eight official Soullink Emotion packages at the same version:

```bash
npm install @soullink-emotion/sdk
```

The meta package does not bundle the libraries together. Import the API you
need from its focused package so browser-only integrations such as PIXI and
Vue are loaded only by applications that use them:

```ts
import { SoullinkRuntime } from "@soullink-emotion/engine";
import { createSoullinkSession } from "@soullink-emotion/runtime-core";
```

For Live2D rendering, install the host peer dependencies in the application:

```bash
npm install vue pixi.js@^7.4.3 pixi-live2d-display@0.5.0-beta
```

See the repository integration guide for package selection and examples:
<https://github.com/nanlingyin/soullink-emotion-sdk/blob/main/packages/README.md>

## License

MIT. See [LICENSE](./LICENSE).
