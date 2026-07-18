# @soullink-emotion/devtools-vue

Vue 3 calibration UI for inspecting SoulLink Live profile coverage, previewing
FACS parameters, sweeping parameter values, and saving manual parameter maps.

## Install

```sh
npm install @soullink-emotion/devtools-vue @soullink-emotion/engine vue
```

## Use

```vue
<script setup lang="ts">
import { CalibrationPanel } from "@soullink-emotion/devtools-vue";
import "@soullink-emotion/devtools-vue/style.css";
</script>

<template>
  <CalibrationPanel
    :coverage="coverage"
    :current-profile="profile"
    :parameters="motionParameters"
    @preview-profile="runtime.setProfile($event)"
    @save-calibration="saveParameterMap"
    @manual-facs-change="runtime.setManualFACS($event)"
    @manual-parameter-change="session.setManualParameters($event)"
  />
</template>
```

The component accepts these props:

- `coverage: AdaptationCoverage | null`
- `currentProfile: ModelProfile | null`
- `parameters?: Record<string, CalibrationParameterInfo>` (complete CDI/Core metadata)

It edits both the standard FACS `parameterMap` and declarative
`privateEmotionMap` rules. Private rules can target one or more arbitrary
Cubism parameter IDs, configure category, emotion triggers, `any`/`all` mode,
three-axis VAD windows, active/neutral values, intensity, priority, confidence,
and exclusive groups. Active and neutral parameter values can be previewed
directly. The save event includes a patch payload;
deleted private rules are emitted as `null` tombstones.
Mouth/jaw-open targets are rejected because LipSync owns only that channel;
other mouth-shape parameters remain available.

It emits `preview-profile`, `save-calibration`, `manual-facs-change`, and
`manual-parameter-change`.
`CalibrationPanelProps` and `CalibrationPanelEmits` are exported for typed host
wrappers. Import `@soullink-emotion/devtools-vue/style.css` once in the host app;
the CSS is scoped to the component and does not require the SoulLink Web app.
