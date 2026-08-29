export type JsonRecord = Record<string, unknown>;
export type WorkoutView = "today" | "calendar" | "progress" | "settings";

export interface ApiErrorDetail {
  path?: string;
  message?: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
}

export interface ApiClient {
  request<T = JsonRecord>(path: string, options?: RequestInit): Promise<T>;
  response(path: string, options?: RequestInit): Promise<Response>;
  idempotencyKey(): string;
}

export interface TodayState extends JsonRecord {
  date: string;
  timezone: string;
  entry: JsonRecord | null;
  session: JsonRecord | null;
}

export interface PlanState extends JsonRecord {
  timezone: string;
  first_effective_from: string | null;
  current: JsonRecord | null;
  future: JsonRecord[];
}

export interface AppCoreState {
  view: WorkoutView;
  authEpoch: number;
  loading: boolean;
  authRequired: boolean;
  authMessage: string;
  error: string | null;
  message: string;
  today: TodayState | null;
  plan: PlanState | null;
  progress: JsonRecord | null;
  session: JsonRecord | null;
}

export interface WorkoutAppStore {
  state: AppCoreState;
  api: ApiClient;
  bootstrap(): Promise<void>;
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  setMessage(message: string): void;
  setError(error: unknown): void;
  clearError(): void;
}

export interface TodayPageHandle {
  ensurePaused(reason?: string): Promise<boolean>;
  readonly executionFocused?: boolean;
}

export interface RecordsPageHandle {
  showAerobicDate(date: string): Promise<void>;
}
