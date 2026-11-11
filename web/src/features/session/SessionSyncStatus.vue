<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: "idle" | "pending" | "saved" | "error" | "conflict" }>();
const emit = defineEmits<{ retry: []; discard: [] }>();
const label = computed(() => ({
  idle: "", pending: "已存本机", saved: "已同步", error: "待同步", conflict: "记录有更新",
})[props.status]);
const needsAction = computed(() => props.status === "error" || props.status === "conflict");
</script>

<template>
  <details v-if="status !== 'idle'" class="session-sync" :class="`is-${status}`" :open="status === 'conflict' || undefined" data-sync-status>
    <summary :aria-label="`训练保存状态：${label}，查看详情`">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-if="status === 'saved'" d="m4.5 10 3.5 3.5 7.5-7.5" />
        <template v-else><path d="M5.5 14.5a4 4 0 0 1-.7-7.9 5.3 5.3 0 0 1 10.1 1.2 3.4 3.4 0 0 1 .6 6.7" /><path v-if="needsAction" d="M10 9v3m0 3h.01" /><path v-else d="M10 10v6m-2-2 2 2 2-2" /></template>
      </svg>
      <span role="status" aria-live="polite">{{ label }}</span>
    </summary>
    <div class="session-sync-detail">
      <strong>{{ status === 'saved' ? '训练操作已同步' : status === 'conflict' ? '云端训练已更新' : '训练操作已保存在本机' }}</strong>
      <p>{{ status === 'saved' ? '最新操作已得到云端确认。' : status === 'conflict' ? '本机操作仍保留，请重试同步或采用云端记录。' : status === 'pending' ? '正在同步，训练可以继续。' : '暂未得到云端确认，可继续训练并重试同步。' }}</p>
      <div v-if="needsAction" class="session-sync-actions">
        <button type="button" class="text-button" data-action="retry-sync" @click="emit('retry')">重试同步</button>
        <button type="button" class="text-button" data-action="discard-sync" @click="emit('discard')">采用云端记录</button>
      </div>
    </div>
  </details>
</template>
