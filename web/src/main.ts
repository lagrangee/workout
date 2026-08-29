import { createApp } from "vue";
import App from "./App.vue";
import { createWorkoutAppStore } from "./core/app-store";

const workoutApp = createWorkoutAppStore();

createApp(App, { app: workoutApp }).mount("#app");
