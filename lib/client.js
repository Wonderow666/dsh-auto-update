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
`;
		function AutoUpdateSection() {
			const t = text();
			const h = react.createElement;
			const [status, setStatus] = react.useState({ kind: "loading" });
			const [busy, setBusy] = react.useState(null);
			const [message, setMessage] = react.useState("");
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
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
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
			const head = value.updateAvailable ? `${t.current} v${value.currentVersion} · ${t.available}: v${value.latestVersion}` : value.latestVersion ? `${t.current} v${value.currentVersion} · ${t.upToDate}` : `${t.current} v${value.currentVersion ?? "?"}`;
			const pendingNote = pending ? (pending.mode === "rollback" ? t.pendingRollback : t.pending) : "";
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
