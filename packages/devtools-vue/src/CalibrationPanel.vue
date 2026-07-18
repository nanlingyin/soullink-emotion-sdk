<template>
  <div class="calibration-panel">
    <!-- ---- Coverage summary bar ---- -->
    <div v-if="coverage" class="cal-summary">
      <div class="cal-stat">
        <span>Mapped</span>
        <strong>{{ coverage.mappedKeyCount }}/{{ coverage.facsKeyCount }}</strong>
      </div>
      <div class="cal-stat">
        <span>CDI Used</span>
        <strong>{{ coverage.usedCdiParameterCount }}/{{ coverage.cdiParameterCount }}</strong>
      </div>
      <div class="cal-stat">
        <span>Provider</span>
        <strong>{{ coverage.provider }}</strong>
      </div>
      <div v-if="coverage.lowConfidenceKeys.length" class="cal-stat cal-warn">
        <span>Low Conf</span>
        <strong>{{ coverage.lowConfidenceKeys.length }}</strong>
      </div>
    </div>

    <!-- ---- FACS key coverage table ---- -->
    <section v-if="coverage" class="cal-keys-section">
      <div class="section-title">
        <span>FACS Key Coverage</span>
      </div>
      <div class="cal-keys-grid">
        <div
          v-for="item in coverage.perKey"
          :key="item.key"
          class="cal-key-row"
          :class="{ mapped: item.status === 'mapped', unmapped: item.status === 'unmapped', 'low-conf': item.confidence === 'low' && item.status === 'mapped' }"
        >
          <span class="cal-key-name">{{ item.key }}</span>
          <span class="cal-badge" :class="statusBadgeClass(item.status, item.confidence)">
            {{ item.status === 'mapped' ? item.confidence : 'unmapped' }}
          </span>
          <span v-if="item.targets.length" class="cal-targets">{{ item.targets.join(', ') }}</span>
          <span v-else class="cal-targets muted">—</span>
        </div>
      </div>
    </section>

    <!-- ---- Sweep tool ---- -->
    <section class="cal-sweep-section">
      <div class="section-title">
        <span>Sweep Test</span>
      </div>
      <div class="control-row">
        <span>Key</span>
        <select v-model="sweepKey">
          <option v-for="k in sweepableKeys" :key="k" :value="k">{{ k }}</option>
        </select>
      </div>
      <div class="control-row">
        <span>Value</span>
        <input
          :value="sweepValue"
          type="range"
          :min="sweepRange[0]"
          :max="sweepRange[1]"
          step="0.01"
          :disabled="!sweepActive"
          @input="onSweepInput"
        />
        <output>{{ sweepValue.toFixed(2) }}</output>
      </div>
      <div class="cal-sweep-btns">
        <button v-if="!sweepActive" type="button" class="cal-btn" @click="startSweep">Start Sweep</button>
        <button v-else type="button" class="cal-btn secondary" @click="stopSweep">Stop</button>
        <button type="button" class="cal-btn secondary" :disabled="sweepActive" @click="autoSweep">Auto Play</button>
      </div>
    </section>

    <!-- ---- Per-rule edit ---- -->
    <section v-if="editableProfile" class="cal-rules-section">
      <div class="section-title">
        <span>Parameter Map Rules</span>
      </div>
      <div class="cal-rules-scroll">
        <div v-for="(rule, facsKey) in editableProfile.parameterMap" :key="facsKey" class="cal-rule">
          <div class="cal-rule-header">
            <span class="cal-rule-key">{{ facsKey }}</span>
            <span class="cal-rule-target">{{ ruleTargetLabel(rule) }}</span>
          </div>
          <div class="cal-rule-fields">
            <label class="cal-field">
              <span>scale</span>
              <input
                type="number"
                step="0.01"
                :value="rule?.scale ?? 1"
                @change="patchRule(String(facsKey), 'scale', $event)"
              />
            </label>
            <label class="cal-field">
              <span>min</span>
              <input
                type="number"
                step="0.01"
                :value="rule?.min ?? ''"
                placeholder="auto"
                @change="patchRule(String(facsKey), 'min', $event)"
              />
            </label>
            <label class="cal-field">
              <span>max</span>
              <input
                type="number"
                step="0.01"
                :value="rule?.max ?? ''"
                placeholder="auto"
                @change="patchRule(String(facsKey), 'max', $event)"
              />
            </label>
          </div>
        </div>
      </div>
    </section>

    <section v-if="editableProfile" class="cal-private-section">
      <div class="section-title cal-private-title">
        <span>Private Emotion Rules</span>
        <button type="button" class="cal-icon-btn" title="Add private emotion rule" @click="addPrivateRule">+</button>
      </div>
      <div v-if="privateRuleEntries.length" class="cal-rules-scroll">
        <div v-for="[ruleKey, rule] in privateRuleEntries" :key="ruleKey" class="cal-rule">
          <div class="cal-rule-header">
            <input class="cal-rule-name" :value="ruleKey" aria-label="Rule name" @change="renamePrivateRule(ruleKey, $event)" />
            <span class="cal-rule-source">{{ rule.source ?? 'unknown' }}</span>
            <button type="button" class="cal-icon-btn danger" title="Remove private emotion rule" @click="removePrivateRule(ruleKey)">×</button>
          </div>
          <div class="cal-private-grid">
            <label class="cal-field cal-wide">
              <span>parameter IDs (comma separated)</span>
              <input
                :value="privateTargets(rule).join(', ')"
                :list="`cal-private-targets-${ruleKey}`"
                placeholder="Param6, Param7"
                @change="patchPrivateTargets(ruleKey, $event)"
              />
              <datalist :id="`cal-private-targets-${ruleKey}`">
                <option v-for="option in parameterOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
              </datalist>
            </label>
            <label class="cal-field">
              <span>category</span>
              <select :value="rule.category ?? 'privateEffect'" @change="patchPrivateSelect(ruleKey, 'category', $event)">
                <option v-for="category in privateCategories" :key="category" :value="category">{{ category }}</option>
              </select>
            </label>
            <label class="cal-field">
              <span>trigger</span>
              <select :value="rule.triggerMode ?? 'any'" @change="patchPrivateSelect(ruleKey, 'triggerMode', $event)">
                <option value="any">any</option>
                <option value="all">all</option>
              </select>
            </label>
            <label class="cal-field cal-wide">
              <span>emotions (comma separated)</span>
              <input :value="(rule.emotions ?? []).join(', ')" placeholder="confused, curious" @change="patchPrivateEmotions(ruleKey, $event)" />
            </label>
            <div class="cal-vad-ranges cal-wide">
              <span class="cal-field-label">VAD ranges</span>
              <div v-for="axis in vadAxes" :key="axis" class="cal-vad-row">
                <label class="cal-vad-toggle">
                  <input
                    type="checkbox"
                    :checked="Boolean(rule.vadRange?.[axis])"
                    @change="togglePrivateVADRange(ruleKey, axis, $event)"
                  />
                  <span>{{ axis }}</span>
                </label>
                <input
                  type="number"
                  min="-1"
                  max="1"
                  step="0.05"
                  :disabled="!rule.vadRange?.[axis]"
                  :value="rule.vadRange?.[axis]?.[0] ?? -1"
                  :aria-label="`${axis} minimum`"
                  @change="patchPrivateVADBound(ruleKey, axis, 0, $event)"
                />
                <span>to</span>
                <input
                  type="number"
                  min="-1"
                  max="1"
                  step="0.05"
                  :disabled="!rule.vadRange?.[axis]"
                  :value="rule.vadRange?.[axis]?.[1] ?? 1"
                  :aria-label="`${axis} maximum`"
                  @change="patchPrivateVADBound(ruleKey, axis, 1, $event)"
                />
              </div>
            </div>
            <label class="cal-field">
              <span>active</span>
              <input type="number" step="0.01" :value="rule.activeValue ?? 1" @change="patchPrivateNumber(ruleKey, 'activeValue', $event)" />
            </label>
            <label class="cal-field">
              <span>neutral</span>
              <input type="number" step="0.01" :value="rule.neutralValue ?? 0" @change="patchPrivateNumber(ruleKey, 'neutralValue', $event)" />
            </label>
            <label class="cal-field">
              <span>intensity</span>
              <input type="number" min="0" max="1" step="0.05" :value="rule.intensity ?? 1" @change="patchPrivateNumber(ruleKey, 'intensity', $event)" />
            </label>
            <label class="cal-field">
              <span>priority</span>
              <input type="number" min="-1000" max="1000" step="1" :value="rule.priority ?? 0" @change="patchPrivateNumber(ruleKey, 'priority', $event)" />
            </label>
            <label class="cal-field">
              <span>confidence</span>
              <input type="number" min="0" max="1" step="0.05" :value="rule.confidence ?? 1" @change="patchPrivateNumber(ruleKey, 'confidence', $event)" />
            </label>
            <label class="cal-field cal-wide">
              <span>exclusive group</span>
              <input :value="rule.exclusiveGroup ?? ''" placeholder="face-effect" @change="patchPrivateText(ruleKey, 'exclusiveGroup', $event)" />
            </label>
            <div class="cal-rule-preview">
              <button type="button" class="cal-btn secondary" :disabled="!firstPrivateTarget(rule)" @click="previewPrivateRule(rule, true)">On</button>
              <button type="button" class="cal-btn secondary" :disabled="!firstPrivateTarget(rule)" @click="previewPrivateRule(rule, false)">Off</button>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="cal-empty">No private emotion rules</p>
      <p v-if="privateRuleError" class="cal-error">{{ privateRuleError }}</p>
    </section>

    <!-- ---- Unmapped CDI parameters ---- -->
    <section v-if="coverage && coverage.unmappedCdiParameters.length" class="cal-unmapped-section">
      <div class="section-title">
        <span>Unmapped CDI Params ({{ coverage.unmappedCdiParameters.length }})</span>
      </div>
      <div class="cal-unmapped-list">
        <div v-for="param in coverage.unmappedCdiParameters" :key="param.id" class="cal-unmapped-row">
          <span class="cal-param-id">{{ param.id }}</span>
          <span v-if="param.guessedFacsKey" class="cal-guess">hint: {{ param.guessedFacsKey }}</span>
          <span v-else class="cal-guess muted">no hint</span>
        </div>
      </div>
    </section>

    <!-- ---- Save / Preview actions ---- -->
    <div class="cal-actions">
      <button
        type="button"
        class="cal-btn"
        :disabled="!hasEdits || Boolean(privateRuleError)"
        @click="emitPreview"
      >
        Preview
      </button>
      <button
        type="button"
        class="cal-btn primary"
        :disabled="!hasEdits || saving || Boolean(privateRuleError)"
        @click="emitSave"
      >
        {{ saving ? 'Saving...' : 'Save Calibration' }}
      </button>
    </div>

    <p v-if="saveError" class="cal-error">{{ saveError }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ModelProfile,
  ParameterMap,
  ParameterMapRule,
  PartialFACSLikeState,
  PrivateEmotionCategory,
  PrivateEmotionMap,
  PrivateEmotionMapping,
  PrivateEmotionVADRange
} from "@soullink-emotion/engine";
import { facsKeys } from "@soullink-emotion/engine";
import { buildPrivateEmotionMapPatch, clonePrivateEmotionMap } from "./privateEmotionMap";
import type { CalibrationPanelEmits, CalibrationPanelProps } from "./types";

const props = defineProps<CalibrationPanelProps>();

const emit = defineEmits<CalibrationPanelEmits>();

// ---- Editable copy of the current profile ----

const editableProfile = ref<ModelProfile | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const originalParameterMap = ref<ParameterMap>({});
const originalPrivateEmotionMap = ref<PrivateEmotionMap>({});
let editableModelKey = "";

watch(
  () => props.currentProfile,
  (next) => {
    if (!next) {
      editableProfile.value = null;
      originalParameterMap.value = {};
      originalPrivateEmotionMap.value = {};
      editableModelKey = "";
      return;
    }

    const nextModelKey = `${next.modelId}\u0000${next.modelPath}`;
    if (!editableProfile.value || editableModelKey !== nextModelKey) {
      // Preserve in-progress edits across previews, but reset when the host switches models.
      editableProfile.value = {
        ...next,
        parameterMap: clone(next.parameterMap ?? {}),
        privateEmotionMap: clonePrivateEmotionMap(next.privateEmotionMap)
      };
      originalParameterMap.value = clone(next.parameterMap ?? {});
      originalPrivateEmotionMap.value = clonePrivateEmotionMap(next.privateEmotionMap);
      editableModelKey = nextModelKey;
    }
  },
  { immediate: true }
);

const hasEdits = computed(() => {
  if (!editableProfile.value) return false;
  return JSON.stringify(editableProfile.value.parameterMap) !== JSON.stringify(originalParameterMap.value)
    || JSON.stringify(editableProfile.value.privateEmotionMap ?? {}) !== JSON.stringify(originalPrivateEmotionMap.value);
});

const privateCategories: PrivateEmotionCategory[] = [
  "positiveEye", "blush", "tear", "shadow", "anger", "sweat", "surprise", "privateEffect"
];
const vadAxes = ["valence", "arousal", "dominance"] as const;
type VADAxis = (typeof vadAxes)[number];
const privateRuleEntries = computed(() => Object.entries(editableProfile.value?.privateEmotionMap ?? {}));
const privateRuleError = computed(() => {
  for (const [key, rule] of privateRuleEntries.value) {
    const targets = privateTargets(rule);
    if (targets.length === 0) return `${key}: at least one parameter ID is required`;
    const blocked = targets.find(isMouthOpenTarget);
    if (blocked) return `${key}: ${blocked} is a mouth-open parameter reserved for LipSync`;
  }
  return null;
});
const parameterOptions = computed(() => {
  const all = new Map<string, string>();
  for (const [id, info] of Object.entries(props.parameters ?? {})) {
    all.set(id, info.name && info.name !== id ? `${info.name} (${id})` : id);
  }
  for (const param of props.coverage?.unmappedCdiParameters ?? []) {
    all.set(param.id, param.name && param.name !== param.id ? `${param.name} (${param.id})` : param.id);
  }
  for (const rule of Object.values(editableProfile.value?.privateEmotionMap ?? {})) {
    for (const id of privateTargets(rule)) if (!all.has(id)) all.set(id, id);
  }
  return [...all].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label));
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function privateTargets(rule: PrivateEmotionMapping): string[] {
  return rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
}

function firstPrivateTarget(rule: PrivateEmotionMapping): string {
  return privateTargets(rule)[0] ?? "";
}

function mutablePrivateMap(): PrivateEmotionMap | null {
  if (!editableProfile.value) return null;
  editableProfile.value.privateEmotionMap ??= {};
  return editableProfile.value.privateEmotionMap;
}

function addPrivateRule(): void {
  const map = mutablePrivateMap();
  if (!map) return;
  let index = 1;
  while (map[`privateEffect${index}`]) index += 1;
  map[`privateEffect${index}`] = {
    targets: [],
    category: "privateEffect",
    emotions: ["confused"],
    activeValue: 1,
    neutralValue: 0,
    intensity: 1,
    exclusiveGroup: "face-effect",
    source: "manual",
    confidence: 1
  };
  emitPreview();
}

function removePrivateRule(key: string): void {
  const map = mutablePrivateMap();
  if (!map) return;
  delete map[key];
  emitPreview();
}

function renamePrivateRule(key: string, event: Event): void {
  const map = mutablePrivateMap();
  const next = (event.target as HTMLInputElement).value.trim().slice(0, 80);
  if (!map || !next || next === key || map[next]) return;
  map[next] = map[key];
  delete map[key];
  emitPreview();
}

function patchPrivateTargets(key: string, event: Event): void {
  const targets = uniqueList((event.target as HTMLInputElement).value);
  patchPrivateRule(key, { targets, target: undefined });
}

function patchPrivateEmotions(key: string, event: Event): void {
  const emotions = uniqueList((event.target as HTMLInputElement).value);
  patchPrivateRule(key, { emotions });
}

function patchPrivateNumber(
  key: string,
  field: "activeValue" | "neutralValue" | "intensity" | "priority" | "confidence",
  event: Event
): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  let value = Number.isFinite(parsed) ? parsed : undefined;
  if (value !== undefined && (field === "intensity" || field === "confidence")) value = clamp(value, 0, 1);
  if (value !== undefined && field === "priority") value = clamp(value, -1000, 1000);
  patchPrivateRule(key, { [field]: value });
}

function patchPrivateText(key: string, field: "exclusiveGroup", event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim();
  patchPrivateRule(key, { [field]: value || undefined });
}

function patchPrivateSelect(
  key: string,
  field: "category" | "triggerMode",
  event: Event
): void {
  patchPrivateRule(key, { [field]: (event.target as HTMLSelectElement).value });
}

function patchPrivateRule(key: string, patch: Partial<PrivateEmotionMapping>): void {
  const map = mutablePrivateMap();
  if (!map?.[key]) return;
  map[key] = { ...map[key], ...patch };
  emitPreview();
}

function togglePrivateVADRange(key: string, axis: VADAxis, event: Event): void {
  const map = mutablePrivateMap();
  const rule = map?.[key];
  if (!rule) return;
  const vadRange: PrivateEmotionVADRange = { ...(rule.vadRange ?? {}) };
  if ((event.target as HTMLInputElement).checked) vadRange[axis] = [-1, 1];
  else delete vadRange[axis];
  patchPrivateRule(key, { vadRange: Object.keys(vadRange).length ? vadRange : undefined });
}

function patchPrivateVADBound(
  key: string,
  axis: VADAxis,
  index: 0 | 1,
  event: Event
): void {
  const map = mutablePrivateMap();
  const rule = map?.[key];
  const current = rule?.vadRange?.[axis];
  if (!rule || !current) return;
  const value = clamp(Number((event.target as HTMLInputElement).value), -1, 1);
  if (!Number.isFinite(value)) return;
  const pair: [number, number] = [...current];
  pair[index] = value;
  pair.sort((left, right) => left - right);
  patchPrivateRule(key, { vadRange: { ...rule.vadRange, [axis]: pair } });
}

function previewPrivateRule(rule: PrivateEmotionMapping, active: boolean): void {
  const values: Record<string, number> = {};
  for (const target of privateTargets(rule)) {
    const info = props.parameters?.[target];
    values[target] = active
      ? (rule.activeValue ?? info?.max ?? 1)
      : (rule.neutralValue ?? info?.default ?? 0);
  }
  if (Object.keys(values).length) emit("manual-parameter-change", values);
}

function uniqueList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean))];
}

function isMouthOpenTarget(id: string): boolean {
  const info = props.parameters?.[id];
  const text = `${id} ${info?.name ?? ""}`.toLowerCase().replace(/[\s_\-　]/gu, "");
  if ([
    "mouthform", "mouthshape", "lipshape", "lipform", "liptype", "嘴型", "口型", "唇形", "唇型"
  ].some((needle) => text.includes(needle))) return false;
  return [
    "mouthopen", "openmouth", "jawopen", "openjaw", "嘴张开", "张嘴", "嘴巴开合", "嘴开合", "口部开合", "下颌开合"
  ].some((needle) => text.includes(needle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function patchRule(facsKey: string, field: "scale" | "min" | "max", event: Event): void {
  if (!editableProfile.value) return;
  const val = parseFloat((event.target as HTMLInputElement).value);
  const existing: ParameterMapRule = (editableProfile.value.parameterMap as Record<string, ParameterMapRule>)[facsKey] ?? {};
  if (isNaN(val)) {
    // clear the field (undefined = auto)
    const updated = { ...existing } as Record<string, unknown>;
    delete updated[field];
    (editableProfile.value.parameterMap as Record<string, ParameterMapRule>)[facsKey] = updated as ParameterMapRule;
  } else {
    (editableProfile.value.parameterMap as Record<string, ParameterMapRule>)[facsKey] = { ...existing, [field]: val };
  }
  emitPreview();
}

function ruleTargetLabel(rule: ParameterMapRule | undefined): string {
  if (!rule) return "—";
  if (rule.targets?.length) return rule.targets.join(", ");
  return rule.target ?? "—";
}

// ---- Sweep ----

const signedFacsKeys = new Set([
  "headX", "headY", "headZ",
  "bodyX", "bodyY", "bodyZ",
  "gazeX", "gazeY"
]);

const sweepableKeys = facsKeys;
const sweepKey = ref<string>(facsKeys[0] ?? "headX");
const sweepValue = ref(0);
const sweepActive = ref(false);
let animHandle: number | null = null;

const sweepRange = computed((): [number, number] => {
  return signedFacsKeys.has(sweepKey.value) ? [-1, 1] : [0, 1];
});

// Reset sweep value to zero when the range changes.
watch(sweepRange, () => {
  sweepValue.value = 0;
});

function onSweepInput(event: Event): void {
  sweepValue.value = parseFloat((event.target as HTMLInputElement).value);
  if (sweepActive.value) {
    emitFACSFrame(sweepValue.value);
  }
}

function emitFACSFrame(value: number): void {
  emit("manual-facs-change", { [sweepKey.value]: value } as PartialFACSLikeState);
}

function startSweep(): void {
  sweepActive.value = true;
}

function stopSweep(): void {
  sweepActive.value = false;
  if (animHandle !== null) {
    cancelAnimationFrame(animHandle);
    animHandle = null;
  }
  // Clear manual FACS in the host runtime.
  emit("manual-facs-change", {});
}

let autoSweepStart: number | null = null;
const AUTO_SWEEP_PERIOD_MS = 3000;

function autoSweep(): void {
  if (!sweepActive.value) {
    sweepActive.value = true;
  }
  autoSweepStart = performance.now();
  const [lo, hi] = sweepRange.value;
  const range = hi - lo;

  const tick = (now: number): void => {
    if (!sweepActive.value) return;
    const t = ((now - (autoSweepStart ?? now)) % AUTO_SWEEP_PERIOD_MS) / AUTO_SWEEP_PERIOD_MS;
    // Sine wave in [lo, hi].
    const value = lo + range * 0.5 * (1 + Math.sin(t * 2 * Math.PI - Math.PI / 2));
    sweepValue.value = parseFloat(value.toFixed(3));
    emitFACSFrame(sweepValue.value);
    animHandle = requestAnimationFrame(tick);
  };

  animHandle = requestAnimationFrame(tick);
}

// ---- Status badge ----

function statusBadgeClass(status: string, confidence: string): string {
  if (status === "unmapped") return "badge-unmapped";
  if (confidence === "high") return "badge-high";
  if (confidence === "medium") return "badge-medium";
  return "badge-low";
}

// ---- Emit preview / save ----

function emitPreview(): void {
  if (!editableProfile.value) return;
  emit("preview-profile", {
    ...editableProfile.value,
    parameterMap: clone(editableProfile.value.parameterMap),
    privateEmotionMap: clonePrivateEmotionMap(editableProfile.value.privateEmotionMap)
  });
}

async function emitSave(): Promise<void> {
  if (!editableProfile.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const privateEmotionMap = buildPrivateEmotionMapPatch(
      originalPrivateEmotionMap.value,
      editableProfile.value.privateEmotionMap
    );
    emit("save-calibration", editableProfile.value.parameterMap, { privateEmotionMap });
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.calibration-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.cal-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 6px;
  padding: 10px 0;
}

.cal-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cal-stat span {
  color: rgba(247, 243, 234, 0.5);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cal-stat strong {
  font-size: 13px;
  font-weight: 700;
}

.cal-stat.cal-warn strong {
  color: #f7d98b;
}

/* Key coverage grid */
.cal-keys-section {
  padding: 10px 0 8px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-keys-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.cal-key-row {
  display: grid;
  grid-template-columns: 98px 64px 1fr;
  gap: 6px;
  align-items: center;
  padding: 2px 0;
  font-size: 11px;
}

.cal-key-name {
  font-weight: 600;
}

.cal-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.badge-high { background: rgba(48, 200, 176, 0.2); color: #30c8b0; }
.badge-medium { background: rgba(247, 217, 139, 0.2); color: #f7d98b; }
.badge-low { background: rgba(242, 155, 118, 0.2); color: #f29b76; }
.badge-unmapped { background: rgba(247, 243, 234, 0.12); color: rgba(247, 243, 234, 0.4); }

.cal-targets {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(247, 243, 234, 0.56);
}

.cal-targets.muted {
  color: rgba(247, 243, 234, 0.28);
}

/* Sweep section */
.cal-sweep-section {
  padding: 10px 0 8px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-sweep-btns {
  display: flex;
  gap: 8px;
  padding-top: 8px;
}

/* Rule edit */
.cal-rules-section {
  padding: 10px 0 8px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-rules-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.cal-rule {
  padding: 6px 8px;
  border: 1px solid rgba(247, 243, 234, 0.1);
  border-radius: 6px;
  background: rgba(247, 243, 234, 0.04);
}

.cal-rule-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.cal-rule-key {
  font-size: 12px;
  font-weight: 700;
}

.cal-rule-target {
  font-size: 11px;
  color: rgba(247, 243, 234, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.cal-rule-fields {
  display: flex;
  gap: 8px;
}

.cal-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.cal-field span {
  font-size: 10px;
  color: rgba(247, 243, 234, 0.5);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cal-field input {
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(247, 243, 234, 0.16);
  border-radius: 4px;
  background: rgba(247, 243, 234, 0.08);
  color: #f7f3ea;
  font-size: 11px;
}

/* Unmapped CDI */
.cal-private-section {
  padding: 10px 0 8px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-private-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cal-private-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.cal-wide,
.cal-rule-preview {
  grid-column: 1 / -1;
}

.cal-rule-name,
.cal-field select {
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(247, 243, 234, 0.16);
  border-radius: 4px;
  background: rgba(247, 243, 234, 0.08);
  color: #f7f3ea;
  font-size: 11px;
}

.cal-rule-name {
  width: auto;
  flex: 1;
  font-weight: 700;
}

.cal-rule-source {
  align-self: center;
  flex: 0 0 auto;
  color: rgba(247, 243, 234, 0.4);
  font-size: 10px;
}

.cal-field select option {
  color: #111;
}

.cal-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: rgba(247, 243, 234, 0.12);
  color: #f7f3ea;
  font-size: 18px;
  line-height: 1;
}

.cal-icon-btn.danger {
  color: #f29b76;
}

.cal-rule-preview {
  display: flex;
  gap: 8px;
}

.cal-vad-ranges {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cal-field-label {
  color: rgba(247, 243, 234, 0.5);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.cal-vad-row {
  display: grid;
  grid-template-columns: minmax(84px, 1fr) minmax(0, 1fr) 16px minmax(0, 1fr);
  gap: 5px;
  align-items: center;
  font-size: 10px;
}

.cal-vad-toggle {
  display: flex;
  gap: 5px;
  align-items: center;
  min-width: 0;
}

.cal-vad-row input[type="number"] {
  width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0 5px;
  border: 1px solid rgba(247, 243, 234, 0.16);
  border-radius: 4px;
  background: rgba(247, 243, 234, 0.08);
  color: #f7f3ea;
  font-size: 11px;
}

.cal-empty {
  margin: 4px 0;
  color: rgba(247, 243, 234, 0.4);
  font-size: 11px;
}

.cal-unmapped-section {
  padding: 10px 0 8px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-unmapped-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 140px;
  overflow-y: auto;
}

.cal-unmapped-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  font-size: 11px;
}

.cal-param-id {
  color: rgba(247, 243, 234, 0.7);
  font-family: monospace;
}

.cal-guess {
  font-size: 10px;
  color: #f7d98b;
}

.cal-guess.muted {
  color: rgba(247, 243, 234, 0.3);
}

/* Actions */
.cal-actions {
  display: flex;
  gap: 8px;
  padding: 10px 0 6px;
  border-top: 1px solid rgba(247, 243, 234, 0.1);
}

.cal-btn {
  flex: 1;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  background: rgba(247, 243, 234, 0.12);
  color: #f7f3ea;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s;
}

.cal-btn:hover:not(:disabled) {
  background: rgba(247, 243, 234, 0.2);
}

.cal-btn.primary {
  background: rgba(48, 200, 176, 0.22);
  color: #30c8b0;
}

.cal-btn.primary:hover:not(:disabled) {
  background: rgba(48, 200, 176, 0.36);
}

.cal-btn.secondary {
  background: rgba(247, 243, 234, 0.08);
}

.cal-error {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(242, 155, 118, 0.18);
  color: #f29b76;
  font-size: 11px;
}

/* Global utilities referenced from main.css */
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.control-row span:first-child {
  flex: 0 0 54px;
  color: rgba(247, 243, 234, 0.56);
}

.control-row input[type="range"] {
  flex: 1;
}

.control-row select {
  flex: 1;
  height: 28px;
  padding: 0 6px;
  border: 1px solid rgba(247, 243, 234, 0.16);
  border-radius: 4px;
  background: rgba(247, 243, 234, 0.08);
  color: #f7f3ea;
  font-size: 11px;
}
</style>
