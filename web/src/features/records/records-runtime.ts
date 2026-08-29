import { ref, type Ref } from "vue";
import type { WorkoutAppStore } from "../../core/contracts";
import { asProgressResponse } from "./records-types";
import type {
  AerobicDetailResponse,
  AerobicListResponse,
  ExerciseDetailResponse,
  ProgressRange,
  ProgressResponse,
  RecordsOverviewResponse,
  RecordsTab,
  RouteDetailResponse,
  RouteOrigin,
  RoutesListResponse,
} from "./records-types";

export type AerobicErrorContext = "list" | "detail" | "routes" | "route-detail";

export interface RecordsRuntime {
  contextToken: number;
  activeTab: Ref<RecordsTab>;
  overview: Ref<RecordsOverviewResponse | null>;
  overviewLoading: Ref<boolean>;
  overviewError: Ref<string | null>;
  progressRange: Ref<ProgressRange>;
  progress: Ref<ProgressResponse | null>;
  progressLoading: Ref<boolean>;
  progressError: Ref<string | null>;
  exerciseDetail: Ref<ExerciseDetailResponse | null>;
  exerciseLoading: Ref<boolean>;
  aerobicList: Ref<AerobicListResponse | null>;
  aerobicDetail: Ref<AerobicDetailResponse | null>;
  aerobicListLoading: Ref<boolean>;
  aerobicDetailLoading: Ref<boolean>;
  aerobicError: Ref<string | null>;
  aerobicErrorContext: Ref<AerobicErrorContext>;
  selectedActivityRef: Ref<string | null>;
  monthFilter: Ref<string>;
  sportTypeFilter: Ref<string>;
  dateFrom: Ref<string | null>;
  dateTo: Ref<string | null>;
  routes: Ref<RoutesListResponse | null>;
  routesOpen: Ref<boolean>;
  routesLoading: Ref<boolean>;
  routeDetail: Ref<RouteDetailResponse | null>;
  routeDetailLoading: Ref<boolean>;
  routeOrigin: Ref<RouteOrigin | null>;
  selectedRouteKey: Ref<string | null>;
  requests: {
    overview: number;
    progress: number;
    exercise: number;
    aerobicList: number;
    aerobicDetail: number;
    routes: number;
    routeDetail: number;
  };
}

const runtimes = new WeakMap<WorkoutAppStore, RecordsRuntime>();

function createRecordsRuntime(app: WorkoutAppStore): RecordsRuntime {
  return {
    contextToken: app.state.authEpoch,
    activeTab: ref<RecordsTab>("overview"),
    overview: ref<RecordsOverviewResponse | null>(null),
    overviewLoading: ref(false),
    overviewError: ref<string | null>(null),
    progressRange: ref<ProgressRange>("current"),
    progress: ref<ProgressResponse | null>(asProgressResponse(app.state.progress)),
    progressLoading: ref(false),
    progressError: ref<string | null>(null),
    exerciseDetail: ref<ExerciseDetailResponse | null>(null),
    exerciseLoading: ref(false),
    aerobicList: ref<AerobicListResponse | null>(null),
    aerobicDetail: ref<AerobicDetailResponse | null>(null),
    aerobicListLoading: ref(false),
    aerobicDetailLoading: ref(false),
    aerobicError: ref<string | null>(null),
    aerobicErrorContext: ref<AerobicErrorContext>("list"),
    selectedActivityRef: ref<string | null>(null),
    monthFilter: ref("all"),
    sportTypeFilter: ref("all"),
    dateFrom: ref<string | null>(null),
    dateTo: ref<string | null>(null),
    routes: ref<RoutesListResponse | null>(null),
    routesOpen: ref(false),
    routesLoading: ref(false),
    routeDetail: ref<RouteDetailResponse | null>(null),
    routeDetailLoading: ref(false),
    routeOrigin: ref<RouteOrigin | null>(null),
    selectedRouteKey: ref<string | null>(null),
    requests: {
      overview: 0,
      progress: 0,
      exercise: 0,
      aerobicList: 0,
      aerobicDetail: 0,
      routes: 0,
      routeDetail: 0,
    },
  };
}

export function getRecordsRuntime(app: WorkoutAppStore): RecordsRuntime {
  const current = runtimes.get(app);
  if (current && current.contextToken === app.state.authEpoch) return current;
  const runtime = createRecordsRuntime(app);
  runtimes.set(app, runtime);
  return runtime;
}

export function resetRecordsRuntime(runtime: RecordsRuntime, app: WorkoutAppStore): void {
  runtime.contextToken = app.state.authEpoch;
  runtime.activeTab.value = "overview";
  runtime.overview.value = null;
  runtime.overviewLoading.value = false;
  runtime.overviewError.value = null;
  runtime.progressRange.value = "current";
  runtime.progress.value = asProgressResponse(app.state.progress);
  runtime.progressLoading.value = false;
  runtime.progressError.value = null;
  runtime.exerciseDetail.value = null;
  runtime.exerciseLoading.value = false;
  runtime.aerobicList.value = null;
  runtime.aerobicDetail.value = null;
  runtime.aerobicListLoading.value = false;
  runtime.aerobicDetailLoading.value = false;
  runtime.aerobicError.value = null;
  runtime.aerobicErrorContext.value = "list";
  runtime.selectedActivityRef.value = null;
  runtime.monthFilter.value = "all";
  runtime.sportTypeFilter.value = "all";
  runtime.dateFrom.value = null;
  runtime.dateTo.value = null;
  runtime.routes.value = null;
  runtime.routesOpen.value = false;
  runtime.routesLoading.value = false;
  runtime.routeDetail.value = null;
  runtime.routeDetailLoading.value = false;
  runtime.routeOrigin.value = null;
  runtime.selectedRouteKey.value = null;
  runtime.requests.overview += 1;
  runtime.requests.progress += 1;
  runtime.requests.exercise += 1;
  runtime.requests.aerobicList += 1;
  runtime.requests.aerobicDetail += 1;
  runtime.requests.routes += 1;
  runtime.requests.routeDetail += 1;
}
