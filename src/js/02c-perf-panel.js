
/*
 * On-screen performance panel.
 *
 * A small pill shows the frame rate; drag it to move it, click it to open the
 * panel. The panel has four tabs (Stats, Video, Network, Mods) and a footer
 * with the fullscreen and log buttons. Features holds the switches for things built
 * into the game (see 02f-features.js). Together the tabs have:
 *   - a 30 second frame time graph
 *   - frame time, canvas resolution, GPU in use and device profile state
 *   - counters of the chunk meshing pipeline (workers, queue, errors)
 *   - a render scale slider and an automatic mode that lowers the scale while
 *     the frame rate is low and raises it again once it has been steady
 *   - network traffic of the game's WebSocket and WebRTC connections, with a
 *     red NO DATA warning when nothing has arrived for 5 seconds
 *   - battery level and play time
 *   - a fullscreen button
 *   - a log recorder that samples everything above for 60 seconds (or until
 *     stopped) and downloads the result as a text file
 * Free the mouse with Esc first when in a world.
 *
 * ?panel=0 removes the panel (and its network counters) for this visit; a build
 * whose local configuration has "panel": false never shows it.
 * Internals are exposed on window.__eaglerPerfPanel for diagnostics.
 */
(function () {
	"use strict";
	if (/[?&]panel=0(?:&|$)/.test(window.location.search)) return;
	// "panel": false in the build's local configuration removes it for good.
	if (window.__eaglerHomeServer && window.__eaglerHomeServer.panel === false) return;
	var KEY = "eaglercraft26.perfPanel";
	var POS_KEY = "eaglercraft26.perfPanel.pos";
	var AUTO_KEY = "eaglercraft26.perfPanel.autoScale";
	// Earlier versions kept a server address, token included, under this key.
	try { localStorage.removeItem("eaglercraft26.perfPanel.server"); } catch (e) {}
	var startedAt = Date.now();

	function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

	// ------------------------------------------------------------ event log
	// Things worth knowing about afterwards, kept in the browser so they survive a
	// reload: "stall" (nothing arrived on the connection for 5 s or more, with how long
	// it lasted), "close" (a game connection closed, with its close code) and "hitch" (a
	// frame that took over 150 ms, with the screen it happened on and whether it came
	// right after a click or key press). The newest 60 are kept.
	var EVENTS_KEY = "eaglercraft26.perfPanel.events";
	var events = [];
	var eventsVersion = 0;
	try {
		var storedEvents = JSON.parse(load(EVENTS_KEY) || "[]");
		if (Array.isArray(storedEvents)) events = storedEvents.slice(-60);
	} catch (e) {}
	// A failed server ping logs its whole address, token included. Nothing the panel
	// records or downloads should carry one.
	function redact(text) {
		return String(text)
			.replace(/(token=)[^&\s"']+/gi, "$1<hidden>")
			.replace(/eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "<hidden>");
	}
	var lastEventSave = 0;
	function saveEvents(force) {
		var now = Date.now();
		if (!force && now - lastEventSave < 4000) return;
		lastEventSave = now;
		save(EVENTS_KEY, JSON.stringify(events));
	}
	function addEvent(entry) {
		events.push(entry);
		if (events.length > 60) events.shift();
		++eventsVersion;
		saveEvents(true);
		return entry;
	}
	function clearEvents() {
		events = [];
		++eventsVersion;
		saveEvents(true);
	}
	// Where the game is, from the snapshot it hands over every frame.
	function whereNow() {
		var g = window.__eaglerGame;
		if (!g || performance.now() - g.t > 2000) return "";
		return g.inWorld ? (g.screen === 0 ? "in world" : g.screen === 1 ? "chat" : g.screen === 2 ? "pause menu" : "menu") : "menu";
	}
	// A server drops a player whose game has not answered its keep-alive for about 30 s. That
	// also happens when nothing is wrong with the network: the browser pauses a page whose tab
	// is hidden or whose window is covered, and a sleeping computer pauses everything. So the
	// log notes both: "hidden" (the tab was hidden, noted when it is shown again, with how long)
	// and "paused" (the page did not run for 10 s or more while it was in view).
	var hiddenSince = 0, justShown = false;
	try {
		document.addEventListener("visibilitychange", function () {
			if (document.hidden) {
				hiddenSince = Date.now();
			} else if (hiddenSince) {
				var seconds = Math.round((Date.now() - hiddenSince) / 1000);
				if (seconds >= 5) addEvent({ k: "hidden", t: hiddenSince, v: seconds, x: "tab hidden or window covered" });
				hiddenSince = 0;
				justShown = true;
			}
		});
	} catch (e) {}
	var lastInputAt = 0;
	try {
		["pointerdown", "keydown"].forEach(function (type) {
			document.addEventListener(type, function () { lastInputAt = performance.now(); }, true);
		});
	} catch (e) {}

	// ------------------------------------------------------------ network meter
	// Count bytes on the game's own connections. The wrappers extend the native
	// classes, so instanceof checks, constants and prototypes keep working.
	var net = { up: 0, down: 0, open: 0, host: "", connectMs: 0, upRate: 0, downRate: 0, lastDown: 0 };
	var liveSockets = [];
	// Judge by readyState rather than waiting for close events, which can lag
	// far behind when the other side is slow to finish the closing handshake.
	function refreshConnections() {
		liveSockets = liveSockets.filter(function (entry) { return entry.socket.readyState === 1; });
		net.open = liveSockets.length;
		if (net.open > 0) {
			var newest = liveSockets[net.open - 1];
			net.host = newest.host;
			net.connectMs = newest.connectMs;
		}
	}
	function sizeOf(data) {
		if (data == null) return 0;
		if (typeof data === "string") return data.length;
		if (typeof data.byteLength === "number") return data.byteLength;
		if (typeof data.size === "number") return data.size;
		return 0;
	}
	var NativeWS = window.WebSocket;
	(function installCounters() {
		if (typeof NativeWS === "function") {
			try {
				window.WebSocket = class WebSocket extends NativeWS {
					constructor(url, protocols) {
						if (protocols === undefined) super(url); else super(url, protocols);
						try {
							var created = performance.now(), socket = this;
							var host = "";
							try { host = new URL(String(url), location.href).host; } catch (e) {}
							// After autoDrop has reported a dead connection as closed, the real close event
							// (if it ever comes) must not reach the game a second time.
							socket.addEventListener("close", function (ev) {
								if (socket.__dropped && ev.isTrusted) ev.stopImmediatePropagation();
							}, true);
							socket.addEventListener("open", function () {
								net.lastDown = performance.now(); liveSockets.push({ socket: socket, host: host,
									connectMs: Math.round(performance.now() - created) });
							});
							socket.addEventListener("message", function (ev) { net.down += sizeOf(ev.data); net.lastDown = performance.now(); });
							socket.addEventListener("close", function (ev) {
								var wasLive = liveSockets.some(function (entry) { return entry.socket === socket; });
								if (!wasLive) return;
								var quiet = net.lastDown ? Math.round((performance.now() - net.lastDown) / 1000) : 0;
								addEvent({ k: "close", t: Date.now(), v: quiet, x: "code " + ev.code + (ev.wasClean ? "" : ", not clean") });
							});
						} catch (e) {}
					}
					send(data) {
						try { net.up += sizeOf(data); } catch (e) {}
						return super.send(data);
					}
				};
			} catch (e) {
				window.WebSocket = NativeWS;
			}
		}
		// WebRTC data channels carry the world traffic of peer-to-peer LAN worlds.
		try {
			if (window.RTCDataChannel) {
				var nativeSend = RTCDataChannel.prototype.send;
				RTCDataChannel.prototype.send = function (data) {
					try { net.up += sizeOf(data); } catch (e) {}
					return nativeSend.apply(this, arguments);
				};
			}
			var NativePC = window.RTCPeerConnection;
			if (typeof NativePC === "function") {
				var watch = function (channel) {
					try {
						channel.addEventListener("message", function (ev) { net.down += sizeOf(ev.data); net.lastDown = performance.now(); });
					} catch (e) {}
				};
				window.RTCPeerConnection = class RTCPeerConnection extends NativePC {
					constructor(config, constraints) {
						if (constraints === undefined) super(config); else super(config, constraints);
						try { this.addEventListener("datachannel", function (ev) { watch(ev.channel); }); } catch (e) {}
					}
					createDataChannel() {
						var channel = super.createDataChannel.apply(this, arguments);
						watch(channel);
						return channel;
					}
				};
			}
		} catch (e) {}
	})();

	// ------------------------------------------------------- automatic scaling
	// Steps the render scale between a floor and the player's chosen maximum.
	// It lowers quickly (about a second of low frame rate) and raises slowly
	// (several steady seconds), and waits longer before raising again each time a
	// raise had to be undone, so it settles instead of oscillating.
	function createAuto(options) {
		var STEP = 0.25, COOLDOWN = 4, LOW_WINDOWS = 2, RAISE_MIN = 16, RAISE_MAX = 240;
		var low = 0, good = 0, cooldown = 0, raiseWait = RAISE_MIN, sinceRaise = 1e9;
		var current = null;
		function ceiling() { return options.ceiling(); }
		function floor() { return Math.min(options.floor, ceiling()); }
		return {
			reset: function () {
				low = good = cooldown = 0;
				raiseWait = RAISE_MIN;
				sinceRaise = 1e9;
				current = ceiling();
				options.apply(current);
			},
			current: function () { return current; },
			// One sample per measurement window of about half a second.
			sample: function (fps, refresh) {
				if (current === null) current = ceiling();
				if (current > ceiling()) { current = ceiling(); options.apply(current); }
				++sinceRaise;
				if (cooldown > 0) { --cooldown; return; }
				if (fps < refresh * 0.8) {
					good = 0;
					if (++low >= LOW_WINDOWS && current > floor()) {
						if (sinceRaise < 40) raiseWait = Math.min(raiseWait * 2, RAISE_MAX);
						current = Math.max(floor(), current - STEP);
						options.apply(current);
						low = 0;
						cooldown = COOLDOWN;
					}
				} else if (fps >= refresh * 0.95) {
					low = 0;
					if (++good >= raiseWait && current < ceiling()) {
						current = Math.min(ceiling(), current + STEP);
						options.apply(current);
						good = 0;
						sinceRaise = 0;
						cooldown = COOLDOWN;
					}
				} else {
					low = 0;
					good = 0;
				}
			}
		};
	}

	// ---------------------------------------------------------------- recorder
	// Samples the panel's numbers twice a second and collects the game's own log
	// lines, then downloads everything as one text file. Stops by itself.
	var RECORD_MS = 60000;
	var recording = null;   // { startedAt, samples, lines, timer, restoreLog }
	var recordButton = null;
	var COLUMNS = ["t", "fps", "worstMs", "gameMs", "gameP95", "canvas", "scale", "ready", "spawned", "desired",
		"queuedSections", "queuedResults", "inFlight", "dispatcherInFlight", "jobs", "completed", "inline",
		"errors", "cancelled", "shrinks", "heapPressure", "downKBs", "upKBs", "silentS"];

	function recordSample() {
		if (!recording) return;
		var pool = window.__meshWorkerPool || {};
		var canvas = document.querySelector("._eaglercraftX_canvas_element");
		function n(value, digits) { return typeof value === "number" ? +value.toFixed(digits || 0) : ""; }
		recording.samples.push([
			((Date.now() - recording.startedAt) / 1000).toFixed(1), n(fps, 1), n(worstShown, 1),
			n(pool.frameEwmaMs, 1), n(pool.frameP95Ms, 1),
			canvas ? canvas.width + "x" + canvas.height : "", scale ? n(scale.effective(), 2) : "",
			n(pool.ready), n(pool.spawned), n(pool.desiredWorkers), n(pool.queuedSections), n(pool.queuedResults),
			n(pool.inFlight), n(pool.dispatcherInFlight), n(pool.jobs), n(pool.completedJobs), n(pool.inline),
			n(pool.errors), n(pool.cancelledJobs), n(pool.shrinks), n(pool.heapPressure, 3),
			n(net.downRate / 1024, 1), n(net.upRate / 1024, 1), n(silentSeconds(), 1)
		].join("\t"));
	}

	function snapshot() {
		try { return JSON.stringify(window.__meshWorkerPool || null); } catch (e) { return "unavailable"; }
	}

	function startRecording() {
		if (recording) return;
		recording = { startedAt: Date.now(), samples: [], lines: [], poolAtStart: snapshot(), restoreLog: null };
		// Collect game log lines as they are written, without keeping the whole log.
		var log = window.__log;
		if (log && typeof log.push === "function") {
			var original = log.push;
			log.push = function () {
				try {
					for (var i = 0; i < arguments.length && recording && recording.lines.length < 5000; ++i) {
						var line = redact(arguments[i]);
						recording.lines.push(((Date.now() - recording.startedAt) / 1000).toFixed(1) + "  "
							+ (line.length > 600 ? line.slice(0, 600) + "...[cut]" : line));
					}
				} catch (e) {}
				return original.apply(log, arguments);
			};
			recording.restoreLog = function () { log.push = original; };
		}
		recording.timer = setTimeout(stopRecording, RECORD_MS);
		recordSample();
		update();
	}

	function stopRecording() {
		if (!recording) return;
		var done = recording;
		recording = null;
		clearTimeout(done.timer);
		if (done.restoreLog) done.restoreLog();
		var profile = window.__eaglerM1Profile || {};
		var params = window.location.search.replace(/([?&]token=)[^&]*/i, "$1(hidden)");
		var text = [
			"Eaglercraft 26.2 performance log",
			"started: " + new Date(done.startedAt).toISOString(),
			"duration: " + ((Date.now() - done.startedAt) / 1000).toFixed(1) + " s",
			"browser: " + navigator.userAgent,
			"url parameters: " + (params || "(none)"),
			"screen: " + screen.width + "x" + screen.height + ", native pixel ratio " + nativeRatio()
				+ ", window " + window.innerWidth + "x" + window.innerHeight,
			"cores reported: " + navigator.hardwareConcurrency + ", device memory: " + (navigator.deviceMemory || "?"),
			"device profile: " + (profile.active ? (profile.kind === "pc" ? "Intel PC" : "M1 Air") : "off")
				+ ", GPU: " + (profile.gpu || profile.renderer || "?"),
			"render scale: chosen " + (scale ? (scale.get() === null ? "native" : scale.get()) : "n/a")
				+ ", auto " + (autoOn ? "on" : "off"),
			"refresh rate estimate: " + refresh,
			"",
			"mesh pool at start: " + done.poolAtStart,
			"mesh pool at end:   " + snapshot(),
			"",
			"== samples (one per half second, tab separated) ==",
			COLUMNS.join("\t")
		].concat(done.samples, ["", "== game log lines during the recording (" + done.lines.length + ") =="], done.lines,
			["", "== event log (newest last; time, kind, length ms or s, detail) =="],
			events.map(function (entry) { return new Date(entry.t).toISOString() + "\t" + entry.k + "\t" + entry.v + "\t" + redact(entry.x || ""); }))
			.join("\n") + "\n";
		try {
			var stamp = new Date(done.startedAt).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
			var link = document.createElement("a");
			link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
			link.download = "eaglercraft-log-" + stamp + ".txt";
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
		} catch (e) {}
		update();
	}

	// --------------------------------------------------------------------- UI
	function el(tag, css, text) {
		var node = document.createElement(tag);
		if (css) node.style.cssText = css;
		if (text) node.textContent = text;
		return node;
	}
	// Plain elements instead of <button>: they never take keyboard focus, so
	// Space or Enter pressed in the game cannot re-trigger them.
	function clickable(node, action) {
		node.style.cursor = "pointer";
		node.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
		node.addEventListener("click", function (ev) { ev.preventDefault(); action(); });
		return node;
	}
	var ACCENT = "#5BD45B";   // Minecraft green
	var WARN = "#FFFF55", BAD = "#FF5555";
	var PANEL_W = 300;
	var GRAPH_W = PANEL_W - 24;
	var BUTTON_CSS = "flex:1;text-align:center;padding:5px 8px;border-radius:3px;"
		+ "background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);white-space:nowrap";
	var TAB_KEY = "eaglercraft26.perfPanel.tab";
	// A build can show only some tabs: "panelTabs": ["net"] in its local configuration (used
	// for the build given to a friend whose dropouts are being looked into). Without it all
	// four tabs and the footer buttons show.
	var ONLY = window.__eaglerHomeServer && Array.isArray(window.__eaglerHomeServer.panelTabs)
		&& window.__eaglerHomeServer.panelTabs.length ? window.__eaglerHomeServer.panelTabs : null;
	var TABS = [["stats", "Stats", "clock"], ["display", "Video", "spyglass"], ["net", "Network", "pearl"],
		["features", "Mods", "book"]];

	var root, pill, pillText, body, graph, rows = {}, slider, scaleLabel, autoButton;
	var pages = {}, tabButtons = {}, cur = null, tab = "stats";
	var open = load(KEY) === "open";
	var storedAuto = load(AUTO_KEY);
	var deviceProfile = window.__eaglerM1Profile || {};
	// Without a saved choice, a device profile can start with the automatic scale on.
	var autoOn = storedAuto === null ? !!deviceProfile.defaultAuto : storedAuto === "on";
	var scale = null;      // window.__eaglerRenderScale, when usable
	var auto = null;
	var history = [];      // {fps, worst} per window, newest last
	var HISTORY = 60;

	function nativeRatio() { return scale ? scale.native() : (window.devicePixelRatio || 1); }
	// The player's chosen maximum, as a number.
	function chosenScale() {
		var value = Number(slider ? slider.value : nativeRatio());
		return Math.min(value, nativeRatio());
	}
	function applyScale(value, temporary) {
		if (!scale) return;
		scale.set(value >= nativeRatio() - 0.001 ? null : value, temporary);
	}

	// Rows and sections are added to the page being built.
	function section(title) {
		cur.appendChild(el("div", "margin:11px 0 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;"
			+ "color:" + ACCENT, title));
	}
	function row(key, label) {
		var line = el("div", "display:flex;justify-content:space-between;gap:14px;padding:1px 0");
		line.appendChild(el("span", "opacity:0.6", label));
		rows[key] = el("span", "text-align:right");
		rows[key + "Line"] = line;
		line.appendChild(rows[key]);
		cur.appendChild(line);
	}
	function note(text) {
		cur.appendChild(el("div", "font-size:10px;line-height:1.4;opacity:0.55;margin:2px 0 4px", text));
	}

	// A short list of the newest events of some kinds, redrawn when the log changes.
	var eventLists = [];
	function clock(ms) {
		var d = new Date(ms), two = function (n) { return (n < 10 ? "0" : "") + n; };
		return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
	}
	function describe(entry) {
		if (entry.k === "stall") return "no data " + entry.v + " s" + (entry.open ? " (still)" : "") + (entry.x ? " (" + entry.x + ")" : "");
		if (entry.k === "drop") return "dead connection closed after " + entry.v + " s silent" + (entry.x ? " (" + entry.x + ")" : "");
		if (entry.k === "probe") return entry.x + " unreachable " + entry.v + " s" + (entry.open ? " (still)" : "");
		if (entry.k === "gamestall") return "game froze " + entry.v + " ms" + (entry.open ? " (still)" : "") + (entry.x ? " (" + entry.x + ")" : "");
		if (entry.k === "hidden") return "tab hidden " + entry.v + " s";
		if (entry.k === "paused") return "page paused " + entry.v + " s (sleep or freeze)";
		if (entry.k === "close") return "connection closed, " + entry.x + (entry.v >= 5 ? ", silent " + entry.v + " s before" : "");
		return "long frame " + entry.v + " ms" + (entry.x ? " (" + entry.x + ")" : "");
	}
	function eventList(kinds, max, emptyText) {
		var box = el("div", "font-size:11px;line-height:1.5");
		var shownVersion = -1;
		cur.appendChild(box);
		eventLists.push(function () {
			if (shownVersion === eventsVersion) return;
			shownVersion = eventsVersion;
			while (box.firstChild) box.removeChild(box.firstChild);
			var picked = events.filter(function (entry) { return kinds.indexOf(entry.k) >= 0; }).slice(-max).reverse();
			if (!picked.length) {
				box.appendChild(el("div", "opacity:0.55", emptyText));
				return;
			}
			picked.forEach(function (entry) {
				var line = el("div", "display:flex;gap:10px");
				line.appendChild(el("span", "opacity:0.6;flex:none", clock(entry.t)));
				var text = el("span", "", describe(entry));
				if (entry.k === "stall" || entry.k === "drop" || entry.k === "probe" || entry.k === "close" || (entry.k === "gamestall" && entry.v >= 1000)) text.style.color = BAD;
				else if (entry.k === "hidden" || entry.k === "paused") text.style.color = WARN;
				else text.style.color = entry.v >= 500 ? BAD : WARN;
				line.appendChild(text);
				box.appendChild(line);
			});
		});
	}

	// A labelled on/off switch. get() reads the current value, set(value) stores it.
	function toggle(label, hint, get, set) {
		var line = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0");
		var text = el("div", "min-width:0");
		text.appendChild(el("div", "font-size:12px", label));
		if (hint) text.appendChild(el("div", "font-size:10px;line-height:1.4;opacity:0.55;margin-top:1px", hint));
		line.appendChild(text);
		var track = el("div", "flex:none;position:relative;width:34px;height:18px;border-radius:4px;"
			+ "transition:background 0.15s");
		var knob = el("div", "position:absolute;top:2px;width:14px;height:14px;border-radius:2px;"
			+ "background:#fff;transition:left 0.15s");
		track.appendChild(knob);
		function paint() {
			var on = !!get();
			track.style.background = on ? ACCENT : "rgba(255,255,255,0.22)";
			knob.style.left = on ? "18px" : "2px";
		}
		clickable(track, function () { set(!get()); paint(); });
		paint();
		line.appendChild(track);
		cur.appendChild(line);
	}

	function showTab(name) {
		if (ONLY && ONLY.indexOf(name) < 0) name = ONLY[0];
		tab = pages[name] ? name : "stats";
		TABS.forEach(function (entry) {
			var active = entry[0] === tab;
			pages[entry[0]].style.display = active ? "block" : "none";
			tabButtons[entry[0]].style.color = active ? "#fff" : "rgba(255,255,255,0.55)";
			tabButtons[entry[0]].style.borderBottomColor = active ? ACCENT : "transparent";
			tabButtons[entry[0]].style.background = active ? "rgba(255,255,255,0.06)" : "transparent";
		});
		save(TAB_KEY, tab);
		update();
		fit();
	}

	function setOpen(value) {
		open = value;
		body.style.display = open ? "block" : "none";
		save(KEY, open ? "open" : "closed");
		update();
		fit();
	}

	// Keep the whole panel inside the window.
	function fit() {
		if (!root) return;
		var rect = root.getBoundingClientRect();
		var left = Math.max(0, Math.min(rect.left, window.innerWidth - rect.width));
		var top = Math.max(0, Math.min(rect.top, window.innerHeight - rect.height));
		root.style.left = left + "px";
		root.style.top = top + "px";
	}

	function buildStatsPage() {
		cur = pages.stats;
		graph = el("canvas", "display:block;width:" + GRAPH_W + "px;height:46px;margin-bottom:6px;"
			+ "background:rgba(0,0,0,0.35);border-radius:3px");
		graph.title = "Slowest frame in each half second, last 30 seconds. The line marks 60 FPS.";
		cur.appendChild(graph);

		row("gameFps", "FPS");
		row("frame", "Worst frame");
		row("game", "Game frame");
		row("res", "Resolution");
		row("gpu", "GPU");
		row("m1", "Profile");

		// Chunk meshing pipeline, for diagnosing terrain that stays invisible.
		section("Chunk meshing");
		row("mesh", "Workers");
		row("meshQueue", "Waiting");
		row("meshFlight", "In progress");
		row("meshDone", "Built");
		row("meshInline", "Built inline");
		row("meshErrors", "Errors");

		section("Long frames");
		eventList(["hitch", "gamestall"], 6, "None yet. Frames over 150 ms and game freezes over 400 ms are listed here.");

		section("System");
		row("battery", "Battery");
		rows.batteryLine.style.display = "none";
		row("time", "Play time");
	}

	function buildDisplayPage() {
		cur = pages.display;
		section("Render scale");
		if (!scale) {
			note("Render scale control is not available in this browser.");
			return;
		}
		note("Lower scale draws fewer pixels, which is faster. Auto lowers it while the frame rate is low.");
		var line = el("div", "display:flex;align-items:center;gap:10px;margin-top:6px");
		slider = el("input", "flex:1;min-width:0;margin:0;accent-color:" + ACCENT);
		slider.type = "range";
		slider.min = "0.5";
		slider.step = "0.25";
		slider.tabIndex = -1;
		var top = Math.max(0.5, Math.ceil(nativeRatio() * 4) / 4);
		slider.max = String(top);
		var stored = scale.get();
		slider.value = String(stored === null ? top : Math.min(stored, top));
		// Never keep keyboard focus: arrow keys belong to the game.
		function release() { try { slider.blur(); } catch (e) {} }
		slider.addEventListener("input", function () {
			applyScale(chosenScale(), false);
			if (auto) auto.reset();
			update();
		});
		slider.addEventListener("change", release);
		slider.addEventListener("pointerup", release);
		line.appendChild(slider);
		scaleLabel = el("span", "min-width:48px;text-align:right");
		line.appendChild(scaleLabel);
		cur.appendChild(line);

		var autoLine = el("div", "display:flex;gap:8px;margin-top:8px;align-items:center");
		autoButton = clickable(el("div", BUTTON_CSS, "Auto"), function () {
			autoOn = !autoOn;
			save(AUTO_KEY, autoOn ? "on" : "off");
			if (autoOn) auto.reset(); else applyScale(chosenScale(), false);
			update();
		});
		autoButton.style.flex = "0 0 70px";
		autoButton.title = "Lower the scale while the frame rate is low, raise it back when steady";
		autoLine.appendChild(autoButton);
		rows.autoState = el("span", "flex:1;opacity:0.6;text-align:right");
		autoLine.appendChild(rows.autoState);
		cur.appendChild(autoLine);

		auto = createAuto({
			// On a screen at ratio 1 the scale is already 1x, so the automatic mode needs
			// room below it; on a high-density screen 1x is the floor.
			floor: nativeRatio() <= 1.001 ? 0.75 : 1,
			ceiling: chosenScale,
			apply: function (value) { applyScale(value, true); }
		});
		if (autoOn) auto.reset();
	}

	// The whole event log as text, for pasting into a chat or saving as a file.
	function eventsText() {
		return ["Eaglercraft event log, " + new Date().toISOString() + " (" + events.length + " events, newest last)",
			"time\tkind\tlength (ms or s)\tdetail"].concat(events.map(function (entry) {
			return new Date(entry.t).toISOString() + "\t" + entry.k + "\t" + entry.v + "\t" + redact(entry.x || "");
		})).join("\n") + "\n";
	}
	function exportEvents(mode, button) {
		var text = eventsText();
		var label = button.textContent;
		function flash(message) {
			button.textContent = message;
			setTimeout(function () { button.textContent = label; }, 1500);
		}
		if (mode === "copy") {
			try {
				navigator.clipboard.writeText(text).then(function () { flash("Copied"); }, function () { exportEvents("save", button); });
			} catch (e) { exportEvents("save", button); }
			return;
		}
		try {
			var link = document.createElement("a");
			link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
			link.download = "eaglercraft-events-" + new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15) + ".txt";
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
			flash("Saved");
		} catch (e) {}
	}

	function buildNetworkPage() {
		cur = pages.net;
		section("Traffic");
		row("down", "Download");
		row("up", "Upload");
		row("conn", "Connection");
		row("probe", "Reachability");
		section("Connection events");
		eventList(["stall", "drop", "probe", "close", "hidden", "paused", "gamestall"], 8, "None yet. Stalls, closed connections, hidden tabs and pauses are listed here.");
		var clearLine = el("div", "display:flex;gap:8px;margin-top:8px");
		var clearButton = clickable(el("div", BUTTON_CSS, "Clear event log"), function () { clearEvents(); update(); });
		clearButton.title = "Forget the recorded stalls, closed connections and long frames";
		var copyButton = clickable(el("div", BUTTON_CSS, "Copy"), function () { exportEvents("copy", copyButton); });
		copyButton.title = "Copy the whole event log as text";
		var saveButton = clickable(el("div", BUTTON_CSS, "Download"), function () { exportEvents("save", saveButton); });
		saveButton.title = "Download the whole event log as a text file";
		clearLine.appendChild(copyButton);
		clearLine.appendChild(saveButton);
		clearLine.appendChild(clearButton);
		cur.appendChild(clearLine);
		note("NO DATA appears next to the round button when nothing has arrived for 5 seconds.");
	}

	var CORNER_NAMES = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];

	function buildFeaturesPage() {
		cur = pages.features;
		var features = window.__eaglerFeatures;
		var set = window.__eaglerFeatureSet;
		section("In the game");
		if (!features || typeof set !== "function") {
			note("This build has no feature switches.");
			return;
		}
		toggle("Jade tooltip", "What you are looking at: name, crop growth, health. Chest, furnace and similar"
			+ " details need a server that supports them.",
			function () { return features.jade; }, function (value) { set("jade", value); });
		toggle("Coordinates", "Position, block, facing and biome. Stays on with chat or the menu open; hidden while F3 is open.",
			function () { return features.coords; }, function (value) { set("coords", value); });
		toggle("Keep running in background", "Keeps the game going while this tab is hidden or the window is covered,"
			+ " so the server does not time you out. Uses a little more battery.",
			function () { return features.background; }, function (value) { set("background", value); });
		toggle("Drop dead connections", "If nothing arrives for 15 seconds, close the connection so the game shows"
			+ " the disconnect screen and you can rejoin, instead of waiting minutes.",
			function () { return features.autoDrop; }, function (value) { set("autoDrop", value); });

		cur.appendChild(el("div", "font-size:12px;margin:8px 0 5px", "Coordinates corner"));
		var grid = el("div", "display:grid;grid-template-columns:1fr 1fr;gap:6px");
		var corners = {};
		function paintCorners() {
			CORNER_NAMES.forEach(function (entry) {
				var on = features.coordsPos === entry[0];
				corners[entry[0]].style.background = on ? ACCENT : "rgba(255,255,255,0.08)";
				corners[entry[0]].style.borderColor = on ? ACCENT : "rgba(255,255,255,0.16)";
			});
		}
		CORNER_NAMES.forEach(function (entry) {
			corners[entry[0]] = clickable(el("div", BUTTON_CSS, entry[1]), function () {
				set("coordsPos", entry[0]);
				paintCorners();
			});
			corners[entry[0]].style.flex = "none";
			grid.appendChild(corners[entry[0]]);
		});
		paintCorners();
		cur.appendChild(grid);
		note("Changes apply at once and are remembered in this browser.");
	}

	function build() {
		scale = window.__eaglerRenderScale && window.__eaglerRenderScale.available ? window.__eaglerRenderScale : null;
		var pos = null;
		try { pos = JSON.parse(load(POS_KEY)); } catch (e) {}
		root = el("div", "position:fixed;z-index:2147483645;color:#fff;"
			+ "font:11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
			+ "user-select:none;-webkit-user-select:none");
		root.id = "eag_perf_panel";
		root.style.left = (pos && pos.x >= 0 ? pos.x : 6) + "px";
		root.style.top = (pos && pos.y >= 0 ? pos.y : 6) + "px";

		// The menu button: a round button with an item icon. The game shows its own frame
		// rate, so this one shows no number, only warnings (no data on the connection, a log
		// being recorded) next to the icon.
		pill = el("div", "display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;"
			+ "min-width:34px;padding:0;"
			+ "border-radius:999px;cursor:grab;background:rgba(14,16,22,0.78);border:1px solid rgba(255,255,255,0.16);"
			+ "box-shadow:0 4px 14px rgba(0,0,0,0.35);touch-action:none;font-variant-numeric:tabular-nums");
		var pillIcon = el("span");
		pillIcon.className = "eagicon eagicon-redstone";
		pill.appendChild(pillIcon);
		pillText = el("span", "display:none;font-weight:600");
		pill.appendChild(pillText);
		pill.title = "Click to open, drag to move";
		root.appendChild(pill);

		// Drag to move; a press that does not move is a click.
		(function () {
			var drag = null;
			pill.addEventListener("pointerdown", function (ev) {
				ev.preventDefault();
				var rect = root.getBoundingClientRect();
				drag = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top, moved: false };
				try { pill.setPointerCapture(ev.pointerId); } catch (e) {}
			});
			pill.addEventListener("pointermove", function (ev) {
				if (!drag) return;
				var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
				if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
				drag.moved = true;
				root.style.left = (drag.left + dx) + "px";
				root.style.top = (drag.top + dy) + "px";
			});
			function end(ev) {
				if (!drag) return;
				var moved = drag.moved;
				drag = null;
				try { pill.releasePointerCapture(ev.pointerId); } catch (e) {}
				if (moved) {
					fit();
					var rect = root.getBoundingClientRect();
					save(POS_KEY, JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
				} else if (ev.type === "pointerup") {
					setOpen(!open);
				}
			}
			pill.addEventListener("pointerup", end);
			pill.addEventListener("pointercancel", end);
		})();

		body = el("div", "margin-top:6px;width:" + PANEL_W + "px;border-radius:6px;overflow:hidden;"
			+ "background:rgba(14,16,22,0.92);border:1px solid rgba(255,255,255,0.12);"
			+ "box-shadow:0 10px 30px rgba(0,0,0,0.5)");

		var tabbar = el("div", "display:flex;border-bottom:1px solid rgba(255,255,255,0.1)");
		var host = el("div", "padding:10px 12px;max-height:min(58vh,430px);overflow-y:auto");
		TABS.forEach(function (entry) {
			pages[entry[0]] = el("div", "display:none");
			host.appendChild(pages[entry[0]]);
			var button = clickable(el("div", "flex:1;display:flex;align-items:center;justify-content:center;gap:5px;"
				+ "padding:8px 0 7px;font-size:11px;letter-spacing:0.3px;border-bottom:2px solid transparent"),
				function () { showTab(entry[0]); });
			var icon = el("span");
			icon.className = "eagicon eagicon-" + entry[2];
			button.appendChild(icon);
			button.appendChild(el("span", "", entry[1]));
			tabButtons[entry[0]] = button;
			if (ONLY && ONLY.indexOf(entry[0]) < 0) button.style.display = "none";
			tabbar.appendChild(button);
		});
		body.appendChild(tabbar);
		body.appendChild(host);

		buildStatsPage();
		buildDisplayPage();
		buildNetworkPage();
		buildFeaturesPage();

		var buttons = el("div", "display:flex;gap:8px;padding:8px 12px 10px;border-top:1px solid rgba(255,255,255,0.1)");
		buttons.appendChild(clickable(el("div", BUTTON_CSS, "Fullscreen"), function () {
			try {
				if (document.fullscreenElement || document.webkitFullscreenElement) {
					(document.exitFullscreen || document.webkitExitFullscreen).call(document);
				} else {
					var frame = document.getElementById("game_frame") || document.documentElement;
					(frame.requestFullscreen || frame.webkitRequestFullscreen).call(frame);
				}
			} catch (e) {}
		}));
		recordButton = clickable(el("div", BUTTON_CSS, "Record log"), function () {
			if (recording) stopRecording(); else startRecording();
		});
		recordButton.title = "Record 60 seconds of performance data and download it. Click again to stop early.";
		buttons.appendChild(recordButton);
		if (ONLY) buttons.style.display = "none";
		body.appendChild(buttons);

		root.appendChild(body);

		// Keep clicks on the panel away from the game's own handlers.
		["mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "pointerdown",
			"pointerup", "touchstart", "touchend"].forEach(function (type) {
			root.addEventListener(type, function (ev) { ev.stopPropagation(); });
		});
		document.body.appendChild(root);
		body.style.display = open ? "block" : "none";
		showTab(load(TAB_KEY) || "stats");

		// The game puts #game_frame into fullscreen; elements outside it disappear.
		function follow() {
			var full = document.fullscreenElement || document.webkitFullscreenElement;
			var host = full && full.tagName !== "CANVAS" ? full : document.body;
			if (root.parentNode !== host) host.appendChild(root);
			fit();
		}
		document.addEventListener("fullscreenchange", follow);
		document.addEventListener("webkitfullscreenchange", follow);
		window.addEventListener("resize", fit);

		if (navigator.getBattery) {
			navigator.getBattery().then(function (battery) {
				function show() {
					rows.batteryLine.style.display = "flex";
					rows.battery.textContent = Math.round(battery.level * 100) + "%"
						+ (battery.charging ? " charging" : "");
				}
				battery.addEventListener("levelchange", show);
				battery.addEventListener("chargingchange", show);
				show();
			}).catch(function () {});
		}
		fit();
	}

	// ------------------------------------------------------------ measurement
	// requestAnimationFrame callbacks are delayed by the game's own work on the
	// main thread, so their rate follows the rate the game presents frames at.
	var frames = 0, worst = 0, lastFrame = 0, windowStart = 0;
	var fps = 0, worstShown = 0, refresh = 60, fastWindows = 0;
	var lastUp = 0, lastDown = 0;
	function tick(now) {
		trackGameStall(now);
		if (lastFrame) {
			var delta = now - lastFrame;
			if (delta > worst) worst = delta;
			if (delta >= 10000) {
				// The first frame after a hidden tab is shown is just the time it was hidden.
				if (justShown || document.hidden) justShown = false;
				else addEvent({ k: "paused", t: Date.now() - Math.round(delta), v: Math.round(delta / 1000),
					x: "page did not run (computer asleep or frozen)" });
			}
			// A long frame while the page is in view: note it with what the game was showing.
			if (delta > 150 && delta < 10000 && !document.hidden) {
				var where = whereNow();
				// Judged from when the long frame began (lastFrame), not from when it ended: a
				// click that started a 4 second stall is 4 seconds old by the time the frame ends.
				var afterInput = lastInputAt > lastFrame - 1000;
				addEvent({ k: "hitch", t: Date.now(), v: Math.round(delta),
					x: where + (afterInput ? (where ? ", " : "") + "after a click or key" : "") });
			}
		}
		lastFrame = now;
		++frames;
		if (!windowStart) windowStart = now;
		var elapsed = now - windowStart;
		if (elapsed >= 500) {
			fps = frames * 1000 / elapsed;
			worstShown = worst;
			var seconds = elapsed / 1000;
			net.upRate = (net.up - lastUp) / seconds;
			net.downRate = (net.down - lastDown) / seconds;
			lastUp = net.up;
			lastDown = net.down;
			// A window much longer than intended means the tab was hidden or stalled;
			// it says nothing about rendering speed.
			var usable = elapsed < 1500 && !document.hidden;
			if (usable) {
				history.push({ fps: fps, worst: worst });
				if (history.length > HISTORY) history.shift();
				// Displays faster than 60 Hz: learn the refresh rate from sustained readings.
				if (fps > refresh * 1.15) {
					if (++fastWindows >= 3) {
						refresh = [75, 90, 100, 120, 144, 165, 180, 240, 360].reduce(function (best, hz) {
							return Math.abs(hz - fps) < Math.abs(best - fps) ? hz : best;
						}, 360);
						fastWindows = 0;
					}
				} else {
					fastWindows = 0;
				}
				if (auto && autoOn && window.__eaglerGameReady === true) auto.sample(fps, refresh);
			}
			frames = 0;
			worst = 0;
			windowStart = now;
			recordSample();
			update();
		}
		requestAnimationFrame(tick);
	}

	function rate(bytesPerSecond) {
		if (bytesPerSecond >= 1048576) return (bytesPerSecond / 1048576).toFixed(1) + " MB/s";
		if (bytesPerSecond >= 1024) return (bytesPerSecond / 1024).toFixed(0) + " KB/s";
		return Math.round(bytesPerSecond) + " B/s";
	}
	function amount(bytes) {
		if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
		return (bytes / 1024).toFixed(0) + " KB";
	}
	function duration(ms) {
		var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
		s %= 60;
		return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
	}
	function frameColor(ms) {
		return ms <= 20 ? "#55FF55" : ms <= 34 ? WARN : BAD;
	}

	function drawGraph() {
		var ratio = Math.min(nativeRatio(), 2);
		var w = GRAPH_W, h = 46;
		if (graph.width !== Math.round(w * ratio)) {
			graph.width = Math.round(w * ratio);
			graph.height = Math.round(h * ratio);
		}
		var g = graph.getContext("2d");
		g.setTransform(ratio, 0, 0, ratio, 0, 0);
		g.clearRect(0, 0, w, h);
		var top = 66.7;   // ms shown at full height (15 FPS)
		var bar = w / HISTORY;
		for (var i = 0; i < history.length; ++i) {
			var ms = history[i].worst;
			var height = Math.max(1, Math.min(1, ms / top) * h);
			g.fillStyle = frameColor(ms);
			g.fillRect((HISTORY - history.length + i) * bar, h - height, Math.max(1, bar - 1), height);
		}
		var line = h - 16.7 / top * h;
		g.fillStyle = "rgba(255,255,255,0.45)";
		g.fillRect(0, Math.round(line), w, 1);
	}

	// Seconds since anything last arrived on the game's connection, 0 when there
	// is no connection. A live server sends something every second (the time
	// update), so several silent seconds mean the connection is stuck.
	function silentSeconds() {
		refreshConnections();
		return net.open > 0 && net.lastDown ? (performance.now() - net.lastDown) / 1000 : 0;
	}

	// The game draws its own frames; the page keeps running when the game stops (for example
	// while it waits on something), so the long-frame check above cannot see that. The game
	// stamps every frame it finishes in window.__eaglerGame.t, so a stamp that stops changing
	// while the page is still running means the game itself is stuck.
	var lastGameStamp = 0, lastGameChange = 0, gameStall = null, gameStallFrom = 0;
	function trackGameStall(now) {
		var g = window.__eaglerGame;
		if (!g || typeof g.t !== "number" || document.hidden) {
			lastGameChange = now;
			return;
		}
		if (g.t !== lastGameStamp) {
			lastGameStamp = g.t;
			if (gameStall) {
				gameStall.v = Math.round(now - gameStallFrom);
				delete gameStall.open;
				gameStall = null;
				++eventsVersion;
				saveEvents(true);
			}
			lastGameChange = now;
			return;
		}
		var quiet = now - lastGameChange;
		if (quiet < 400) return;
		if (!gameStall) {
			gameStallFrom = lastGameChange;
			var from = whereNow();
			var afterClick = lastInputAt > lastGameChange - 1000;
			gameStall = addEvent({ k: "gamestall", t: Date.now() - Math.round(quiet), v: Math.round(quiet), open: true,
				x: from + (afterClick ? (from ? ", " : "") + "after a click or key" : "") });
		} else {
			gameStall.v = Math.round(quiet);
			++eventsVersion;
			saveEvents(false);
		}
	}

	// ------------------------------------------------------------ path probes
	// While a game connection is open, a tiny request goes out every 5 s to the public internet
	// and to the host of the built-in relay (the Funnel address). They only say whether those can
	// be reached at all; they let a silent connection be told apart: if the internet probe fails
	// too the local network is down, if only the relay host fails the problem is on the way to it.
	var PROBE_MS = 5000, PROBE_TIMEOUT = 4000;
	var relayHost = "";
	try {
		var homeRelay = window.__eaglerHomeServer && window.__eaglerHomeServer.relay;
		var match = /^wss?:\/\/([^\/:?#]+)/i.exec(homeRelay || "");
		if (match) relayHost = match[1];
	} catch (e) {}
	var probes = {
		internet: { label: "internet", urls: ["https://www.gstatic.com/generate_204", "https://1.1.1.1/cdn-cgi/trace"], ok: null, ms: 0, failed: 0, event: null },
		relay: { label: "home relay host", urls: relayHost ? ["https://" + relayHost + "/"] : [], ok: null, ms: 0, failed: 0, event: null }
	};
	function probeOnce(url) {
		return new Promise(function (resolve) {
			var started = performance.now();
			var done = false;
			var timer = setTimeout(function () { if (!done) { done = true; try { controller.abort(); } catch (e) {} resolve(-1); } }, PROBE_TIMEOUT);
			var controller = typeof AbortController === "function" ? new AbortController() : { abort: function () {} };
			try {
				fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "p=" + Date.now(), { mode: "no-cors", cache: "no-store", signal: controller.signal })
					.then(function () { if (!done) { done = true; clearTimeout(timer); resolve(Math.round(performance.now() - started)); } },
						function () { if (!done) { done = true; clearTimeout(timer); resolve(-1); } });
			} catch (e) { done = true; clearTimeout(timer); resolve(-1); }
		});
	}
	function runProbe(probe) {
		if (!probe.urls.length) return;
		Promise.all(probe.urls.map(probeOnce)).then(function (results) {
			var good = results.filter(function (ms) { return ms >= 0; });
			if (good.length) {
				probe.ok = true;
				probe.ms = Math.min.apply(null, good);
				probe.failed = 0;
				if (probe.event) {
					delete probe.event.open;
					probe.event = null;
					++eventsVersion;
					saveEvents(true);
				}
			} else {
				probe.ok = false;
				++probe.failed;
				var seconds = Math.round(probe.failed * PROBE_MS / 1000);
				// Two failed rounds in a row (a lone failure can be a blip) open an event.
				if (probe.failed >= 2) {
					if (!probe.event) probe.event = addEvent({ k: "probe", t: Date.now() - seconds * 1000, v: seconds, open: true, x: probe.label });
					else { probe.event.v = seconds; ++eventsVersion; saveEvents(false); }
				}
			}
		});
	}
	function probeSummary() {
		function word(probe) {
			if (!probe.urls.length) return "";
			return probe.ok === null ? "?" : probe.ok ? "ok" : "FAIL";
		}
		var parts = ["internet " + word(probes.internet)];
		if (probes.relay.urls.length) parts.push("relay host " + word(probes.relay));
		return parts.join(", ");
	}
	try {
		setInterval(function () {
			if (document.hidden || net.open <= 0) return;
			runProbe(probes.internet);
			runProbe(probes.relay);
		}, PROBE_MS);
	} catch (e) {}

	// Opens a "stall" event when nothing has arrived for 5 s, keeps its length up to date
	// and closes it when data flows again or the connection is gone.
	var openStall = null;
	function trackStall(silent) {
		if (silent >= 5) {
			if (!openStall) openStall = addEvent({ k: "stall", t: Date.now() - Math.round(silent * 1000), v: Math.round(silent), open: true, x: probeSummary() });
			else { openStall.v = Math.round(silent); openStall.x = probeSummary(); ++eventsVersion; saveEvents(false); }
		} else if (openStall) {
			delete openStall.open;
			openStall = null;
			++eventsVersion;
			saveEvents(true);
		}
	}

	// A dead connection (see the 11-16 report: data sent, nothing comes back, no error) is only
	// noticed by the browser after minutes. After 15 s without anything arriving, close it and,
	// if the browser does not report the close within 1.5 s, tell the game itself it closed
	// (code 1006), so the game shows its disconnect screen and the player can rejoin at once.
	var AUTODROP_S = 15, shownAt = 0;
	try {
		document.addEventListener("visibilitychange", function () { if (!document.hidden) shownAt = performance.now(); });
	} catch (e) {}
	function autoDrop(silent) {
		var features = window.__eaglerFeatures;
		if (features && features.autoDrop === false) return;
		if (silent < AUTODROP_S || document.hidden || performance.now() - shownAt < 10000) return;
		var victims = liveSockets.filter(function (entry) { return entry.socket.readyState === 1; });
		victims.forEach(function (entry) {
			var socket = entry.socket;
			if (socket.__dropped) return;
			socket.__dropped = true;
			addEvent({ k: "drop", t: Date.now(), v: Math.round(silent), x: probeSummary() });
			try { socket.close(); } catch (e) {}
			setTimeout(function () {
				try { socket.dispatchEvent(new CloseEvent("close", { code: 1006, reason: "", wasClean: false })); } catch (e) {}
			}, 1500);
		});
	}

	function update() {
		if (!root) return;
		var silent = silentSeconds();
		trackStall(silent);
		autoDrop(silent);
		var left = recording ? Math.max(0, Math.ceil((RECORD_MS - (Date.now() - recording.startedAt)) / 1000)) : 0;
		var warnings = [];
		if (silent >= 5) warnings.push("NO DATA " + Math.floor(silent) + "s");
		if (recording) warnings.push("REC " + left + "s");
		pillText.textContent = warnings.join("  ");
		pillText.style.display = warnings.length ? "inline" : "none";
		// A circle with only the icon; a capsule when a warning is shown.
		pill.style.padding = warnings.length ? "0 12px 0 8px" : "0";
		pillText.style.color = BAD;
		if (recordButton) {
			recordButton.textContent = recording ? "Stop (" + left + "s)" : "Record log";
			recordButton.style.background = recording ? "rgba(255,85,85,0.4)" : "";
		}
		if (!open) return;

		eventLists.forEach(function (redraw) { redraw(); });
		drawGraph();
		rows.frame.textContent = worstShown ? worstShown.toFixed(1) + " ms" : "--";
		// The game's own count (the number it shows on screen), handed over by the game itself.
		var game = window.__eaglerGame;
		var hasFps = !!(game && typeof game.fps === "number" && performance.now() - game.t < 2000);
		rows.gameFpsLine.style.display = hasFps ? "flex" : "none";
		if (hasFps) rows.gameFps.textContent = String(game.fps);

		var pool = window.__meshWorkerPool;
		var hasGame = !!(pool && pool.frameEwmaMs > 0);
		rows.gameLine.style.display = hasGame ? "flex" : "none";
		if (hasGame) {
			rows.game.textContent = pool.frameEwmaMs.toFixed(1) + " ms"
				+ (pool.frameP95Ms > 0 ? " (p95 " + pool.frameP95Ms.toFixed(1) + ")" : "");
		}

		var canvas = document.querySelector("._eaglercraftX_canvas_element");
		rows.res.textContent = canvas ? canvas.width + " x " + canvas.height : "--";

		// Counters published by the game's mesh worker pool every frame.
		if (pool) {
			rows.mesh.textContent = (pool.ready | 0) + " ready / " + (pool.spawned | 0) + " started, max "
				+ (pool.workerCeiling | 0);
			rows.meshQueue.textContent = (pool.queuedSections | 0) + " sections, " + (pool.queuedResults | 0) + " results";
			rows.meshFlight.textContent = (pool.inFlight | 0) + " jobs";
			rows.meshDone.textContent = String(Math.round(pool.completedJobs != null ? pool.completedJobs : pool.jobs || 0));
			rows.meshInline.textContent = String(Math.round(pool.inline || 0));
			rows.meshErrors.textContent = (pool.errors | 0) + " errors, " + (pool.cancelledJobs | 0) + " cancelled, "
				+ (pool.shrinks | 0) + " shrinks";
			rows.meshErrors.style.color = pool.errors > 0 ? BAD : "";
		} else {
			rows.mesh.textContent = "not started";
			rows.meshQueue.textContent = rows.meshFlight.textContent = rows.meshDone.textContent = "--";
			rows.meshInline.textContent = rows.meshErrors.textContent = "--";
		}

		var profile = window.__eaglerM1Profile;
		rows.m1.textContent = profile && profile.active ? (profile.kind === "pc" ? "Intel PC" : "M1 Air") : "off";
		var gpuName = profile && profile.gpu ? (window.__eaglerShortGpu ? window.__eaglerShortGpu(profile.gpu) : profile.gpu) : "";
		rows.gpuLine.style.display = gpuName ? "flex" : "none";
		rows.gpu.textContent = gpuName + (profile && profile.integratedGpu ? " (integrated)" : "");
		rows.gpu.style.color = profile && profile.integratedGpu ? WARN : "";
		rows.gpu.title = profile && profile.gpu ? profile.gpu
			+ (profile.integratedGpu ? "\nIf this laptop also has a dedicated GPU, set Chrome to High performance in"
				+ " Windows Settings > System > Display > Graphics." : "") : "";

		if (scale) {
			var chosen = chosenScale();
			var isNative = chosen >= nativeRatio() - 0.001;
			scaleLabel.textContent = isNative ? "Native" : chosen + "x";
			autoButton.style.background = autoOn ? "rgba(91,212,91,0.35)" : "";
			rows.autoState.textContent = autoOn
				? "now " + (+scale.effective().toFixed(2)) + "x"
				: (+scale.effective().toFixed(2)) + "x";
		}

		refreshConnections();
		rows.down.textContent = rate(net.downRate) + " (" + amount(net.down) + ")";
		rows.up.textContent = rate(net.upRate) + " (" + amount(net.up) + ")";
		rows.conn.textContent = net.open > 0
			? (net.host.length > 22 ? net.host.slice(0, 21) + "..." : net.host) + " " + net.connectMs + " ms"
				+ (silent >= 5 ? ", silent " + Math.floor(silent) + "s" : "")
			: "none";
		rows.conn.title = net.open > 0 ? net.host + ", connected in " + net.connectMs + " ms" : "";
		rows.conn.style.color = silent >= 5 ? BAD : "";
		if (rows.probe) {
			rows.probe.textContent = net.open > 0 ? probeSummary() : "-";
			rows.probe.style.color = probes.internet.ok === false || probes.relay.ok === false ? BAD : "";
			rows.probe.title = "Small requests every 5 s to the internet and to the home relay host, to tell where a silent connection breaks";
		}

		rows.time.textContent = duration(Date.now() - startedAt);
	}

	window.__eaglerPerfPanel = {
		net: net,
		createAuto: createAuto,
		startRecording: startRecording,
		stopRecording: stopRecording,
		state: function () {
			return { fps: fps, refresh: refresh, open: open, autoOn: autoOn,
				autoScale: auto ? auto.current() : null, history: history.length };
		}
	};

	function start() {
		try {
			build();
			requestAnimationFrame(tick);
		} catch (e) {
			try { console.warn("[shell] performance panel unavailable: " + e); } catch (x) {}
		}
	}
	if (document.body) start();
	else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
