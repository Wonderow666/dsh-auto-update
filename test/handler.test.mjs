/**
 * Offline checks for the host half: no cordis, no server, no restart.
 *
 * Everything runs against a temporary fixture, so the suite passes on a machine
 * that has never installed dsh, and never touches the real profile state.
 * Run: node test/handler.test.mjs
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../lib/index.js";

// ---------------------------------------------------------------- fixture
// A fake install base: <base>\dsh-install-9.9.1 with a plausible dsh package,
// a launcher pointer that names it by version tag, and a private DSH_HOME so
// config/state writes land in the temp directory.
const base = await mkdtemp(join(tmpdir(), "dau-test-"));
const installDir = join(base, "dsh-install-9.9.1");
const dshPkg = join(installDir, "node_modules", "@deepseek-ai", "dsh");
await mkdir(join(dshPkg, "lib"), { recursive: true });
await writeFile(join(dshPkg, "lib", "bin.js"), "// fake entry point\n", "utf8");
await writeFile(join(dshPkg, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "9.9.1" }), "utf8");

const stateHome = join(base, "home");
const launcherDir = join(base, "launcher");
await mkdir(join(stateHome, "auto-update"), { recursive: true });
await mkdir(launcherDir, { recursive: true });
await writeFile(join(launcherDir, "current-root.txt"), "9.9.1", "utf8");

process.env.DSH_HOME = stateHome;
process.env.DSH_AUTO_UPDATE_LAUNCHER_DIR = launcherDir;
delete process.env.DSH_AUTO_UPDATE_LAUNCH_CMD;
delete process.env.DSH_AUTO_UPDATE_BOOT_LOG;

function makeRequest({ method, url, headers = {}, body }) {
	const request = Readable.from(body ? [Buffer.from(body)] : []);
	request.method = method;
	request.url = url;
	request.headers = headers;
	return request;
}

function makeResponse() {
	const response = {
		statusCode: 0,
		headers: {},
		body: "",
		setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
		end(chunk) { if (chunk !== undefined) this.body = String(chunk); }
	};
	return response;
}

const handler = createHandler({ enabled: true, channel: "latest", intervalHours: 6, autoApply: false });
assert.ok(handler, "webServer.register must receive a handler");

async function call(method, route, { body, headers } = {}) {
	const request = makeRequest({
		method,
		url: `/dsh-auto-update/api${route}`,
		headers: { ...(body ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
		body
	});
	const response = makeResponse();
	await handler(request, response);
	let json = null;
	try { json = JSON.parse(response.body); } catch { /* not json */ }
	return { status: response.statusCode, json, raw: response.body };
}

const mutate = { headers: { "x-dsh-auto-update": "1" } };

// -------------------------------------------------------------- assertions
const status = await call("GET", "/status");
assert.equal(status.status, 200, status.raw);
assert.equal(status.json.ok, true);
assert.equal(status.json.installRoot, installDir, "install root should be rebuilt from the pointer tag");
assert.equal(status.json.currentVersion, "9.9.1");
assert.equal(status.json.autoApply, false);
assert.equal(status.json.canRestart, false, "an unset launch command must be reported, not guessed");
console.log("ok  status:", status.json.currentVersion, "->", status.json.installRoot);

const denied = await call("POST", "/apply", { body: "{}" });
assert.equal(denied.status, 403, "mutation without the guard header must be refused");
console.log("ok  apply without guard header -> 403");

const bogus = await call("POST", "/apply", { body: JSON.stringify({ version: "not-a-version" }), ...mutate });
assert.equal(bogus.status, 400, bogus.raw);
assert.match(bogus.json.error, /invalid version/);
console.log("ok  apply bogus version -> 400:", bogus.json.error);

const older = await call("POST", "/apply", { body: JSON.stringify({ version: "9.9.0" }), ...mutate });
assert.equal(older.status, 400, older.raw);
assert.match(older.json.error, /not newer/);
console.log("ok  apply downgrade -> 400:", older.json.error);

// No launcher configured: refuse to switch versions instead of stranding the
// profile on a version nothing can start.
const noLauncher = await call("POST", "/apply", { body: JSON.stringify({ version: "9.9.2" }), ...mutate });
assert.equal(noLauncher.status, 400, noLauncher.raw);
assert.match(noLauncher.json.error, /DSH_AUTO_UPDATE_LAUNCH_CMD/);
console.log("ok  apply without a restart command -> 400:", noLauncher.json.error);

process.env.DSH_AUTO_UPDATE_LAUNCH_CMD = join(base, "start-web.cmd");
const withLauncher = await call("GET", "/status");
assert.equal(withLauncher.json.canRestart, true, "a configured launch command must flip canRestart");
assert.equal(withLauncher.json.launchCmd, process.env.DSH_AUTO_UPDATE_LAUNCH_CMD);
console.log("ok  launch command configured -> canRestart = true");

const missing = await call("POST", "/nope", mutate);
assert.equal(missing.status, 404);
console.log("ok  unknown route -> 404");

const config = await call("POST", "/config", { body: JSON.stringify({ autoApply: true, intervalHours: 12 }), ...mutate });
assert.equal(config.status, 200, config.raw);
assert.equal(config.json.autoApply, true);
assert.equal(config.json.intervalHours, 12);
console.log("ok  config persisted:", config.json.autoApply, config.json.intervalHours);

const reset = await call("POST", "/config", { body: JSON.stringify({ autoApply: false, intervalHours: 6 }), ...mutate });
assert.equal(reset.json.autoApply, false);
assert.equal(reset.json.intervalHours, 6);
console.log("ok  config reset to defaults");

if (process.env.DSH_AUTO_UPDATE_OFFLINE === "1") {
	console.log("skipping registry check (offline mode)");
} else {
	const checked = await call("POST", "/check", mutate);
	assert.equal(checked.status, 200, checked.raw);
	assert.ok(checked.json.latestVersion, "registry should report a latest version");
	console.log("ok  registry check: latest =", checked.json.latestVersion, "| updateAvailable =", checked.json.updateAvailable);
}

await rm(base, { recursive: true, force: true });
console.log("\nall handler checks passed");
