<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";

import type { ApiErrorBody, JsonRecord, WorkoutAppStore } from "../../core/contracts";
import PlanWeekRows from "./PlanWeekRows.vue";
import {
  bindRetainedStateToAthlete,
  clearRetainedState,
  retainedStateFor,
  syncRetainedStateToAuthEpoch,
  type RetainedProfileState,
} from "./settings-runtime";

interface ProfileSettings {
  display_name: string;
  timezone: string;
}

interface ShareState {
  active: boolean;
  share_key: string | null;
  url: string | null;
}

interface AgentAccessState {
  active: boolean;
  created_at: string | null;
  rotated_at: string | null;
  revoked_at: string | null;
}

interface AgentTokenResponse extends AgentAccessState {
  token: string;
}

interface AgentRevokeResponse {
  active: boolean;
  revoked: boolean;
}

interface PlanValidationResponse {
  preview: JsonRecord;
  batch_digest?: string;
  base_plan_digest?: string;
}

interface PlanEvidence {
  batch_digest: string;
  base_plan_digest: string;
}

type PlanEditorMode = "single" | "batch";
type LoadStatus = "loading" | "ready" | "error";

interface ErrorWithApiBody {
  message?: string;
  data?: ApiErrorBody;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function planWeek(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function planValidationMessage(error: unknown): string {
  const candidate = isRecord(error) ? error as ErrorWithApiBody : null;
  const details = candidate?.data?.error?.details;
  const detailMessage = details
    ?.map((detail) => `${detail.path ?? ""}: ${detail.message ?? ""}`)
    .join("\n");
  return detailMessage || candidate?.data?.error?.message || candidate?.message || "计划需要修正";
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (!value || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const candidate = match?.[1]?.trim().replace(/[\\/]/g, "-");
  return candidate || "workout-data.json";
}

const props = defineProps<{
  app: WorkoutAppStore;
}>();

const retained = retainedStateFor(props.app);
const verifiedAthleteKey = ref<string | null>(null);
const transientDraft = ref("");
const transientAgentToken = ref<string | null>(null);
const profile = toRef(retained, "profile");
const displayName = ref("");
const timezone = ref(props.app.state.today?.timezone ?? "Asia/Shanghai");
const profileStatus = ref<LoadStatus>("loading");
const profileDirty = ref(false);
const profilePending = toRef(retained, "profilePending");
const share = ref<ShareState | null>(null);
const shareStatus = ref<LoadStatus>("loading");
const sharePending = toRef(retained, "sharePending");
const agentAccess = ref<AgentAccessState | null>(null);
const agentAccessStatus = ref<LoadStatus>("loading");
const agentAccessPending = toRef(retained, "agentAccessPending");
const agentAccessToken = computed<string | null>({
  get: () => verifiedAthleteKey.value
    && retained.athleteKey === verifiedAthleteKey.value
    ? retained.agentToken
    : transientAgentToken.value,
  set: (token) => {
    if (verifiedAthleteKey.value && retained.athleteKey === verifiedAthleteKey.value) {
      retained.agentToken = token;
    } else {
      transientAgentToken.value = token;
    }
  },
});

const sheetOpen = ref(false);
const draft = computed<string>({
  get: () => verifiedAthleteKey.value
    && retained.athleteKey === verifiedAthleteKey.value
    ? retained.draft
    : transientDraft.value,
  set: (value) => {
    if (verifiedAthleteKey.value && retained.athleteKey === verifiedAthleteKey.value) {
      retained.draft = value;
    } else {
      transientDraft.value = value;
    }
  },
});
const preview = ref<JsonRecord | null>(null);
const planEditorMode = ref<PlanEditorMode | null>(null);
const planEvidence = ref<PlanEvidence | null>(null);
const validatedDraft = ref<string | null>(null);
const planError = ref<string | null>(null);
const planPending = toRef(retained, "planPending");
const exportPending = toRef(retained, "exportPending");
const logoutPending = toRef(retained, "logoutPending");
const authUnavailable = computed(() => logoutPending.value || props.app.state.authRequired);

let shareLoadGeneration = 0;
let agentAccessLoadGeneration = 0;
let instanceActive = true;

const currentPlan = computed(() => props.app.state.plan?.current ?? null);
const futurePlans = computed(() => props.app.state.plan?.future ?? []);
const agentAccessActive = computed(() => Boolean(agentAccessToken.value) || Boolean(agentAccess.value?.active));
const isBatchPreview = computed(() => planEditorMode.value === "batch");
const batchPreviewUpdates = computed<JsonRecord[]>(() => {
  const updates = preview.value?.updates;
  return Array.isArray(updates) ? updates.filter(isRecord) : [];
});
const previewHeading = computed(() => isBatchPreview.value
  ? `确认 ${preview.value?.update_count ?? batchPreviewUpdates.value.length} 周计划`
  : "确认更新计划");
const previewMeta = computed(() => isBatchPreview.value
  ? `${preview.value?.from ?? ""} – ${preview.value?.to ?? ""} · 原子化一次应用`
  : `${preview.value?.effective_from ?? ""} 生效 · ${preview.value?.changed_weekday_slot_count ?? 0} 个日期槽位发生变化`);
const planErrorLines = computed(() => planError.value?.split("\n") ?? []);
const anySettingsPending = computed(() => profilePending.value
  || sharePending.value
  || agentAccessPending.value
  || planPending.value
  || exportPending.value
  || authUnavailable.value);

interface RuntimeSnapshot {
  epoch: number;
  authEpoch: number;
  athleteKey: string | null;
}

function runtimeSnapshot(): RuntimeSnapshot {
  return {
    epoch: retained.epoch,
    authEpoch: props.app.state.authEpoch,
    athleteKey: verifiedAthleteKey.value,
  };
}

function runtimeIsCurrent(snapshot: RuntimeSnapshot): boolean {
  return instanceActive
    && verifiedAthleteKey.value === snapshot.athleteKey
    && runtimeIdentityIsCurrent(snapshot);
}

function runtimeIdentityIsCurrent(snapshot: RuntimeSnapshot): boolean {
  return !props.app.state.authRequired
    && props.app.state.authEpoch === snapshot.authEpoch
    && retained.authEpoch === snapshot.authEpoch
    && retained.epoch === snapshot.epoch
    && (!snapshot.athleteKey || retained.athleteKey === snapshot.athleteKey);
}

function authEpochIsCurrent(snapshot: RuntimeSnapshot): boolean {
  return !props.app.state.authRequired && props.app.state.authEpoch === snapshot.authEpoch;
}

function setAgentToken(token: string | null): void {
  agentAccessToken.value = token;
}

function releasePendingAgentToken(): void {
  const pending = retained.pendingAgentToken;
  if (!instanceActive || !pending || !verifiedAthleteKey.value || authUnavailable.value) return;
  if (pending.athleteKey !== verifiedAthleteKey.value
    || pending.authEpoch !== props.app.state.authEpoch
    || pending.authEpoch !== retained.authEpoch
    || pending.runtimeEpoch !== retained.epoch
    || pending.athleteKey !== retained.athleteKey) return;
  retained.pendingAgentToken = null;
  retained.agentToken = pending.token;
  agentAccess.value = {
    active: true,
    created_at: pending.createdAt,
    rotated_at: pending.rotatedAt,
    revoked_at: null,
  };
  agentAccessStatus.value = "ready";
  props.app.setMessage(pending.message);
}

function applyProfileSnapshot(result: RetainedProfileState): void {
  if (!instanceActive
    || verifiedAthleteKey.value !== result.athlete_key
    || props.app.state.authRequired
    || retained.authEpoch !== props.app.state.authEpoch
    || retained.athleteKey !== result.athlete_key) return;
  profileStatus.value = "ready";
  if (!profileDirty.value) {
    displayName.value = result.display_name || "";
    timezone.value = result.timezone || props.app.state.today?.timezone || "Asia/Shanghai";
  }
}

function clearPlanValidation(): void {
  preview.value = null;
  planEditorMode.value = null;
  planEvidence.value = null;
  validatedDraft.value = null;
  planError.value = null;
}

function invalidatePlanValidation(): void {
  retained.planRequestGeneration += 1;
  planPending.value = false;
  clearPlanValidation();
}

function resetLocalAuthState(authRequired: boolean): void {
  shareLoadGeneration += 1;
  agentAccessLoadGeneration += 1;
  verifiedAthleteKey.value = null;
  transientDraft.value = "";
  transientAgentToken.value = null;
  displayName.value = "";
  timezone.value = props.app.state.today?.timezone ?? "Asia/Shanghai";
  profileDirty.value = false;
  profileStatus.value = authRequired ? "error" : "loading";
  share.value = null;
  shareStatus.value = authRequired ? "error" : "loading";
  agentAccess.value = null;
  agentAccessStatus.value = authRequired ? "error" : "loading";
  sheetOpen.value = false;
  clearPlanValidation();
}

function openPlanSheet(): void {
  if (planPending.value || authUnavailable.value || profileStatus.value !== "ready") return;
  retained.planRequestGeneration += 1;
  sheetOpen.value = true;
  clearPlanValidation();
  props.app.clearError();
}

function closePlanSheet(force = false): void {
  if (planPending.value && !force) return;
  retained.planRequestGeneration += 1;
  planPending.value = false;
  sheetOpen.value = false;
  clearPlanValidation();
}

async function loadProfile(): Promise<void> {
  const generation = ++retained.profileLoadGeneration;
  const authEpoch = props.app.state.authEpoch;
  profileStatus.value = "loading";
  try {
    const result = await props.app.api.request<RetainedProfileState>("/api/private/me");
    if (!instanceActive
      || generation !== retained.profileLoadGeneration
      || props.app.state.authEpoch !== authEpoch
      || props.app.state.authRequired) return;
    const athleteKey = typeof result.athlete_key === "string" && result.athlete_key.trim()
      ? result.athlete_key
      : null;
    if (!athleteKey) {
      clearRetainedState(retained);
      verifiedAthleteKey.value = null;
      profile.value = null;
      profileStatus.value = "error";
      return;
    }
    syncRetainedStateToAuthEpoch(retained, authEpoch);
    bindRetainedStateToAthlete(retained, athleteKey);
    verifiedAthleteKey.value = athleteKey;
    profile.value = result;
    applyProfileSnapshot(result);
  } catch {
    if (instanceActive
      && generation === retained.profileLoadGeneration
      && props.app.state.authEpoch === authEpoch
      && !props.app.state.authRequired) profileStatus.value = "error";
  }
}

async function loadShare(): Promise<boolean> {
  const runtime = runtimeSnapshot();
  if (!runtime.athleteKey || !runtimeIsCurrent(runtime)) return false;
  const generation = ++shareLoadGeneration;
  shareStatus.value = "loading";
  try {
    const result = await props.app.api.request<ShareState>("/api/private/coach-share");
    if (generation !== shareLoadGeneration || !runtimeIsCurrent(runtime)) return false;
    share.value = result;
    shareStatus.value = "ready";
    return true;
  } catch {
    if (generation === shareLoadGeneration && runtimeIsCurrent(runtime)) {
      share.value = null;
      shareStatus.value = "error";
    }
    return false;
  }
}

async function loadAgentAccess(): Promise<boolean> {
  const runtime = runtimeSnapshot();
  if (!runtime.athleteKey || !runtimeIsCurrent(runtime)) return false;
  const generation = ++agentAccessLoadGeneration;
  agentAccessStatus.value = "loading";
  try {
    const result = await props.app.api.request<AgentAccessState>("/api/private/agent-access");
    if (generation !== agentAccessLoadGeneration || !runtimeIsCurrent(runtime)) return false;
    agentAccess.value = result;
    agentAccessStatus.value = "ready";
    return true;
  } catch {
    if (generation === agentAccessLoadGeneration && runtimeIsCurrent(runtime)) {
      agentAccess.value = null;
      agentAccessStatus.value = "error";
    }
    return false;
  }
}

async function initializeSettings(): Promise<void> {
  await loadProfile();
  if (profileStatus.value !== "ready") {
    shareStatus.value = "error";
    agentAccessStatus.value = "error";
    return;
  }
  await Promise.all([loadShare(), loadAgentAccess()]);
}

async function saveProfile(): Promise<void> {
  if (profilePending.value || authUnavailable.value || profileStatus.value !== "ready") return;
  retained.profileLoadGeneration += 1;
  const generation = ++retained.profileMutationGeneration;
  const runtime = runtimeSnapshot();
  profilePending.value = true;
  props.app.clearError();
  try {
    const result = await props.app.api.request<ProfileSettings>("/api/private/settings", {
      method: "PUT",
      body: JSON.stringify({
        display_name: displayName.value,
        timezone: timezone.value,
      }),
    });
    if (generation === retained.profileMutationGeneration && runtimeIdentityIsCurrent(runtime)) {
      const athleteKey = profile.value?.athlete_key ?? runtime.athleteKey;
      if (athleteKey) profile.value = { athlete_key: athleteKey, ...result };
      if (runtimeIsCurrent(runtime)) {
        displayName.value = result.display_name;
        timezone.value = result.timezone;
        profileDirty.value = false;
        props.app.setMessage("设置已保存");
      }
    }
    if (authEpochIsCurrent(runtime)) await props.app.refresh();
  } catch (error) {
    if (generation === retained.profileMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.profileMutationGeneration) profilePending.value = false;
  }
}

async function copyCurrentPlan(): Promise<void> {
  if (planPending.value || authUnavailable.value || profileStatus.value !== "ready") return;
  const generation = ++retained.planRequestGeneration;
  const runtime = runtimeSnapshot();
  planPending.value = true;
  props.app.clearError();
  try {
    const packageValue = await props.app.api.request<JsonRecord>("/api/private/plan/update-package");
    if (generation !== retained.planRequestGeneration || !runtimeIsCurrent(runtime)) return;
    draft.value = JSON.stringify(packageValue, null, 2);
    sheetOpen.value = true;
    clearPlanValidation();
    const copied = await copyText(draft.value);
    if (generation !== retained.planRequestGeneration || !runtimeIsCurrent(runtime)) return;
    props.app.setMessage(copied
      ? "当前计划 JSON 已复制，请修改 effective_from 或内容后检查"
      : "当前计划 JSON 已准备好，请从编辑框复制后修改 effective_from 或内容");
  } catch (error) {
    if (generation === retained.planRequestGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.planRequestGeneration) planPending.value = false;
  }
}

async function validatePlan(): Promise<void> {
  if (planPending.value || authUnavailable.value) return;
  const candidateDraft = draft.value;
  const generation = ++retained.planRequestGeneration;
  const runtime = runtimeSnapshot();
  planPending.value = true;
  props.app.clearError();
  try {
    const parsed: unknown = JSON.parse(candidateDraft);
    const isBatch = isRecord(parsed) && Array.isArray(parsed.updates);
    const path = isBatch
      ? "/api/private/plan-update-batches/validate"
      : "/api/private/plan-updates/validate";
    const body = isBatch
      ? { batch_text: candidateDraft }
      : { package_text: candidateDraft };
    const result = await props.app.api.request<PlanValidationResponse>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (generation !== retained.planRequestGeneration
      || !runtimeIsCurrent(runtime)
      || draft.value !== candidateDraft) return;
    if (isBatch
      && (typeof result.batch_digest !== "string" || typeof result.base_plan_digest !== "string")) {
      throw new Error("批量计划缺少已验证证据，请重新检查");
    }

    preview.value = result.preview;
    planEditorMode.value = isBatch ? "batch" : "single";
    validatedDraft.value = candidateDraft;
    planEvidence.value = isBatch
      ? {
          batch_digest: result.batch_digest as string,
          base_plan_digest: result.base_plan_digest as string,
        }
      : null;
    planError.value = null;
  } catch (error) {
    if (generation !== retained.planRequestGeneration
      || !runtimeIsCurrent(runtime)
      || draft.value !== candidateDraft) return;
    preview.value = null;
    planEvidence.value = null;
    planEditorMode.value = null;
    validatedDraft.value = null;
    planError.value = planValidationMessage(error);
    props.app.clearError();
  } finally {
    if (generation === retained.planRequestGeneration) planPending.value = false;
  }
}

async function confirmPlan(): Promise<void> {
  if (planPending.value || authUnavailable.value || !preview.value || !planEditorMode.value) return;
  const approvedDraft = validatedDraft.value;
  if (!approvedDraft || draft.value !== approvedDraft) {
    clearPlanValidation();
    planError.value = "计划内容已更改，请重新检查";
    return;
  }
  const generation = ++retained.planRequestGeneration;
  const runtime = runtimeSnapshot();
  planPending.value = true;
  props.app.clearError();
  try {
    if (planEditorMode.value === "batch") {
      if (!planEvidence.value) throw new Error("批量计划缺少已验证证据，请重新检查");
      await props.app.api.request("/api/private/plan-update-batches/apply", {
        method: "POST",
        headers: { "Idempotency-Key": props.app.api.idempotencyKey() },
        body: JSON.stringify({
          batch_text: approvedDraft,
          batch_digest: planEvidence.value.batch_digest,
          base_plan_digest: planEvidence.value.base_plan_digest,
          confirmed: true,
        }),
      });
    } else {
      await props.app.api.request("/api/private/plan-updates/apply", {
        method: "POST",
        headers: { "Idempotency-Key": props.app.api.idempotencyKey() },
        body: JSON.stringify({ package_text: approvedDraft }),
      });
    }
    if (generation === retained.planRequestGeneration && runtimeIsCurrent(runtime)) {
      closePlanSheet(true);
    }
    if (authEpochIsCurrent(runtime)) await props.app.refresh();
  } catch (error) {
    if (generation === retained.planRequestGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.planRequestGeneration) planPending.value = false;
  }
}

async function copyPlanError(): Promise<void> {
  await copyText(planError.value || "计划需要修正");
}

async function copyShare(message: string): Promise<void> {
  const runtime = runtimeSnapshot();
  const copied = await copyText(share.value?.url ?? "");
  if (runtimeIsCurrent(runtime)) {
    props.app.setMessage(copied ? message : "分享链接已准备好，请复制下方链接");
  }
}

async function createShare(): Promise<void> {
  if (sharePending.value
    || authUnavailable.value
    || profileStatus.value !== "ready"
    || shareStatus.value !== "ready"
    || share.value?.active) return;
  const generation = ++retained.shareMutationGeneration;
  const runtime = runtimeSnapshot();
  sharePending.value = true;
  props.app.clearError();
  try {
    await props.app.api.request("/api/private/coach-share", {
      method: "POST",
      headers: { "Idempotency-Key": props.app.api.idempotencyKey() },
      body: JSON.stringify({}),
    });
    if (generation !== retained.shareMutationGeneration || !runtimeIsCurrent(runtime)) return;
    const loaded = await loadShare();
    if (generation !== retained.shareMutationGeneration || !runtimeIsCurrent(runtime)) return;
    if (loaded) await copyShare("分享链接已创建并复制");
    else props.app.setMessage("分享已创建，请重新读取分享状态");
  } catch (error) {
    if (generation === retained.shareMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.shareMutationGeneration) sharePending.value = false;
  }
}

async function regenerateShare(): Promise<void> {
  if (sharePending.value
    || authUnavailable.value
    || profileStatus.value !== "ready"
    || shareStatus.value !== "ready"
    || !share.value?.active) return;
  const generation = ++retained.shareMutationGeneration;
  const runtime = runtimeSnapshot();
  sharePending.value = true;
  props.app.clearError();
  try {
    await props.app.api.request("/api/private/coach-share/regenerate", {
      method: "POST",
      headers: { "Idempotency-Key": props.app.api.idempotencyKey() },
      body: JSON.stringify({}),
    });
    if (generation !== retained.shareMutationGeneration || !runtimeIsCurrent(runtime)) return;
    const loaded = await loadShare();
    if (generation !== retained.shareMutationGeneration || !runtimeIsCurrent(runtime)) return;
    if (loaded) await copyShare("分享链接已重新生成并复制");
    else props.app.setMessage("分享链接已重新生成，请重新读取分享状态");
  } catch (error) {
    if (generation === retained.shareMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.shareMutationGeneration) sharePending.value = false;
  }
}

async function revokeShare(): Promise<void> {
  if (sharePending.value
    || authUnavailable.value
    || profileStatus.value !== "ready"
    || shareStatus.value !== "ready"
    || !share.value?.active) return;
  const generation = ++retained.shareMutationGeneration;
  const runtime = runtimeSnapshot();
  sharePending.value = true;
  props.app.clearError();
  try {
    await props.app.api.request("/api/private/coach-share", { method: "DELETE" });
    if (generation !== retained.shareMutationGeneration || !runtimeIsCurrent(runtime)) return;
    share.value = { active: false, share_key: null, url: null };
    shareStatus.value = "ready";
    props.app.setMessage("分享已撤销");
  } catch (error) {
    if (generation === retained.shareMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.shareMutationGeneration) sharePending.value = false;
  }
}

async function issueAgentToken(rotating: boolean): Promise<void> {
  if (agentAccessPending.value
    || authUnavailable.value
    || profileStatus.value !== "ready"
    || agentAccessStatus.value !== "ready") return;
  if (rotating !== agentAccessActive.value) return;
  const generation = ++retained.agentAccessMutationGeneration;
  const runtime = runtimeSnapshot();
  agentAccessPending.value = true;
  props.app.clearError();
  try {
    const result = await props.app.api.request<AgentTokenResponse>("/api/private/agent-access", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (generation !== retained.agentAccessMutationGeneration || !runtimeIdentityIsCurrent(runtime)) return;
    retained.pendingAgentToken = {
      athleteKey: runtime.athleteKey as string,
      authEpoch: runtime.authEpoch,
      runtimeEpoch: runtime.epoch,
      token: result.token,
      createdAt: result.created_at,
      rotatedAt: result.rotated_at,
      message: rotating
        ? "Agent Token 已重新生成，旧 Token 已失效"
        : "Agent Token 已创建，请立即保存",
    };
  } catch (error) {
    if (generation === retained.agentAccessMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.agentAccessMutationGeneration) agentAccessPending.value = false;
  }
}

async function revokeAgentToken(): Promise<void> {
  if (agentAccessPending.value
    || authUnavailable.value
    || profileStatus.value !== "ready"
    || agentAccessStatus.value !== "ready"
    || !agentAccessActive.value) return;
  const generation = ++retained.agentAccessMutationGeneration;
  const runtime = runtimeSnapshot();
  agentAccessPending.value = true;
  props.app.clearError();
  try {
    const result = await props.app.api.request<AgentRevokeResponse>("/api/private/agent-access", {
      method: "DELETE",
    });
    if (generation !== retained.agentAccessMutationGeneration || !runtimeIdentityIsCurrent(runtime)) return;
    retained.pendingAgentToken = null;
    retained.agentToken = null;
    if (!runtimeIsCurrent(runtime)) return;
    agentAccess.value = {
      active: false,
      created_at: agentAccess.value?.created_at ?? null,
      rotated_at: agentAccess.value?.rotated_at ?? null,
      revoked_at: new Date().toISOString(),
    };
    agentAccessStatus.value = "ready";
    props.app.setMessage(result.revoked ? "Agent Token 已撤销" : "没有启用的 Agent Token");
  } catch (error) {
    if (generation === retained.agentAccessMutationGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.agentAccessMutationGeneration) agentAccessPending.value = false;
  }
}

async function copyAgentToken(): Promise<void> {
  const runtime = runtimeSnapshot();
  const copied = await copyText(agentAccessToken.value ?? "");
  if (runtimeIsCurrent(runtime)) {
    props.app.setMessage(copied
      ? "Agent Token 已复制，请妥善保存"
      : "请复制上方显示的 Agent Token");
  }
}

async function exportTrainingData(): Promise<void> {
  if (exportPending.value || authUnavailable.value || profileStatus.value !== "ready") return;
  const generation = ++retained.exportGeneration;
  const runtime = runtimeSnapshot();
  exportPending.value = true;
  props.app.clearError();
  try {
    const response = await props.app.api.response("/api/private/export");
    if (!runtimeIsCurrent(runtime)) return;

    const blob = await response.blob();
    if (!runtimeIsCurrent(runtime)) return;
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = exportFilename(response.headers.get("Content-Disposition"));
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  } catch (error) {
    if (generation === retained.exportGeneration && runtimeIsCurrent(runtime)) props.app.setError(error);
  } finally {
    if (generation === retained.exportGeneration && runtimeIdentityIsCurrent(runtime)) {
      exportPending.value = false;
    }
  }
}

async function logout(): Promise<void> {
  if (anySettingsPending.value) return;
  logoutPending.value = true;
  retained.profileLoadGeneration += 1;
  shareLoadGeneration += 1;
  agentAccessLoadGeneration += 1;
  props.app.clearError();
  let operationAuthEpoch = props.app.state.authEpoch;
  try {
    const operation = props.app.logout();
    operationAuthEpoch = props.app.state.authEpoch;
    await operation;
  } catch (error) {
    if (props.app.state.authEpoch === operationAuthEpoch && !props.app.state.authRequired) {
      props.app.setError(error);
    }
  } finally {
    if (props.app.state.authEpoch === operationAuthEpoch) logoutPending.value = false;
  }
}

onMounted(async () => {
  await initializeSettings();
});

onBeforeUnmount(() => {
  instanceActive = false;
  shareLoadGeneration += 1;
  agentAccessLoadGeneration += 1;
});

watch(sharePending, (pending, wasPending) => {
  if (wasPending && !pending && profileStatus.value === "ready") void loadShare();
});

watch(agentAccessPending, (pending, wasPending) => {
  if (wasPending && !pending && profileStatus.value === "ready") void loadAgentAccess();
});

watch(profilePending, (pending, wasPending) => {
  if (wasPending && !pending && !authUnavailable.value) void loadProfile();
});

watch(
  [() => retained.pendingAgentToken, verifiedAthleteKey],
  () => releasePendingAgentToken(),
  { flush: "sync" },
);

watch(
  profile,
  (result) => {
    if (result) applyProfileSnapshot(result);
  },
  { flush: "sync" },
);

watch(
  () => [props.app.state.authEpoch, props.app.state.authRequired] as const,
  ([authEpoch, authRequired], [previousEpoch, previousAuthRequired]) => {
    const epochChanged = authEpoch !== previousEpoch;
    if (epochChanged) {
      syncRetainedStateToAuthEpoch(retained, authEpoch);
    } else if (authRequired && !previousAuthRequired) {
      clearRetainedState(retained);
    }
    resetLocalAuthState(authRequired);
    if (previousAuthRequired && !authRequired && !logoutPending.value) void initializeSettings();
  },
  { flush: "sync" },
);
</script>

<template>
  <section class="page-head">
    <p class="eyebrow">SETTINGS</p>
    <h1>设置</h1>
    <p class="muted">管理你的个人信息、计划和分享。</p>
  </section>

  <form
    class="settings-form"
    @submit.prevent="saveProfile"
  >
    <label>
      显示名称
      <input
        v-model="displayName"
        name="display_name"
        maxlength="50"
        :disabled="profilePending"
        @input="profileDirty = true"
      />
    </label>
    <label>
      Timezone
      <input
        v-model="timezone"
        name="timezone"
        :disabled="profilePending"
        @input="profileDirty = true"
      />
    </label>
    <div
      v-if="profileStatus === 'loading'"
      class="muted"
      role="status"
    >
      正在读取个人信息…
    </div>
    <div
      v-else-if="profileStatus === 'error'"
      class="validation-error"
      role="alert"
    >
      <p>个人信息暂时无法读取。读取成功前不会保存覆盖。</p>
      <button
        class="secondary"
        type="button"
        @click="initializeSettings"
      >
        重新读取个人信息
      </button>
    </div>
    <button
      class="primary wide"
      type="submit"
      :disabled="profileStatus !== 'ready' || profilePending || authUnavailable"
      :aria-busy="profilePending"
    >
      {{ profilePending ? "正在保存…" : "保存设置" }}
    </button>
  </form>

  <section class="quiet-card">
    <h2>计划</h2>
    <p>一次检查并原子化应用未来 2–4 周；每周仍保存为独立、不可变的 Plan Revision。</p>
    <div class="hero-actions">
      <button
        class="primary"
        type="button"
        :disabled="planPending || authUnavailable || profileStatus !== 'ready'"
        @click="openPlanSheet"
      >
        编排未来计划
      </button>
      <button
        v-if="currentPlan"
        class="secondary"
        type="button"
        :disabled="planPending || authUnavailable || profileStatus !== 'ready'"
        @click="copyCurrentPlan"
      >
        复制当前单周 JSON
      </button>
    </div>
  </section>

  <section
    v-if="futurePlans.length"
    class="future-plan"
  >
    <div class="future-plan-head">
      <div>
        <p class="eyebrow">FUTURE REVISIONS</p>
        <h2>未来计划时间线</h2>
      </div>
      <span>{{ futurePlans.length }} 周</span>
    </div>
    <details
      v-for="(revision, index) in futurePlans"
      :key="String(revision.revision_key ?? revision.effective_from ?? index)"
      class="future-week"
      :open="index === 0"
    >
      <summary>
        <span>第 {{ index + 1 }} 周</span>
        <strong>{{ revision.effective_from }} 生效</strong>
      </summary>
      <div class="future-week-body">
        <PlanWeekRows :week="planWeek(revision.week)" />
      </div>
    </details>
  </section>
  <section
    v-else
    class="pending-card"
  >
    <strong>没有待生效更新</strong>
    <p>可以在设置中一次编排未来 2–4 周。</p>
  </section>

  <section class="quiet-card">
    <h2>Agent access</h2>
    <p
      v-if="agentAccessStatus === 'loading'"
      role="status"
    >
      正在读取 Agent access 状态…
    </p>
    <div
      v-else-if="agentAccessStatus === 'error'"
      class="validation-error"
      role="alert"
    >
      <p>Agent access 状态暂时无法读取。读取成功前不会创建、重新生成或撤销 Token。</p>
      <button
        class="secondary"
        type="button"
        @click="loadAgentAccess"
      >
        重新读取 Agent access
      </button>
    </div>
    <p v-else-if="agentAccessActive">
      Agent API 访问已启用。Token 只在创建或重新生成后显示一次。
    </p>
    <p v-else-if="agentAccessStatus === 'ready'">
      为训练数据 Agent API 创建一个可撤销的访问 Token。
    </p>
    <template v-if="agentAccessToken">
      <label>
        本次 Token（请立即保存）
        <input
          aria-label="本次 Agent Token"
          readonly
          :value="agentAccessToken"
        />
      </label>
      <p class="muted">出于安全考虑，之后的状态读取不会再次返回完整 Token。</p>
    </template>
    <div
      v-if="agentAccessStatus === 'ready'"
      class="hero-actions"
    >
      <template v-if="agentAccessActive">
        <button
          class="secondary"
          type="button"
          :disabled="agentAccessPending || authUnavailable || profileStatus !== 'ready'"
          @click="issueAgentToken(true)"
        >
          重新生成 Token
        </button>
        <button
          class="secondary"
          type="button"
          :disabled="agentAccessPending || authUnavailable || profileStatus !== 'ready'"
          @click="revokeAgentToken"
        >
          撤销 Token
        </button>
      </template>
      <button
        v-else
        class="primary"
        type="button"
        :disabled="agentAccessPending || authUnavailable || profileStatus !== 'ready'"
        @click="issueAgentToken(false)"
      >
        创建 Token
      </button>
      <button
        v-if="agentAccessToken"
        class="secondary"
        type="button"
        :disabled="agentAccessPending || authUnavailable || profileStatus !== 'ready'"
        @click="copyAgentToken"
      >
        复制 Token
      </button>
    </div>
  </section>

  <section class="quiet-card">
    <h2>分享</h2>
    <p
      v-if="shareStatus === 'loading'"
      role="status"
    >
      正在读取分享状态…
    </p>
    <div
      v-else-if="shareStatus === 'error'"
      class="validation-error"
      role="alert"
    >
      <p>分享状态暂时无法读取。读取成功前不会创建、重新生成或撤销链接。</p>
      <button
        class="secondary"
        type="button"
        @click="loadShare"
      >
        重新读取分享状态
      </button>
    </div>
    <p v-else-if="share?.active">
      分享链接已启用，可复制、重新生成或撤销。
    </p>
    <p v-else-if="shareStatus === 'ready'">
      创建一个永久只读分享链接。
    </p>
    <label v-if="shareStatus === 'ready' && share?.active">
      分享链接
      <input
        aria-label="分享链接"
        readonly
        :value="share.url ?? ''"
      />
    </label>
    <div class="hero-actions">
      <template v-if="share?.active">
        <button
          class="primary"
          type="button"
          :disabled="sharePending || authUnavailable || shareStatus !== 'ready' || profileStatus !== 'ready'"
          @click="copyShare('分享链接已复制')"
        >
          复制分享链接
        </button>
        <button
          class="secondary"
          type="button"
          :disabled="sharePending || authUnavailable || shareStatus !== 'ready' || profileStatus !== 'ready'"
          @click="regenerateShare"
        >
          重新生成
        </button>
        <button
          class="secondary"
          type="button"
          :disabled="sharePending || authUnavailable || shareStatus !== 'ready' || profileStatus !== 'ready'"
          @click="revokeShare"
        >
          撤销分享
        </button>
      </template>
      <button
        v-else-if="shareStatus === 'ready'"
        class="primary"
        type="button"
        :disabled="sharePending || authUnavailable || profileStatus !== 'ready'"
        @click="createShare"
      >
        创建分享
      </button>
      <button
        class="secondary"
        type="button"
        :disabled="exportPending || authUnavailable || profileStatus !== 'ready'"
        :aria-busy="exportPending"
        @click="exportTrainingData"
      >
        {{ exportPending ? "正在准备下载…" : "下载训练数据" }}
      </button>
    </div>
  </section>

  <button
    class="secondary wide"
    type="button"
    :disabled="anySettingsPending"
    @click="logout"
  >
    {{ logoutPending ? "正在退出…" : "退出登录" }}
  </button>

  <div
    v-if="sheetOpen"
    class="modal-backdrop"
    @click.self="!planPending && closePlanSheet()"
  >
    <section
      class="bottom-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="preview ? previewHeading : (planError ? '计划需要修正' : '编排未来计划')"
    >
      <div class="sheet-handle" />

      <template v-if="preview">
        <h2>{{ previewHeading }}</h2>
        <p class="muted">{{ previewMeta }}</p>
        <div
          v-if="isBatchPreview"
          class="batch-preview"
        >
          <details
            v-for="(update, index) in batchPreviewUpdates"
            :key="String(update.effective_from ?? index)"
            class="future-week"
            :open="index === 0"
          >
            <summary>
              <span>第 {{ index + 1 }} 周</span>
              <strong>{{ update.effective_from }} · 变更 {{ update.changed_weekday_slot_count }} 天</strong>
            </summary>
            <div class="future-week-body">
              <PlanWeekRows :week="planWeek(update.week)" />
            </div>
          </details>
        </div>
        <div
          v-else
          class="preview-week"
        >
          <PlanWeekRows :week="planWeek(preview.week)" />
        </div>
        <div class="sheet-actions">
          <button
            class="secondary"
            type="button"
            :disabled="planPending"
            @click="closePlanSheet()"
          >
            取消
          </button>
          <button
            class="primary"
            type="button"
            :disabled="planPending"
            :aria-busy="planPending"
            @click="confirmPlan"
          >
            确认应用
          </button>
        </div>
      </template>

      <template v-else>
        <h2>{{ planError ? "计划需要修正" : "编排未来计划" }}</h2>
        <p class="muted">
          支持单个 Plan Update Package，或包含 2–4 个连续周一的 Plan Update Batch。检查不会写入；确认后批量更新会原子化应用。
        </p>
        <textarea
          id="plan-json"
          v-model="draft"
          placeholder='{"schema_version":1,"updates":[{"schema_version":2,"effective_from":"2026-08-24","week":{...}}]}'
          @input="invalidatePlanValidation"
        />
        <div
          v-if="planError"
          class="validation-error"
        >
          <strong>计划无法更新</strong>
          <p>
            <template
              v-for="(line, index) in planErrorLines"
              :key="`${index}-${line}`"
            >
              {{ line }}<br v-if="index < planErrorLines.length - 1" />
            </template>
          </p>
          <button
            class="secondary"
            type="button"
            @click="copyPlanError"
          >
            复制错误详情
          </button>
        </div>
        <div class="sheet-actions">
          <button
            class="secondary"
            type="button"
            :disabled="planPending"
            @click="closePlanSheet()"
          >
            取消
          </button>
          <button
            class="primary"
            type="button"
            :disabled="planPending"
            :aria-busy="planPending"
            @click="validatePlan"
          >
            检查计划
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
