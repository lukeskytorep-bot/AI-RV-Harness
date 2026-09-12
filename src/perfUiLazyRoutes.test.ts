/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(process.cwd(), "src");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

describe("PERF-UI-1 route-level lazy loading", () => {
  it("loads only the measured low-frequency route candidates lazily", () => {
    const app = read("App.tsx");

    for (const route of ["research", "settings", "aiCenter"]) {
      expect(app).toContain(`import("./features/${route}")`);
    }

    for (const eagerRoute of ["home", "profiles", "workspaces", "training", "rvSessions"]) {
      expect(app).not.toContain(`import("./features/${eagerRoute}")`);
    }

    expect(app).toContain('from "./features/home"');
    expect(app).toContain('from "./features/profiles"');
    expect(app).toContain('from "./features/workspaces"');
    expect(app).toContain('from "./features/training"');
    expect(app).toContain('from "./features/rvSessions"');
  });

  it("keeps navigation mounted behind one shared fallback and a visible import-error boundary", () => {
    const app = read("App.tsx");
    const css = ["base.css", "shared.css", "conversations.css", "sessions.css", "settings.css", "monitor.css", "training-research.css", "ai-center.css"]
      .map((file) => read(`styles/${file}`))
      .join("\n");

    expect(app).toContain("<Sidebar");
    expect(app).toContain("<TopBar");
    expect(app).toContain("<Suspense fallback={<LazyRouteLoadingState");
    expect(app).toContain("<LazyRouteErrorBoundary");
    expect(app).toContain("window.location.reload()");
    expect(css).toContain(".route-loading-state");
    expect(css).toContain(".route-load-error");
    expect(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).scripts.build).toContain("report-vite-bundle.mjs");
    const reporter = fs.readFileSync(path.resolve(process.cwd(), "scripts", "report-vite-bundle.mjs"), "utf8");
    expect(reporter).toContain('rel=["\']modulepreload');
    expect(reporter).toContain("initialJavaScript");
    expect(reporter).not.toContain("generatedAt:");
  });

  it("keeps AI Center and its Monitor composition inside the lazy route boundary", () => {
    const route = read("features/aiCenter/AiCenterRoute.tsx");
    const app = read("App.tsx");

    expect(route).toContain('from "../monitor"');
    expect(route).toContain("<AiCenterScreen");
    expect(route).toContain("<MonitorPanel");
    expect(app).not.toContain('from "./features/monitor"');
  });
});
