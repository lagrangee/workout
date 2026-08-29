<script setup lang="ts">
import type { RecordsTab } from "./records-types";

const props = withDefaults(defineProps<{
  active: RecordsTab;
  eyebrow: string;
  heading: string;
  subtitle?: string;
  showTabs?: boolean;
  backLabel?: string;
}>(), {
  subtitle: "",
  showTabs: true,
  backLabel: "",
});

const emit = defineEmits<{
  selectTab: [tab: RecordsTab];
  back: [];
}>();

const tabs: Array<{ id: RecordsTab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "strength", label: "力量" },
  { id: "aerobic", label: "有氧" },
];
</script>

<template>
  <section class="page-head records-page-head">
    <div class="records-page-heading">
      <button
        v-if="props.backLabel"
        class="text-button records-back-button"
        data-action="aerobic-back"
        @click="emit('back')"
      >
        {{ props.backLabel }}
      </button>
      <p class="eyebrow">{{ props.eyebrow }}</p>
      <div class="records-page-title-row">
        <h1>{{ props.heading }}</h1>
        <div v-if="props.showTabs" class="records-page-actions">
          <div class="records-tabs" role="tablist" aria-label="训练记录类型">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="records-tab"
              :class="{ 'is-selected': props.active === tab.id }"
              data-action="records-tab"
              :data-tab="tab.id"
              role="tab"
              :aria-selected="props.active === tab.id"
              @click="emit('selectTab', tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="props.subtitle" class="muted">{{ props.subtitle }}</p>
    </div>
  </section>
</template>
