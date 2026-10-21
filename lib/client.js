window.__ModuleLoader__.load({
	id: "dsh-auto-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		const copy = {
			"zh-CN": {
				tab: "自动更新",
				title: "DSH 版本更新",
				loading: "正在读取版本信息…",
				unavailable: "暂时读不到更新状态；这不影响现有功能。",
				current: "当前版本",
				latest: "最新版本",
				channel: "更新通道",
				interval: "后台检查间隔",
				hours: "小时",
				check: "检查更新",
				checking: "正在检查…",
				apply: "安装更新",
				applying: "正在安装…",
				rollback: "回滚",
				rollingBack: "正在回滚…",
				upToDate: "已是最新版本",
				available: "有新版本可用",
				autoApply: "发现新版本后自动安装",
				autoApplyHint: "开启后会在后台安装并重启服务，当前对话会短暂中断。",
				pending: "正在后台安装，服务即将自动重启（完成后刷新页面）。",
				pendingRollback: "正在回滚到上一个版本，服务即将重启。",
				confirmApply: "将安装新版本并重启 Web 服务，当前对话会中断几秒。继续？",
				confirmRollback: "将回退到上一个安装目录并重启 Web 服务。继续？",
				lastCheck: "上次检查",
				never: "尚未检查",
				lastResult: "上次结果",
				noResult: "无",
				installed: "安装位置",
				baseSection: "安装目录",
				baseHint: "新版本会装到「安装目录\\dsh-install-<版本>」。只支持纯 ASCII 绝对路径：启动器是 cmd 批处理，按 OEM 代码页读这个文件，中文路径会乱码。",
				basePlaceholder: "例如 D:\\dsh-installs",
				baseBrowse: "浏览…",
				basePicking: "选择中…",
				basePreview: "将安装到",
				baseAsciiWarn: "这个路径含非 ASCII 字符（例如中文用户名），写进 install-base.txt 后启动器读不回来，换一个纯英文路径。",
				baseDefaultAscii: "当前位置是默认目录，由 %USERPROFILE% 在批处理里展开，不受 ASCII 限制；只有你自己指定的目录才会写进 install-base.txt。",
				basePickHint: "「浏览…」会在本机弹出系统选目录窗口（仅当 Web 服务绑定 127.0.0.1 时可用）。",
				baseApply: "改到这里",
				baseApplying: "正在保存…",
				baseMigrate: "把当前安装迁过去",
				baseMigrating: "正在迁移…",
				baseReset: "恢复默认位置",
				baseConfirm: "会把当前安装整体复制到新目录（几百 MB，视磁盘而定），自检通过后切换并重启 Web 服务，当前对话会中断 1-2 分钟；失败会自动回滚到原目录。继续？",
				baseCurrent: "当前安装目录",
				baseDefault: "默认位置",
				pendingMigrate: "正在迁移安装目录并重启服务，完成后刷新页面。",
				safety: "安装到独立目录 · 启动自检失败自动回滚 · 全程写入 update.log",
				restartNote: "重启由独立脚本执行，不会中断安装本身。"
			},
			en: {
				tab: "Auto update",
				title: "DSH version updates",
				loading: "Reading version information…",
				unavailable: "Update status is unavailable right now; nothing else is affected.",
				current: "Current",
				latest: "Latest",
				channel: "Channel",
				interval: "Background check",
				hours: "h",
				check: "Check now",
				checking: "Checking…",
				apply: "Install update",
				applying: "Installing…",
				rollback: "Roll back",
				rollingBack: "Rolling back…",
				upToDate: "Up to date",
				available: "Update available",
				autoApply: "Install new versions automatically",
				autoApplyHint: "Installs in the background and restarts the service; the current conversation is interrupted briefly.",
				pending: "Installing in the background. The service will restart shortly — reload this page afterwards.",
				pendingRollback: "Rolling back to the previous version. The service will restart shortly.",
				confirmApply: "This installs the new version and restarts the web service, interrupting this conversation for a few seconds. Continue?",
				confirmRollback: "This returns to the previous install directory and restarts the web service. Continue?",
				lastCheck: "Last check",
				never: "not checked yet",
				lastResult: "Last result",
				noResult: "none",
				installed: "Install root",
				baseSection: "Install directory",
				baseHint: "New versions install into <directory>\\dsh-install-<version>. Plain ASCII absolute paths only: the launcher is a cmd.exe script and reads this file in the OEM code page, so non-ASCII characters come back garbled.",
				basePlaceholder: "e.g. D:\\dsh-installs",
				baseBrowse: "Browse…",
				basePicking: "Choosing…",
				basePreview: "Will install into",
				baseAsciiWarn: "This path contains non-ASCII characters (a Chinese user name, for example); once written to install-base.txt the launcher cannot read it back. Pick a plain ASCII path.",
				baseDefaultAscii: "This is the default directory: cmd.exe expands %USERPROFILE% inside the batch file, so the non-ASCII user name is harmless. Only a directory you choose yourself is written to install-base.txt.",
				basePickHint: "\"Browse…\" opens the system directory chooser on this machine (only when the web service binds 127.0.0.1).",
				baseApply: "Use this directory",
				baseApplying: "Saving…",
				baseMigrate: "Move current install",
				baseMigrating: "Moving…",
				baseReset: "Back to the default",
				baseConfirm: "This copies the current install into the new directory (a few hundred MB), smoke tests it, then switches and restarts the web service — the conversation is interrupted for 1-2 minutes. A failed restart rolls everything back. Continue?",
				baseCurrent: "Install directory",
				baseDefault: "Default location",
				pendingMigrate: "Moving the install directory and restarting the service; reload this page afterwards.",
				safety: "Installs side by side · boot self-test with automatic rollback · everything logged to update.log",
				restartNote: "The restart runs in a detached script, so the install itself never kills its own work."
			}
		};
		function text() {
			const primary = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
			return primary === "zh-cn" || primary.startsWith("zh-hans") ? copy["zh-CN"] : copy.en;
		}
		function formatTime(ms) {
			if (!ms) return null;
			const d = new Date(ms);
			if (Number.isNaN(d.getTime())) return null;
			const pad = (n) => String(n).padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}
		const styles = `
.dau-page{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
.dau-page h3{margin:0;font-size:18px;font-weight:600}
.dau-status{padding:10px 12px;border:1px solid var(--dsw-alias-brand-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dau-rows{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dau-rows dt{color:var(--dsw-alias-label-tertiary)}
.dau-rows dd{margin:0;word-break:break-all}
.dau-actions{display:flex;flex-wrap:wrap;gap:8px}
.dau-actions button{cursor:pointer;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-size:13px}
.dau-actions button.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand,#fff)}
.dau-actions button:disabled{opacity:.55;cursor:not-allowed}
.dau-message{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dau-note{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dau-toggle{display:flex;align-items:center;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dau-toggle input{width:16px;height:16px}
.dau-base{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dau-base-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dau-base-row input{flex:1 1 260px;min-width:200px;padding:6px 8px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.dau-base-row button{flex:0 0 auto}
.dau-warn{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-size:12px}
`;
		/**
		 * The app's directory chooser, when this app exposes one.
		 *
		 * `uiWorkspace.pickDirectory()` is the client service that opens whichever
		 * interaction the host picked at boot (the native OS dialog when the host
		 * binds loopback, otherwise the in-app browser). Resolved once in `apply`
		 * through `ctx.get` so a host without that service still gets the card and
		 * the plain text input; the button simply stays hidden.
		 */
		let pickDirectory = null;
		function asciiPath(value) {
			return /^[A-Za-z]:[\\/][\x20-\x7E]*$/.test(value);
		}
		function AutoUpdateSection() {
			const t = text();
			const h = react.createElement;
			const [status, setStatus] = react.useState({ kind: "loading" });
			const [busy, setBusy] = react.useState(null);
			const [message, setMessage] = react.useState("");
			const [baseDraft, setBaseDraft] = react.useState(null);
			const load = async () => {
				try {
					const response = await fetch("/dsh-auto-update/api/status", { credentials: "same-origin" });
					if (!response.ok) throw new Error("status unavailable");
					const data = await response.json();
					if (!data?.ok) throw new Error("status unavailable");
					setStatus({ kind: "ready", value: data });
				} catch {
					setStatus({ kind: "error" });
				}
			};
			(0, react.useEffect)(() => {
				void load();
			}, []);
			const pending = status.kind === "ready" ? status.value.pending : null;
			(0, react.useEffect)(() => {
				if (!pending) return undefined;
				const handle = setInterval(() => { void load(); }, 4000);
				return () => { clearInterval(handle); };
			}, [pending ? pending.startedAt : null]);
			const act = async (route, body) => {
				setBusy(route);
				setMessage("");
				try {
					const response = await fetch(`/dsh-auto-update/api/${route}`, {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json", "x-dsh-auto-update": "1" },
						body: JSON.stringify(body ?? {})
					});
					const data = await response.json();
					if (!data?.ok) throw new Error(data?.error ?? "request failed");
					setStatus({ kind: "ready", value: data });
					return true;
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
					return false;
				} finally {
					setBusy(null);
				}
			};
			if (status.kind === "loading") {
				return h("div", { className: "dau-page" }, h("style", null, styles), h("h3", null, t.title), h("div", { className: "dau-message" }, t.loading));
			}
			if (status.kind === "error") {
				return h("div", { className: "dau-page" }, h("style", null, styles), h("h3", null, t.title), h("div", { className: "dau-message" }, t.unavailable));
			}
			const value = status.value;
			const busyNow = busy !== null;
			const draftRaw = (baseDraft ?? value.installBase ?? "").trim();
			const draft = draftRaw.replace(/[\\/]+$/, "");
			const draftAscii = draft === "" || asciiPath(draft);
			// Only a value the user actually typed or picked can break the launcher:
			// the DEFAULT base is expanded by cmd.exe from %USERPROFILE% inside an
			// ASCII batch file, so "C:\Users\<non-ascii>" works there. Warning about
			// the untouched default would accuse a perfectly healthy install.
			const showAsciiWarn = baseDraft !== null && draft !== "" && !draftAscii;
			const previewRoot = draft !== "" && draftAscii ? `${draft}\\dsh-install-${value.currentVersion ?? ""}` : "";
			const canPick = typeof pickDirectory === "function";
			const pick = async () => {
				if (!pickDirectory) return;
				setMessage("");
				setBusy("pick");
				try {
					const picked = await pickDirectory();
					if (typeof picked === "string" && picked !== "") setBaseDraft(picked);
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(null);
				}
			};
			const head = value.updateAvailable ? `${t.current} v${value.currentVersion} · ${t.available}: v${value.latestVersion}` : value.latestVersion ? `${t.current} v${value.currentVersion} · ${t.upToDate}` : `${t.current} v${value.currentVersion ?? "?"}`;
			const pendingNote = pending ? (pending.mode === "rollback" ? t.pendingRollback : pending.mode === "migrate" ? t.pendingMigrate : t.pending) : "";
			const resultText = value.lastResult ? `${value.lastResult.mode ?? ""} v${value.lastResult.version ?? ""} → ${value.lastResult.status ?? ""}${value.lastResult.at ? ` (${formatTime(value.lastResult.at)})` : ""}`.trim() : t.noResult;
			const applyLabel = busy === "apply" ? t.applying : `${t.apply}${value.latestVersion ? ` v${value.latestVersion}` : ""}`;
			const checkLabel = busy === "check" ? t.checking : t.check;
			return h("div", { className: "dau-page" },
				h("style", null, styles),
				h("h3", null, t.title),
				h("div", { className: "dau-status" }, head),
				pending ? h("div", { className: "dau-message" }, pendingNote) : null,
				message ? h("div", { className: "dau-message" }, message) : null,
				h("dl", { className: "dau-rows" },
					h("dt", null, t.channel), h("dd", null, value.channel),
					h("dt", null, t.interval), h("dd", null, `${value.intervalHours} ${t.hours}`),
					h("dt", null, t.lastCheck), h("dd", null, formatTime(value.lastCheckAt) ?? t.never),
					h("dt", null, t.lastResult), h("dd", null, resultText),
					h("dt", null, t.installed), h("dd", null, value.installRoot ?? "—")
				),
				h("div", { className: "dau-base" },
					h("div", null, h("strong", null, t.baseSection)),
					h("div", { className: "dau-note" }, t.baseHint),
					h("div", { className: "dau-base-row" },
						h("input", {
							type: "text",
							spellCheck: false,
							placeholder: t.basePlaceholder,
							value: baseDraft ?? (value.installBase ?? ""),
							disabled: busyNow || Boolean(pending),
							onChange: (event) => { setBaseDraft(event.target.value); }
						}),
						canPick ? h("button", {
							type: "button",
							disabled: busyNow || Boolean(pending),
							onClick: () => { void pick(); }
						}, busy === "pick" ? t.basePicking : t.baseBrowse) : null,
						h("button", {
							type: "button",
							disabled: busyNow || Boolean(pending) || draft === "" || !draftAscii,
							onClick: () => {
								void (async () => {
									const ok = await act("install-base", { base: (baseDraft ?? value.installBase ?? "").trim() });
									if (ok) setBaseDraft(null);
								})();
							}
						}, busy === "install-base" ? t.baseApplying : t.baseApply),
						h("button", {
							type: "button",
							className: "primary",
							disabled: busyNow || Boolean(pending) || draft === "" || !draftAscii,
							onClick: () => {
								const target = (baseDraft ?? value.installBase ?? "").trim();
								if (!target || !window.confirm(t.baseConfirm)) return;
								void (async () => {
									const ok = await act("migrate", { base: target });
									if (ok) setBaseDraft(null);
								})();
							}
						}, busy === "migrate" ? t.baseMigrating : t.baseMigrate),
						h("button", {
							type: "button",
							disabled: busyNow || Boolean(pending),
							onClick: () => {
								void (async () => {
									const ok = await act("install-base", { base: "" });
									if (ok) setBaseDraft(null);
								})();
							}
						}, t.baseReset)
					),
					h("div", { className: "dau-note" },
						`${t.baseCurrent}: ${value.installBase ?? "—"}`,
						value.defaultInstallBase && value.defaultInstallBase !== value.installBase ? ` · ${t.baseDefault}: ${value.defaultInstallBase}` : ""
					),
					previewRoot ? h("div", { className: "dau-note" }, `${t.basePreview}: ${previewRoot}`) : null,
					showAsciiWarn ? h("div", { className: "dau-warn" }, t.baseAsciiWarn) : null,
					!showAsciiWarn && baseDraft === null && value.installBaseSource === "default" && !asciiPath(value.installBase ?? "")
						? h("div", { className: "dau-note" }, t.baseDefaultAscii)
						: null,
					canPick ? h("div", { className: "dau-note" }, t.basePickHint) : null
				),
				h("div", { className: "dau-actions" },
					h("button", { type: "button", disabled: busyNow, onClick: () => { void act("check"); } }, checkLabel),
					h("button", {
						type: "button",
						className: "primary",
						disabled: busyNow || !value.updateAvailable,
						onClick: () => {
							if (!window.confirm(t.confirmApply)) return;
							void act("apply", value.latestVersion ? { version: value.latestVersion } : {});
						}
					}, applyLabel),
					h("button", {
						type: "button",
						disabled: busyNow,
						onClick: () => {
							if (!window.confirm(t.confirmRollback)) return;
							void act("rollback");
						}
					}, busy === "rollback" ? t.rollingBack : t.rollback)
				),
				h("label", { className: "dau-toggle" },
					h("input", {
						type: "checkbox",
						checked: value.autoApply === true,
						disabled: busyNow,
						onChange: (event) => { void act("config", { autoApply: event.target.checked }); }
					}),
					h("span", null, h("strong", null, t.autoApply), h("br"), h("span", { className: "dau-note" }, t.autoApplyHint))
				),
				h("div", { className: "dau-note" }, t.safety),
				h("div", { className: "dau-note" }, t.restartNote)
			);
		}
		const inject = ["slots"];
		function apply(ctx) {
			// Optional capability, not a hard dependency: a host without the
			// workspace service keeps working with the text input alone.
			const workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
			pickDirectory = workspace && typeof workspace.pickDirectory === "function"
				? async () => await workspace.pickDirectory()
				: null;
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "auto-update-status",
				order: 55,
				label: () => text().tab
			}, AutoUpdateSection)), "dsh-auto-update: settings page");
		}
		//#endregion
		exports.AutoUpdateSection = AutoUpdateSection;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
