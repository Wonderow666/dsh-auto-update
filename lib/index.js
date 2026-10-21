/**
 * dsh-auto-update — host half.
 *
 * Watches the npm dist-tag for @deepseek-ai/dsh, reports it through a small
 * JSON API, and hands the actual install + restart to `apply-update.ps1`,
 * which runs detached so the restart cannot kill its own work (the failure
 * mode that truncated every ad-hoc restart script on this machine).
 *
 * Endpoints (all under /dsh-auto-update/api):
 *   GET  status    — versions, availability, config, last result
 *   POST check     — query the registry now
 *   POST apply     — install a version (defaults to the known latest)
 *   POST rollback  — go back to the root recorded before the last apply
 *   POST config    — persist { enabled, channel, intervalHours, autoApply }
 *
 * Mutating endpoints require the header `x-dsh-auto-update: 1`, so a plain
 * form or a blind GET from another origin cannot install or restart anything.
 */

import { existsSync, readFileSync, openSync, closeSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const name = "dsh-auto-update";
export const inject = ["webServer"];

const PACKAGE_NAME = "@deepseek-ai/dsh";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(MODULE_DIR);
const UPDATER_SCRIPT = join(PLUGIN_ROOT, "apply-update.ps1");

const DEFAULTS = {
	enabled: true,
	channel: "latest",
	intervalHours: 6,
	autoApply: false,
	// Empty means "use npm's own default registry". On networks where npmjs is
	// slow (minutes per tarball), point this at a mirror; the updater passes it
	// straight to `npm install --registry`.
	registry: ""
};

/** Metadata URL for PACKAGE_NAME on the configured registry. */
function metadataUrl(registry) {
	const base = String(registry || DEFAULT_REGISTRY).replace(/\/+$/, "");
	return `${base}/${PACKAGE_NAME.replace("/", "%2f")}`;
}

const MUTATION_HEADER = "x-dsh-auto-update";

/** State root: %DSH_HOME%/auto-update (shared by host and updater script). */
function dshHome() {
	return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function stateDir() {
	return join(dshHome(), "auto-update");
}

/**
 * Directory that owns current-root.txt. The plugin writes the pointer and the
 * launcher script reads it, so both must agree on this path. It defaults to
 * <state>/launcher, which works out of the box; a launcher that already keeps
 * its own directory (this machine does) points at it instead.
 */
function launcherDir() {
	return process.env.DSH_AUTO_UPDATE_LAUNCHER_DIR || join(stateDir(), "launcher");
}

/**
 * Script that starts the web host. There is no sensible default: guessing a
 * launcher on someone else's machine is how a profile ends up on a version
 * nothing can boot. Empty means "not configured", and the plugin refuses to
 * switch versions until the user sets one.
 */
function launchCmd() {
	return process.env.DSH_AUTO_UPDATE_LAUNCH_CMD || "";
}

const NO_LAUNCH_CMD =
	"no restart command configured: set DSH_AUTO_UPDATE_LAUNCH_CMD to the script that starts `dsh web` (see README)";

function paths() {
	const dir = stateDir();
	return {
		dir,
		state: join(dir, "state.json"),
		config: join(dir, "config.json"),
		lock: join(dir, "apply.lock"),
		log: join(dir, "update.log"),
		result: join(dir, "last-result.json"),
		previousRoot: join(dir, "previous-root.txt"),
		currentRoot: join(launcherDir(), "current-root.txt"),
		// Arguments travel through a file, never through argv (see spawnUpdater).
		args: join(dir, "updater-args.json"),
		// Whatever the updater process itself prints: startup and parse errors.
		childLog: join(dir, "updater.log")
	};
}

/** Boot log of the web host, used by the updater to explain a failed restart. */
function bootLog() {
	return process.env.DSH_AUTO_UPDATE_BOOT_LOG || "";
}

// ---------------------------------------------------------------- versioning

function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? "").trim());
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		pre: match[4] ? match[4].split(".") : []
	};
}

/** Semver-ordered comparison; returns -1, 0 or 1 (0 when unparsable). */
export function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;
	for (let index = 0; index < 3; index += 1) {
		if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
	}
	if (left.pre.length === 0 && right.pre.length === 0) return 0;
	if (left.pre.length === 0) return 1;
	if (right.pre.length === 0) return -1;
	const length = Math.max(left.pre.length, right.pre.length);
	for (let index = 0; index < length; index += 1) {
		const a1 = left.pre[index];
		const b1 = right.pre[index];
		if (a1 === undefined) return -1;
		if (b1 === undefined) return 1;
		const numericA = /^\d+$/.test(a1);
		const numericB = /^\d+$/.test(b1);
		if (numericA && numericB) {
			const delta = Number(a1) - Number(b1);
			if (delta !== 0) return delta < 0 ? -1 : 1;
			continue;
		}
		if (numericA) return -1;
		if (numericB) return 1;
		if (a1 !== b1) return a1 < b1 ? -1 : 1;
	}
	return 0;
}

// -------------------------------------------------------------- installation

/** `<root>/node_modules/@deepseek-ai/dsh/lib/bin.js` -> `<root>`. */
function installRootFromScript(scriptPath) {
	if (!scriptPath) return null;
	const match = /^(.*)[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/i.exec(scriptPath);
	return match ? match[1] : null;
}

/** Where installs live: <base>\dsh-install-<version>, i.e. DSH_HOME's parent. */
function installBaseDir() {
	if (process.env.DSH_HOME) return dirname(process.env.DSH_HOME);
	return join(homedir(), "Documents", "Codex", "2026-08-14", "w");
}

/**
 * The launcher pointer holds a bare version tag (cmd.exe reads it in the OEM
 * code page, so a non-ASCII path must never go in there). Legacy pointers with
 * a full path are still accepted.
 */
function readPointer() {
	const candidates = [join(launcherDir(), "current-root.txt"), paths().currentRoot];
	for (const file of candidates) {
		try {
			const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
			if (!text) continue;
			if (/^[A-Za-z]:[\\/]/.test(text)) return text;
			return join(installBaseDir(), `dsh-install-${text}`);
		} catch {
			// try the next candidate
		}
	}
	return null;
}

function detectInstallRoot() {
	return installRootFromScript(process.argv[1]) || readPointer();
}

/** The detached script writes last-result.json; it is the truth about the last run. */
function readLastResult() {
	try {
		// PowerShell 5.1 may leave a BOM behind; JSON.parse chokes on it.
		return JSON.parse(readFileSync(paths().result, "utf8").replace(/^\uFEFF/, ""));
	} catch {
		return null;
	}
}

function readInstalledVersion(root) {
	if (!root) return null;
	try {
		const manifest = JSON.parse(readFileSync(join(root, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : null;
	} catch {
		return null;
	}
}

// ------------------------------------------------------------------ storage

async function readJson(file, fallback) {
	try {
		return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
	} catch {
		return fallback;
	}
}

async function writeJson(file, value) {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
	await rename(temporary, file);
}

// ----------------------------------------------------------------- registry

async function fetchDistTags(registry = "") {
	const response = await fetch(metadataUrl(registry), {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) throw new Error(`registry responded HTTP ${response.status}`);
	const body = await response.json();
	const tags = body?.["dist-tags"];
	if (!tags || typeof tags !== "object") throw new Error("registry payload has no dist-tags");
	return tags;
}

// ------------------------------------------------------------------- update

/** File size in bytes, 0 when the file does not exist. */
function sizeOf(file) {
	try {
		return statSync(file).size;
	} catch {
		return 0;
	}
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const STARTUP_GRACE_MS = 3_000;

/**
 * Spawns the detached updater and waits until it visibly began working.
 *
 * argv is a trap on Windows: `-File apply-update.ps1 -Registry ''` makes
 * powershell.exe swallow the empty value and abort with "Missing an argument for
 * parameter 'Registry'" before the script runs a single line. With
 * stdio: "ignore" that error was invisible, and the API happily answered
 * "started" while nothing happened. So the arguments travel through a JSON file,
 * the child's own output is kept in updater.log, and a child that died on the
 * way is reported instead of pretended.
 */
async function spawnUpdater(mode, extra) {
	const p = paths();
	await writeJson(p.args, {
		mode,
		currentRoot: extra.root ?? "",
		version: extra.version ?? "",
		targetRoot: extra.targetRoot ?? "",
		registry: extra.registry ?? "",
		stateDir: p.dir,
		launcherDir: launcherDir(),
		launchCmd: launchCmd(),
		bootLog: bootLog(),
		stage2Reason: extra.stage2Reason ?? ""
	});
	const logBefore = sizeOf(p.log);
	const handle = openSync(p.childLog, "a");
	let pid;
	try {
		const child = spawn("powershell.exe", [
			"-NoProfile",
			"-ExecutionPolicy", "Bypass",
			"-WindowStyle", "Hidden",
			"-File", UPDATER_SCRIPT,
			"-ArgsFile", p.args
		], { detached: true, stdio: ["ignore", handle, handle], windowsHide: true });
		child.unref();
		pid = child.pid;
	} finally {
		closeSync(handle);
	}
	await verifyUpdaterStarted(pid, logBefore);
	return pid;
}

/** Throws with the captured output when the detached updater did not start. */
async function verifyUpdaterStarted(pid, logBefore) {
	const deadline = Date.now() + STARTUP_GRACE_MS;
	while (Date.now() < deadline) {
		if (sizeOf(paths().log) > logBefore || existsSync(paths().lock)) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (pid && isAlive(pid)) return;
	const tail = (() => {
		try {
			return readFileSync(paths().childLog, "utf8").trim().split(/\r?\n/).slice(-6).join(" | ");
		} catch {
			return "";
		}
	})();
	throw new Error(tail ? `updater failed to start: ${tail}` : "updater failed to start and printed nothing");
}

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

// ------------------------------------------------------------------- plugin

export function apply(ctx, config) {
	const boot = { ...DEFAULTS, ...(config ?? {}) };
	let runtime = { ...boot };

	const state = {
		latestTags: null,
		latestVersion: null,
		lastCheckAt: null,
		lastResult: null,
		lastError: null,
		pending: null,
		currentVersion: null,
		installRoot: null
	};

	const refreshInstall = () => {
		const root = detectInstallRoot();
		state.installRoot = root;
		state.currentVersion = readInstalledVersion(root);
	};

	refreshInstall();

	// Merge the persisted UI choices over the profile-patch defaults. Memoized:
	// every mutation awaits this first, so a request that lands while boot is
	// still reading the file cannot be clobbered by that slower read.
	let configLoaded = null;
	const ensureConfig = () => {
		configLoaded ??= (async () => {
			const persisted = await readJson(paths().config, null);
			runtime = { ...boot, ...(persisted && typeof persisted === "object" ? persisted : {}) };
			return runtime;
		})();
		return configLoaded;
	};

	const migrateState = async () => {
		const persisted = await readJson(paths().state, null);
		if (!persisted || typeof persisted !== "object") return;
		state.latestTags = persisted.latestTags ?? null;
		state.latestVersion = persisted.latestVersion ?? null;
		state.lastCheckAt = persisted.lastCheckAt ?? null;
		state.lastResult = persisted.lastResult ?? null;
		state.pending = persisted.pending ?? null;
	};

	/** The script's own result beats anything this process remembers. */
	const reconcile = () => {
		const result = readLastResult();
		if (!result) return null;
		if (state.pending && typeof result.at === "number" && result.at >= (state.pending.startedAt ?? 0)) {
			state.pending = null;
		}
		if (typeof result.at === "number" && (!state.lastResult || result.at >= (state.lastResult.at ?? 0))) {
			state.lastResult = result;
		}
		return result;
	};

	const saveState = () => writeJson(paths().state, {
		latestTags: state.latestTags,
		latestVersion: state.latestVersion,
		lastCheckAt: state.lastCheckAt,
		lastResult: state.lastResult,
		pending: state.pending
	});

	const updateAvailable = () => {
		if (!state.latestVersion || !state.currentVersion) return false;
		return compareVersions(state.latestVersion, state.currentVersion) > 0;
	};

	const statusPayload = (extra = {}) => ({
		ok: true,
		enabled: runtime.enabled,
		channel: runtime.channel,
		intervalHours: runtime.intervalHours,
		autoApply: runtime.autoApply,
		registry: runtime.registry || DEFAULT_REGISTRY,
		currentVersion: state.currentVersion,
		installRoot: state.installRoot,
		latestVersion: state.latestVersion,
		latestTags: state.latestTags,
		updateAvailable: updateAvailable(),
		lastCheckAt: state.lastCheckAt,
		lastResult: reconcile() ?? state.lastResult,
		lastError: state.lastError,
		pending: state.pending,
		stateDir: stateDir(),
		launcherDir: launcherDir(),
		launchCmd: launchCmd(),
		canRestart: Boolean(launchCmd()),
		...extra
	});

	const check = async () => {
		await ensureConfig();
		const tags = await fetchDistTags(runtime.registry);
		state.latestTags = tags;
		state.lastCheckAt = Date.now();
		const wanted = tags[runtime.channel];
		state.latestVersion = typeof wanted === "string" ? wanted : null;
		state.lastError = null;
		refreshInstall();
		await saveState();
		return statusPayload();
	};

	const applyUpdate = async (version) => {
		await ensureConfig();
		refreshInstall();
		if (!state.installRoot) throw new Error("cannot locate the running dsh install root");
		const target = version || state.latestVersion;
		if (!SAFE_VERSION.test(target ?? "")) throw new Error(`refusing to install invalid version: ${target}`);
		if (state.currentVersion && compareVersions(target, state.currentVersion) <= 0) {
			throw new Error(`${target} is not newer than the running ${state.currentVersion}`);
		}
		if (existsSync(paths().lock)) {
			throw new Error("an update is already running");
		}
		if (!launchCmd()) throw new Error(NO_LAUNCH_CMD);
		const pid = await spawnUpdater("apply", { root: state.installRoot, version: target, registry: runtime.registry });
		state.pending = { version: target, from: state.currentVersion, startedAt: Date.now(), pid };
		await saveState();
		return statusPayload({ started: true, targetVersion: target });
	};

	const rollback = async () => {
		await ensureConfig();
		refreshInstall();
		const previous = (() => {
			try {
				return readFileSync(paths().previousRoot, "utf8").trim() || null;
			} catch {
				return null;
			}
		})();
		if (!previous) throw new Error("no previous install root recorded");
		if (!launchCmd()) throw new Error(NO_LAUNCH_CMD);
		if (!existsSync(join(previous, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"))) {
			throw new Error(`previous root is not a usable install: ${previous}`);
		}
		const pid = await spawnUpdater("rollback", { root: state.installRoot, targetRoot: previous, registry: runtime.registry });
		state.pending = { version: readInstalledVersion(previous) ?? "previous", mode: "rollback", startedAt: Date.now(), pid };
		await saveState();
		return statusPayload({ started: true, targetRoot: previous });
	};

	const saveConfig = async (patch) => {
		await ensureConfig();
		const next = { ...runtime };
		if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
		if (typeof patch.autoApply === "boolean") next.autoApply = patch.autoApply;
		if (typeof patch.channel === "string" && ["latest", "next", "alpha"].includes(patch.channel)) next.channel = patch.channel;
		if (Number.isFinite(Number(patch.intervalHours)) && Number(patch.intervalHours) >= 1 && Number(patch.intervalHours) <= 168) {
			next.intervalHours = Number(patch.intervalHours);
		}
		if (typeof patch.registry === "string") {
			const value = patch.registry.trim().replace(/\/+$/, "");
			if (value === "" || /^https?:\/\/\S+$/i.test(value)) next.registry = value;
		}
		const previousInterval = runtime.intervalHours;
		runtime = next;
		await writeJson(paths().config, runtime);
		if (next.intervalHours !== previousInterval) timerHandle.restart?.();
		return statusPayload();
	};

	// ------------------------------------------------------------- scheduling

	let timerHandle = { timeout: null, interval: null, restart: () => {} };

	const backgroundCheck = async () => {
		if (!runtime.enabled) return;
		try {
			await check();
			const auto = runtime.autoApply && updateAvailable() && state.latestVersion;
			// Do not hammer the same version: one attempt per six hours is enough.
			const attempt = state.lastResult;
			const attemptAge = typeof attempt?.at === "number" ? Date.now() - attempt.at : Number.POSITIVE_INFINITY;
			const recentlyTried = attempt?.mode === "apply" && attempt?.version === state.latestVersion && attemptAge < 6 * 3_600_000;
			if (auto && !recentlyTried && !state.pending) {
				try {
					await applyUpdate(state.latestVersion);
				} catch (error) {
					state.lastError = `auto apply skipped: ${error instanceof Error ? error.message : String(error)}`;
					await saveState();
				}
			}
		} catch (error) {
			state.lastError = error instanceof Error ? error.message : String(error);
			await saveState();
		}
	};

	timerHandle.restart = () => {
		if (timerHandle.timeout) clearTimeout(timerHandle.timeout);
		if (timerHandle.interval) clearInterval(timerHandle.interval);
		timerHandle.timeout = null;
		timerHandle.interval = null;
		if (!runtime.enabled) return;
		timerHandle.timeout = setTimeout(() => { void backgroundCheck(); }, 45_000);
		timerHandle.interval = setInterval(() => { void backgroundCheck(); }, Math.max(1, Number(runtime.intervalHours) || 6) * 3_600_000);
		if (typeof timerHandle.timeout.unref === "function") timerHandle.timeout.unref();
		if (typeof timerHandle.interval.unref === "function") timerHandle.interval.unref();
	};

	// ------------------------------------------------------------ http layer

	const readBody = (req) => new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});

	const send = (res, statusCode, payload) => {
		res.statusCode = statusCode;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.setHeader("cache-control", "no-store");
		res.end(JSON.stringify(payload));
	};

	const handle = async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const route = url.pathname.replace(/^\/dsh-auto-update\/api/, "") || "/";
		const mutating = route !== "/status" && route !== "/health" && req.method !== "GET";

		if (mutating && req.headers[MUTATION_HEADER] === undefined) {
			send(res, 403, { ok: false, error: `missing ${MUTATION_HEADER} header` });
			return;
		}
		if (route === "/health") return send(res, 200, { ok: true, version: state.currentVersion });

		if (req.method === "GET" && route === "/status") return send(res, 200, statusPayload());

		if (req.method === "POST" && route === "/check") {
			try {
				const payload = await check();
				return send(res, 200, payload);
			} catch (error) {
				state.lastError = error instanceof Error ? error.message : String(error);
				return send(res, 502, { ok: false, error: state.lastError });
			}
		}

		if (req.method === "POST" && (route === "/apply" || route === "/rollback")) {
			try {
				const raw = await readBody(req);
				const body = raw.length > 0 ? JSON.parse(raw) : {};
				const payload = route === "/apply" ? await applyUpdate(body.version) : await rollback();
				return send(res, 200, payload);
			} catch (error) {
				return send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		}

		if (req.method === "POST" && route === "/config") {
			try {
				const raw = await readBody(req);
				const body = raw.length > 0 ? JSON.parse(raw) : {};
				return send(res, 200, await saveConfig(body));
			} catch (error) {
				return send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		}

		return send(res, 404, { ok: false, error: "not found" });
	};

	ctx.effect(() => {
		void ensureConfig().then(() => {
			timerHandle.restart();
		});
		return () => {
			if (timerHandle.timeout) clearTimeout(timerHandle.timeout);
			if (timerHandle.interval) clearInterval(timerHandle.interval);
		};
	}, "dsh-auto-update: background update checks");

	void migrateState().then(() => {
		if (state.pending && state.pending.startedAt && Date.now() - state.pending.startedAt > 30 * 60_000) state.pending = null;
		refreshInstall();
		void saveState();
	});

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-auto-update/api",
		handler: handle
	}), "dsh-auto-update: update API");
}

/** Test seam: build the same handler without a cordis context. */
export function createHandler(config) {
	const captured = {};
	const fakeCtx = {
		effect: (factory) => {
			const disposer = factory();
			captured.disposer = disposer;
			return () => { if (typeof disposer === "function") disposer(); };
		},
		webServer: {
			register: (entry) => {
				captured.route = entry;
				return () => {};
			}
		}
	};
	apply(fakeCtx, config);
	return captured.route?.handler ?? null;
}
