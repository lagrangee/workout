import { reactive } from "vue";

import type { WorkoutAppStore } from "../../core/contracts";

export interface RetainedProfileState {
  athlete_key: string;
  display_name: string;
  timezone: string;
}

export interface PendingAgentToken {
  athleteKey: string;
  authEpoch: number;
  runtimeEpoch: number;
  token: string;
  createdAt: string | null;
  rotatedAt: string | null;
  message: string;
}

export interface RetainedSettingsState {
  authEpoch: number;
  athleteKey: string | null;
  profile: RetainedProfileState | null;
  draft: string;
  agentToken: string | null;
  pendingAgentToken: PendingAgentToken | null;
  epoch: number;
  profileLoadGeneration: number;
  profileMutationGeneration: number;
  shareMutationGeneration: number;
  agentAccessMutationGeneration: number;
  planRequestGeneration: number;
  exportGeneration: number;
  profilePending: boolean;
  sharePending: boolean;
  agentAccessPending: boolean;
  planPending: boolean;
  exportPending: boolean;
  logoutPending: boolean;
}

const retainedSettings = new WeakMap<WorkoutAppStore, RetainedSettingsState>();

export function retainedStateFor(app: WorkoutAppStore): RetainedSettingsState {
  const existing = retainedSettings.get(app);
  if (existing) {
    syncRetainedStateToAuthEpoch(existing, app.state.authEpoch);
    if (app.state.authRequired && existing.athleteKey) clearRetainedState(existing);
    return existing;
  }
  const state = reactive<RetainedSettingsState>({
    authEpoch: app.state.authEpoch,
    athleteKey: null,
    profile: null,
    draft: "",
    agentToken: null,
    pendingAgentToken: null,
    epoch: 0,
    profileLoadGeneration: 0,
    profileMutationGeneration: 0,
    shareMutationGeneration: 0,
    agentAccessMutationGeneration: 0,
    planRequestGeneration: 0,
    exportGeneration: 0,
    profilePending: false,
    sharePending: false,
    agentAccessPending: false,
    planPending: false,
    exportPending: false,
    logoutPending: false,
  });
  retainedSettings.set(app, state);
  return state;
}

function invalidateOperations(state: RetainedSettingsState): void {
  state.profileLoadGeneration += 1;
  state.profileMutationGeneration += 1;
  state.shareMutationGeneration += 1;
  state.agentAccessMutationGeneration += 1;
  state.planRequestGeneration += 1;
  state.exportGeneration += 1;
  state.profilePending = false;
  state.sharePending = false;
  state.agentAccessPending = false;
  state.planPending = false;
  state.exportPending = false;
}

export function bindRetainedStateToAthlete(
  state: RetainedSettingsState,
  athleteKey: string,
): void {
  if (state.athleteKey === athleteKey) return;
  state.epoch += 1;
  invalidateOperations(state);
  state.athleteKey = athleteKey;
  state.profile = null;
  state.draft = "";
  state.agentToken = null;
  state.pendingAgentToken = null;
}

export function syncRetainedStateToAuthEpoch(
  state: RetainedSettingsState,
  authEpoch: number,
): void {
  if (state.authEpoch === authEpoch) return;
  state.authEpoch = authEpoch;
  clearRetainedState(state);
}

export function clearRetainedState(state: RetainedSettingsState): void {
  state.epoch += 1;
  invalidateOperations(state);
  state.athleteKey = null;
  state.profile = null;
  state.draft = "";
  state.agentToken = null;
  state.pendingAgentToken = null;
}
