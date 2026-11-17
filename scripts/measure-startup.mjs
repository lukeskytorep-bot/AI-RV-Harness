// Optional production-browser measurement; no model/provider requests are made.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/measure-startup.mjs BEFORE_DIST AFTER_DIST
// Optional CHROMIUM_PATH=/usr/bin/chromium; STARTUP_SAMPLES=5 (default).
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const roots = process.argv.slice(2).map((directory) => path.resolve(directory));
if (roots.length !== 2) throw new Error("Expected BEFORE_DIST AFTER_DIST");
const samples = Number(process.env.STARTUP_SAMPLES || 5);
if (!Number.isInteger(samples) || samples < 1) throw new Error("STARTUP_SAMPLES must be a positive integer");
for (const root of roots) if (!fs.existsSync(path.join(root, "index.html"))) throw new Error(`Missing production index.html: ${root}`);
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ["--no-sandbox"] });
const results = [];
const servers = [];
const routes = [
  { label: "Training", selector: ".training-config" },
  { label: "Conversations", selector: ".conversations-page .chat-surface" },
  { label: "RV Sessions", selector: ".rv-sessions-page .chat-surface" },
];
async function serve(root) {
  const cache = new Map();
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}/`) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    if (!cache.has(file)) cache.set(file, zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html";
    response.writeHead(200, { "Content-Type": type, "Content-Encoding": "gzip", "Cache-Control": "no-store" });
    response.end(cache.get(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const fixture = {
  "rvh.dev.profiles": JSON.stringify([{ id: "p", name: "Benchmark", credentialId: "key", defaultViewerModelId: "model", createdAt: "2026-11-17", updatedAt: "2026-11-17" }]),
  "rvh.dev.workspaces": JSON.stringify(["conversation", "rv"].map((kind) => ({ id: kind, kind, profileId: "p", name: kind, createdAt: "2026-11-17", updatedAt: "2026-11-17", lastOpenedAt: "2026-11-17" }))),
  "rvh.dev.settings": JSON.stringify({ interfaceLanguage: "en", activeConversationWorkspaceId: "conversation", activeRvWorkspaceId: "rv" }),
};
async function open(url, storage) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((values) => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }, storage);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const forbidden = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith(url)) { forbidden.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".home-page").waitFor();
  await frame(page);
  const startupMs = await page.evaluate(() => performance.now());
  await page.waitForLoadState("networkidle");
  return { context, page, errors, forbidden, startupMs };
}
async function frame(page) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function resources(page) {
  return page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith(".js")).map((entry) => ({ name: new URL(entry.name).pathname, bytes: entry.decodedBodySize, gzipBytes: entry.encodedBodySize })));
}
try {
  const variants = [];
  for (const [index, root] of roots.entries()) {
    const url = await serve(root);
    const cold = await open(url, fixture);
    const storage = await cold.page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    results.push({ variant: index ? "after" : "before", scenario: "first-install", startupMs: cold.startupMs, resources: await resources(cold.page), errors: cold.errors, forbidden: cold.forbidden });
    await cold.context.close();
    variants.push({ name: index ? "after" : "before", url, storage });
  }
  // Fresh contexts: empty HTTP/module caches; existing persisted app data. Alternate build order.
  for (let sample = -1; sample < samples; sample++) {
    for (const variant of sample % 2 === 0 ? variants : [...variants].reverse()) {
      for (const route of routes) {
        const run = await open(variant.url, variant.storage);
        const initial = await resources(run.page);
        const started = await run.page.evaluate(() => performance.now());
        await run.page.locator(`.side-nav button[aria-label="${route.label}"]`).click();
        await run.page.locator(route.selector).waitFor();
        await frame(run.page);
        const firstEntryMs = await run.page.evaluate((start) => performance.now() - start, started);
        await run.page.waitForLoadState("networkidle");
        const all = await resources(run.page);
        if (sample >= 0) results.push({ variant: variant.name, scenario: route.label, sample, startupMs: run.startupMs, firstEntryMs, initial, additional: all.filter((entry) => !initial.some((item) => item.name === entry.name)), errors: run.errors, forbidden: run.forbidden });
        await run.context.close();
      }
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), samples, cache: "fresh browser context, existing app data; gzip HTTP loopback; one discarded warmup per route/build", results }, null, 2));
  if (results.some((result) => result.errors.length || result.forbidden.length)) process.exitCode = 1;
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
