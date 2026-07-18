# Soullink Emotion SDK

Soullink Emotion is a real-time character emotion and performance SDK. It
turns messages and external events into VAD emotion state, FACS/action-unit
expressions, motion, lip sync, and model-specific Live2D parameters.

The repository also contains a local browser lab for testing profiles and
optional OpenAI-compatible planning and embedding services.

## Packages

| Package | Purpose |
| --- | --- |
| `@soullink-emotion/engine` | Framework-neutral emotion and performance engine |
| `@soullink-emotion/runtime-core` | Headless session, TTS, audio, and planner orchestration |
| `@soullink-emotion/planner-openai` | OpenAI-compatible reaction and speaking-motion planning |
| `@soullink-emotion/classifier-embedding` | Embedding-based emotion classification |
| `@soullink-emotion/api-client` | Typed client and runtime adapters for a deployed API |
| `@soullink-emotion/live2d-pixi` | PIXI v7 Live2D renderer integration |
| `@soullink-emotion/profile-generator` | Node.js model profile generation and validation |
| `@soullink-emotion/devtools-vue` | Vue 3 model calibration tools |

The full integration guide is in [packages/README.md](./packages/README.md).

## Development

Repository development requires Node.js 20.19 or newer (or Node.js 22.12 or
newer) and npm 10 or newer. Published non-browser packages target Node.js 18.

```bash
npm install
npm run release:check
npm run dev
```

The browser lab is available at `http://127.0.0.1:4173` after startup. Local
emotion controls work without an external service or credential.

## Security And Assets

Provider credentials belong in a trusted server environment. Never place a
credential in `src`, a `VITE_*` variable, a profile, or a published package.

Live2D models and Cubism Core are not part of the SDK package license. Confirm
their redistribution terms separately before sharing a demo repository.

## License

Soullink Emotion SDK is released under the MIT License. See [LICENSE](./LICENSE).
