import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ProjectView from "./views/ProjectView.vue";
import ChatView from "./views/ChatView.vue";
import DocsView from "./views/DocsView.vue";
import ScreensView from "./views/ScreensView.vue";
import GenerateAppView from "./views/GenerateAppView.vue";
import SettingsView from "./views/SettingsView.vue";
import AgentsView from "./views/AgentsView.vue";

export function mountApp(selector: string, apiBase: string): void {
  (globalThis as any).__AUTOCODE_API_BASE__ = apiBase;
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: "/", redirect: "/projects" },
      { path: "/projects", component: ProjectsView },
      { path: "/settings", component: SettingsView },
      {
        path: "/projects/:projectId",
        component: ProjectView,
        children: [
          { path: "", redirect: (to: any) => `/projects/${to.params.projectId}/chat` },
          { path: "chat", component: ChatView },
          { path: "docs", component: DocsView },
          { path: "screens", component: ScreensView },
          { path: "app",  component: GenerateAppView },
          { path: "agents", component: AgentsView },
        ],
      },
    ],
  });
  createApp(App).use(createPinia()).use(router).mount(selector);
}
