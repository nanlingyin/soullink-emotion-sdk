# Releasing Soullink Emotion SDK

All packages use lockstep prerelease versions. Publish only after the same
version is present in every package and all internal peer dependencies.

## Before Publishing

1. Confirm ownership of the `@soullink-emotion` npm scope.
2. Confirm that every package manifest and tarball includes the MIT license.
3. Keep the root `api`, `.env*`, model files, archives, logs, and generated
   caches out of the repository and release artifacts.
4. Run the complete local gate:

```bash
npm ci
npm run release:check
```

`release:check` includes an official-registry production dependency audit.
Development-only audit findings should be reviewed separately because build
tools do not enter the published package tarballs.

## Beta Publish Order

Authenticate with npm, then publish from the repository root in dependency
order:

```bash
npm publish --workspace @soullink-emotion/engine --access public --tag beta
npm publish --workspace @soullink-emotion/runtime-core --access public --tag beta
npm publish --workspace @soullink-emotion/planner-openai --access public --tag beta
npm publish --workspace @soullink-emotion/classifier-embedding --access public --tag beta
npm publish --workspace @soullink-emotion/live2d-pixi --access public --tag beta
npm publish --workspace @soullink-emotion/api-client --access public --tag beta
npm publish --workspace @soullink-emotion/profile-generator --access public --tag beta
npm publish --workspace @soullink-emotion/devtools-vue --access public --tag beta
```

Publishing is intentionally not automated from a developer machine. Add
registry provenance and a protected CI release workflow after the repository
hosting location is known.
