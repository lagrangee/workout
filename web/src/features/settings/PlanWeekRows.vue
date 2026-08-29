<script setup lang="ts">
import { computed } from "vue";

import type { JsonRecord } from "../../core/contracts";

const props = defineProps<{
  week: JsonRecord | null | undefined;
}>();

const weekdayLabels: Record<string, string> = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
  saturday: "周六",
  sunday: "周日",
};

interface WeekRow {
  day: string;
  label: string;
  title: string;
  summary: string;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function workoutBlocks(slot: JsonRecord): unknown[] {
  if (Array.isArray(slot.blocks)) return slot.blocks;
  const prescription = asRecord(slot.prescription);
  return Array.isArray(prescription?.blocks) ? prescription.blocks : [];
}

function workoutTitle(slot: JsonRecord): string {
  const prescription = asRecord(slot.prescription);
  return String(slot.title ?? prescription?.title ?? "");
}

function rowFor(day: string, value: unknown): WeekRow {
  const slot = asRecord(value);
  if (slot?.kind === "workout") {
    const prescription = asRecord(slot.prescription);
    const duration = slot.estimated_duration_min ?? prescription?.estimated_duration_min ?? "—";
    return {
      day,
      label: weekdayLabels[day] ?? day,
      title: workoutTitle(slot),
      summary: `${workoutBlocks(slot).length} 个训练模块 · 约 ${duration} 分钟`,
    };
  }
  if (slot?.kind === "rest") {
    return {
      day,
      label: weekdayLabels[day] ?? day,
      title: "休息日",
      summary: "今天不创建训练记录",
    };
  }
  return {
    day,
    label: weekdayLabels[day] ?? day,
    title: "无计划",
    summary: "未安排内容",
  };
}

const rows = computed(() => Object.entries(props.week ?? {}).map(([day, slot]) => rowFor(day, slot)));
</script>

<template>
  <div
    v-for="row in rows"
    :key="row.day"
    class="week-row"
  >
    <span class="day-label">{{ row.label }}</span>
    <div>
      <strong>{{ row.title }}</strong>
      <p>{{ row.summary }}</p>
    </div>
  </div>
</template>
