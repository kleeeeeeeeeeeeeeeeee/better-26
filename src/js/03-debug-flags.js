
			window.__eaglerPerfEnabled = window.location.search.indexOf("perfdebug") >= 0;
			// Local diagnostic A/B controls.
			(function () {
				var params = new URLSearchParams(window.location.search);
				window.__eaglerChunkUnloadHardCap = params.get("chunkunload") === "capped";
			})();
			// Crash recovery.
			(function () {
				var JOURNAL_KEY = "eaglercraft26.crashJournal.v2";
				var REPORT_KEY = "eaglercraft26.lastCrashReport.v2";
				var ACK_KEY = "eaglercraft26.dismissedCrash.v2";
				function read(key) {
					try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : null; }
					catch (e) { return null; }
				}
				function write(key, value) {
					try { localStorage.setItem(key, JSON.stringify(value)); return true; }
					catch (e) { return false; }
				}
				function copy(value) {
					try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
				}
				function runtimeSnapshot() {
					var memory = null;
					try {
						if (performance && performance.memory) {
							memory = {
								usedJSHeapSize: performance.memory.usedJSHeapSize || 0,
								totalJSHeapSize: performance.memory.totalJSHeapSize || 0,
								jsHeapSizeLimit: performance.memory.jsHeapSizeLimit || 0
							};
						}
					} catch (e) {}
					return {
						at: Date.now(),
						memory: memory,
						meshWorkers: copy(window.__meshWorkerPool),
						shaderPack: copy(window.__eaglerShaderPack),
						perfClient: copy(window.__eaglerPerfClient)
					};
				}

				var previous = read(JOURNAL_KEY);
				var acknowledged = read(ACK_KEY);
				var previousAge = previous ? Date.now() - (previous.heartbeat || 0) : Infinity;
				var previousFatal = !!(previous && previous.state === "fatal"
					&& previous.sessionId && (previous.fatalKind || previous.error || previous.report)
					&& previousAge < 7 * 86400000);
				// An unfinished heartbeat is not proof of a crash: tab closing, browser
				// suspension and another live tab can all leave a running journal behind.
				// Only recover an explicitly recorded fatal error.
				var previousReport = previousFatal ? copy(previous) : null;
				if (previousReport && acknowledged && acknowledged.sessionId === previousReport.sessionId) {
					previousReport = null;
				}
				window.__eaglerRecoveredCrash = previousReport;
				var journal = {
					version: 2,
					build: "21b0a73c5a7f5526",
					sessionId: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
					startedAt: Date.now(),
					heartbeat: Date.now(),
					state: "booting",
					stage: "shell",
					url: location.href,
					userAgent: navigator.userAgent || "",
					platform: navigator.platform || "",
					hardwareConcurrency: navigator.hardwareConcurrency || 0,
					deviceMemory: navigator.deviceMemory || 0,
					telemetry: runtimeSnapshot(),
					logTail: []
				};
				function save() {
					journal.heartbeat = Date.now();
					journal.telemetry = runtimeSnapshot();
					try {
						journal.logTail = (window.__log || []).slice(-120).map(function (line) {
							line = "" + line;
							return line.length > 2048 ? line.slice(0, 2048) + "...[truncated]" : line;
						});
					} catch (e) {}
					write(JOURNAL_KEY, journal);
				}
				function fatal(kind, error) {
					journal.state = "fatal";
					journal.fatalKind = kind || "unknown";
					journal.error = "" + (error && (error.stack || error.message || error));
					save();
				}
				window.__eaglerCrashJournal = {
					stage: function (name) {
						journal.stage = name || journal.stage;
						if (name === "game-ready" && journal.state !== "fatal") journal.state = "running";
						save();
					},
					fatal: fatal,
					snapshot: function () { save(); return copy(journal); },
					previous: window.__eaglerRecoveredCrash,
					isLowMemoryRecovery: function () {
						return !!(window.__eaglerRecoveredCrash
							&& /Mac|iPhone|iPad|iPod/.test(navigator.platform + " " + navigator.userAgent));
					}
				};
				window.__eaglerPersistCrashReport = function (text) {
					var full = "" + text;
					var cached = full.length > 524288 ? full.slice(0, 524288)
						+ "\n\n[report truncated by persistent cache; original characters=" + full.length + "]" : full;
					journal.report = cached;
					journal.reportLength = full.length;
					fatal("java-crash", cached.length > 65536 ? cached.slice(0, 65536) + "...[truncated]" : cached);
					write(REPORT_KEY, { at: Date.now(), report: cached, originalLength: full.length, journal: copy(journal) });
				};
				window.__eaglerShowShellCrash = function (error) {
					fatal("shell-crash", error);
					try {
						var root = document.getElementById("game_frame") || document.body;
						var panel = document.createElement("div");
						panel.className = "_eaglercraftX_crash_element";
						panel.style.cssText = "position:fixed;z-index:2147483647;inset:0;background:#fff;color:#111;"
							+ "padding:32px;box-sizing:border-box;overflow:auto;font:14px monospace;white-space:pre-wrap";
						panel.textContent = "Eaglercraft could not continue.\n\n" + journal.error
							+ "\n\nThis report was cached and will still be available after reloading.";
						root.appendChild(panel);
					} catch (e) {}
				};
				function markNavigation() {
					if (journal.state !== "fatal") {
						journal.state = "navigation";
						journal.stage = "page-unload";
						save();
					}
				}
				window.addEventListener("beforeunload", markNavigation);
				window.addEventListener("pagehide", markNavigation);
				window.addEventListener("error", function (event) {
					// Optional scripts can throw without stopping the game. Keep their
					// diagnostics, but let explicit game/shell crash handlers mark failure.
					var error = event && event.error;
					if (error && typeof WebAssembly !== "undefined"
							&& error instanceof WebAssembly.RuntimeError) {
						fatal("wasm-trap", error);
					} else {
						journal.lastWindowError = "" + (error && (error.stack || error.message) || event && event.message || "Unknown error");
						save();
					}
				});
				window.addEventListener("unhandledrejection", function (event) {
					var reason = event && event.reason;
					if (reason && /out of memory|allocation failed|memory access out of bounds/i.test(
						"" + (reason.stack || reason.message || reason))) {
						fatal("memory-pressure", reason);
					}
				});
				var lastMainPulse = performance.now();
				setInterval(function () {
					var now = performance.now();
					var delayed = now - lastMainPulse;
					lastMainPulse = now;
					// Background tabs and suspended devices deliberately throttle timers. Only
					// record a visible, game-ready main-thread stall after it has recovered.
					if (journal.state === "running" && !document.hidden && delayed >= 15000) {
						journal.stallCount = (journal.stallCount || 0) + 1;
						journal.lastStall = {
							at: Date.now(),
							durationMs: Math.round(delayed),
							telemetry: runtimeSnapshot()
						};
						try { console.warn("[shell] recovered visible main-thread stall: "
							+ Math.round(delayed) + " ms"); } catch (e) {}
					}
					save();
				}, 2000);
				document.addEventListener("visibilitychange", function () {
					lastMainPulse = performance.now();
				});
				save();

				function showRecovered() {
					if (!window.__eaglerRecoveredCrash || !document.body) return;
					var cached = read(REPORT_KEY);
					if (!cached || !cached.journal
							|| cached.journal.sessionId !== window.__eaglerRecoveredCrash.sessionId) {
						cached = null;
					}
					var bar = document.createElement("div");
					bar.id = "eagler_recovered_crash";
					bar.style.cssText = "position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;"
						+ "background:#1d1d1d;color:#fff;border:1px solid #777;padding:12px;font:13px sans-serif";
					var text = document.createElement("span");
					text.textContent = "A crash was recorded in the previous game session. Its report is available below.";
					bar.appendChild(text);
					function button(label, action) {
						var b = document.createElement("button");
						b.textContent = label;
						b.style.cssText = "margin-left:10px;padding:5px 9px";
						b.onclick = action;
						bar.appendChild(b);
					}
					function acknowledge() {
						var recovered = window.__eaglerRecoveredCrash;
						if (!recovered) return;
						write(ACK_KEY, {
							sessionId: recovered.sessionId,
							at: Date.now()
						});
						try { localStorage.removeItem(REPORT_KEY); } catch (e) {}
						window.__eaglerRecoveredCrash = null;
						window.__eaglerCrashJournal.previous = null;
						cached = null;
					}
					button("Download Report", function () {
						var payload = cached || { journal: window.__eaglerRecoveredCrash };
						var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
						var url = URL.createObjectURL(blob);
						var a = document.createElement("a");
						a.href = url; a.download = "eaglercraft-recovered-crash.json"; a.click();
						setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
					});
					button("Dismiss", function () {
						acknowledge();
						if (bar.parentNode) bar.parentNode.removeChild(bar);
					});
					document.body.appendChild(bar);
				}
				if (document.readyState === "loading") {
					document.addEventListener("DOMContentLoaded", showRecovered, { once: true });
				} else {
					showRecovered();
				}
			})();
			// Harness logging.
		window.__log = [];
		// Keep enough history for lifecycle/performance gates and crash reports,
		// but do not retain every log line for the lifetime of a long browser
		// session. Perf-debug entity/worldgen traces otherwise grow without bound.
		(function (log) {
			var push = Array.prototype.push;
			log.push = function () {
				var length = push.apply(log, arguments);
				if (length > 8192) {
					log.splice(0, length - 4096);
				}
				return log.length;
			};
		})(window.__log);
		window.__err = null;
		(function () {
			var _l = console.log, _e = console.error, _w = console.warn;
			function push(tag, a) { try { window.__log.push(tag + Array.prototype.join.call(a, " ")); } catch (x) {} }
			console.log = function () { push("L:", arguments); _l.apply(console, arguments); };
			console.error = function () { push("E:", arguments); _e.apply(console, arguments); };
			console.warn = function () { push("W:", arguments); _w.apply(console, arguments); };
			window.addEventListener("error", function (ev) {
				window.__err = "ERROR: " + (ev && ev.message) + " @ " + (ev && ev.filename) + ":" + (ev && ev.lineno);
				window.__log.push("WINERR:" + window.__err);
				// Preserve named Wasm frames for uncaught traps.
				try {
					var st = ev && ev.error && ev.error.stack;
					if (st) {
						(window.__winErrStacks = window.__winErrStacks || []).push("" + st);
						window.__log.push("WINERRSTACK:" + st);
					}
				} catch (x) {}
			});
			window.addEventListener("unhandledrejection", function (ev) {
				var r = ev && ev.reason;
				window.__log.push("REJECT:" + (r && (r.stack || r.message || r)) );
			});
		})();

		// TeaVM may construct WeakReference(null), which native WeakRef rejects.
		(function () {
			var RealWeakRef = window.WeakRef;
			window.WeakRef = class {
				constructor(t) { try { this._r = new RealWeakRef(t); } catch (e) { this._r = { deref: function () { return t; } }; } }
				deref() { return this._r.deref(); }
			};
		})();

		// Audio unlock.
		(function () {
			var Real = window.AudioContext || window.webkitAudioContext;
			if (!Real) return;
			var live = [];
			function Wrapped() { var c = arguments.length ? new Real(arguments[0]) : new Real(); live.push(c); return c; }
			Wrapped.prototype = Real.prototype;
			window.AudioContext = Wrapped;
			if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
			function resumeAll() { for (var i = 0; i < live.length; ++i) { try { if (live[i].state === "suspended") live[i].resume(); } catch (e) {} } }
			window.addEventListener("mousedown", resumeAll, true);
			window.addEventListener("keydown", resumeAll, true);
			window.addEventListener("touchstart", resumeAll, true);
		})();

		// Wasm-GC workers have separate Java heaps. Normal mode deliberately does not
		// guess an eager pool size here: the Java pool starts one isolate, observes
		// frame/queue/heap headroom, and proves each additional worker with a measured
		// trial. ?meshworkers=N remains an exact diagnostic A/B override only.
		function chooseMeshWorkerCount() {
			var match = /[?&]meshworkers=([1-4])(?:&|$)/.exec(window.location.search);
			if (match) return Number(match[1]);
			return -1;
		}
		// The hosted release may point this at a signed bundle on a separate
		// large-file origin. An empty value keeps the preview download disabled.
		window.eaglercraftXIwaBundleURL = "";
		window.eaglercraftXOpts = {
			container: "game_frame",
			assetsURI: [
				{ url: "assets.epk?v=21b0a73c5a7f5526", path: "" },
				{ url: "sounds.epk?v=21b0a73c5a7f5526", path: "" }
			],
			localesURI: "lang/",
			worldsDB: "worlds",
			resourcePacksDB: "resourcePacks",
			crashOnUncaughtExceptions: true,
			enableEPKVersionCheck: false,
			allowBootMenu: false,
			inputSelfTest: false,
			webgl2SelfTest: false,
			// Use data URLs instead of the blob-origin probe.
			disableBlobURLs: true,
			// ?singlethread disables all workers; ?nomesh disables mesh workers.
			singleThreadMode: true,
				serverWorker: window.location.search.indexOf("singlethread") < 0,
				meshWorkers: window.location.search.indexOf("singlethread") < 0
					&& window.location.search.indexOf("nomesh") < 0,
				meshWorkerVerify: false,
				perfDebug: window.__eaglerPerfEnabled,
				chunkUnloadHardCap: window.__eaglerChunkUnloadHardCap,
			// -1 means adaptive. Java also honors an embedder-supplied positive override.
			meshWorkerCount: chooseMeshWorkerCount()
		};

		// Java updates the early boot UI and harness log.
		window.__eaglerBoot = function (pct, text) {
			try { window.__log.push("BOOTSTAGE:" + pct + ":" + text); } catch (e) {}
			try { window.__eaglerCrashJournal.stage("boot-" + pct + "-" + (text || "")); } catch (e) {}
			try {
				var st = document.getElementById("boot_status");
				if (st && text) { st.textContent = text; }
				var load = document.getElementById("loading_screen");
				if (load && typeof pct === "number" && pct >= 80) {
					load.classList.add("minecraft-stage");
				}
			} catch (e) {}
		};
		(function () {
			var total = Number("32533839") || 0;
			var loadedByUrl = Object.create(null);
			window.__eaglerAssetDownloadProgress = function (url, loaded) {
				loadedByUrl[String(url).replace(/[?#].*$/, "")] = Math.max(0, Number(loaded) || 0);
				var sum = 0;
				for (var key in loadedByUrl) sum += loadedByUrl[key];
				if (total > 0) sum = Math.min(sum, total);
				var mb = 1024 * 1024;
				var pct = total > 0 ? 30 + Math.floor(30 * sum / total) : 30;
				window.__eaglerBoot(pct, "Downloading assets… " + (sum / mb).toFixed(1)
					+ " MB / " + (total / mb).toFixed(1) + " MB");
			};
		})();
	