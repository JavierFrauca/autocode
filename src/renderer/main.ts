import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ProjectView from "./views/ProjectView.vue";
import ChatView from "./views/ChatView.vue";
import DocsView from "./views/DocsView.vue";
import ScreensView from "./views/ScreensView.vue";
import GenerateAppView from "./views/GenerateAppView.vue";
import SettingsView from "./views/SettingsView.vue";
import AgentsView from "./views/AgentsView.vue";
import VersionsView from "./views/VersionsView.vue";
import MediaView from "./views/MediaView.vue";
import PromptsView from "./views/PromptsView.vue";
import LibraryView from "./views/LibraryView.vue";

const apiBase = (window as any).autocode?.apiBase ?? "http://127.0.0.1:4317";
(globalThis as any).__AUTOCODE_API_BASE__ = apiBase;

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: HomeView },
    { path: "/projects", component: ProjectsView },
    { path: "/settings", component: SettingsView },
    { path: "/prompts", component: PromptsView },
    { path: "/library", component: LibraryView },
    {
      path: "/projects/:projectId",
      component: ProjectView,
      children: [
        { path: "", redirect: (to: any) => `/projects/${to.params.projectId}/chat` },
        { path: "chat", component: ChatView },
        { path: "docs", component: DocsView },
        { path: "screens", component: ScreensView },
        { path: "app", component: GenerateAppView },
        { path: "versions", component: VersionsView },
        { path: "agents", component: AgentsView },
        { path: "media", component: MediaView },
      ],
    },
  ],
});

createApp(App).use(createPinia()).use(router).mount("#app");
