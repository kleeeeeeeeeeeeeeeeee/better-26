
/*
 * On-screen performance panel.
 *
 * A small pill shows the frame rate; drag it to move it, click it to open the
 * panel. The panel has:
 *   - a 30 second frame time graph
 *   - frame time, canvas resolution and M1 profile state
 *   - counters of the chunk meshing pipeline (workers, queue, errors)
 *   - a render scale slider and an automatic mode that lowers the scale while
 *     the frame rate is low and raises it again once it has been steady
 *   - network traffic of the game's WebSocket and WebRTC connections
 *   - battery level and play time
 *   - a fullscreen button
 *   - a log recorder that samples everything above for 60 seconds (or until
 *     stopped) and downloads the result as a text file
 * Free the mouse with Esc first when in a world.
 *
 * ?panel=0 removes the panel (and its network counters) for this visit.
 * Internals are exposed on window.__eaglerPerfPanel for diagnostics.
 */
(function () {
	"use strict";
	if (/[?&]panel=0(?:&|$)/.test(window.location.search)) return;
	var KEY = "eaglercraft26.perfPanel";
	var POS_KEY = "eaglercraft26.perfPanel.pos";
	var AUTO_KEY = "eaglercraft26.perfPanel.autoScale";
	// Earlier versions kept a server address, token included, under this key.
	try { localStorage.removeItem("eaglercraft26.perfPanel.server"); } catch (e) {}
	var startedAt = Date.now();

	function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

	// ------------------------------------------------------------ network meter
	// Count bytes on the game's own connections. The wrappers extend the native
	// classes, so instanceof checks, constants and prototypes keep working.
	var net = { up: 0, down: 0, open: 0, host: "", connectMs: 0, upRate: 0, downRate: 0 };
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
							socket.addEventListener("open", function () {
								liveSockets.push({ socket: socket, host: host,
									connectMs: Math.round(performance.now() - created) });
							});
							socket.addEventListener("message", function (ev) { net.down += sizeOf(ev.data); });
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
						channel.addEventListener("message", function (ev) { net.down += sizeOf(ev.data); });
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
		"errors", "cancelled", "shrinks", "heapPressure", "downKBs", "upKBs"];

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
			n(net.downRate / 1024, 1), n(net.upRate / 1024, 1)
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
						var line = "" + arguments[i];
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
			"M1 profile: " + (profile.active ? "on" : "off") + ", GPU: " + (profile.renderer || "?"),
			"render scale: chosen " + (scale ? (scale.get() === null ? "native" : scale.get()) : "n/a")
				+ ", auto " + (autoOn ? "on" : "off"),
			"refresh rate estimate: " + refresh,
			"",
			"mesh pool at start: " + done.poolAtStart,
			"mesh pool at end:   " + snapshot(),
			"",
			"== samples (one per half second, tab separated) ==",
			COLUMNS.join("\t")
		].concat(done.samples, ["", "== game log lines during the recording (" + done.lines.length + ") =="], done.lines)
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
	var BUTTON_CSS = "flex:1;text-align:center;padding:3px 6px;border-radius:3px;"
		+ "border:1px solid rgba(255,255,255,0.35);white-space:nowrap";

	var root, pill, body, graph, rows = {}, slider, scaleLabel, autoButton;
	var open = load(KEY) === "open";
	var autoOn = load(AUTO_KEY) === "on";
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

	function section(title) {
		body.appendChild(el("div", "margin-top:7px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.18);"
			+ "opacity:0.7", title));
	}
	function row(key, label) {
		var line = el("div", "display:flex;justify-content:space-between;gap:14px");
		line.appendChild(el("span", "opacity:0.7", label));
		rows[key] = el("span", "text-align:right");
		rows[key + "Line"] = line;
		line.appendChild(rows[key]);
		body.appendChild(line);
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

	function build() {
		scale = window.__eaglerRenderScale && window.__eaglerRenderScale.available ? window.__eaglerRenderScale : null;
		var pos = null;
		try { pos = JSON.parse(load(POS_KEY)); } catch (e) {}
		root = el("div", "position:fixed;z-index:2147483645;color:#fff;"
			+ "font:11px/1.5 Menlo,Consolas,monospace;user-select:none;-webkit-user-select:none");
		root.id = "eag_perf_panel";
		root.style.left = (pos && pos.x >= 0 ? pos.x : 6) + "px";
		root.style.top = (pos && pos.y >= 0 ? pos.y : 6) + "px";

		pill = el("div", "display:inline-block;padding:2px 7px;border-radius:4px;cursor:grab;"
			+ "background:rgba(0,0,0,0.55);touch-action:none", "-- FPS");
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

		body = el("div", "margin-top:4px;padding:7px 9px;border-radius:4px;width:214px;"
			+ "background:rgba(0,0,0,0.78)");

		graph = el("canvas", "display:block;width:214px;height:46px;margin-bottom:5px;"
			+ "background:rgba(255,255,255,0.06);border-radius:3px");
		graph.title = "Slowest frame in each half second, last 30 seconds. The line marks 60 FPS.";
		body.appendChild(graph);

		row("frame", "Worst frame");
		row("game", "Game frame");
		row("res", "Resolution");
		row("m1", "M1 profile");

		// Chunk meshing pipeline, for diagnosing terrain that stays invisible.
		section("Chunk meshing");
		row("mesh", "Workers");
		row("meshQueue", "Waiting");
		row("meshFlight", "In progress");
		row("meshDone", "Built");
		row("meshInline", "Built inline");
		row("meshErrors", "Errors");

		if (scale) {
			section("Render scale");
			var line = el("div", "display:flex;align-items:center;gap:8px;margin-top:2px");
			slider = el("input", "flex:1;min-width:0;margin:0");
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
			scaleLabel = el("span", "min-width:44px;text-align:right");
			line.appendChild(scaleLabel);
			body.appendChild(line);

			var autoLine = el("div", "display:flex;gap:4px;margin-top:4px");
			autoButton = clickable(el("div", BUTTON_CSS, "Auto"), function () {
				autoOn = !autoOn;
				save(AUTO_KEY, autoOn ? "on" : "off");
				if (autoOn) auto.reset(); else applyScale(chosenScale(), false);
				update();
			});
			autoButton.title = "Lower the scale while the frame rate is low, raise it back when steady";
			autoLine.appendChild(autoButton);
			rows.autoState = el("span", "flex:2;align-self:center;opacity:0.7;text-align:right");
			autoLine.appendChild(rows.autoState);
			body.appendChild(autoLine);

			auto = createAuto({
				floor: 1,
				ceiling: chosenScale,
				apply: function (value) { applyScale(value, true); }
			});
			if (autoOn) auto.reset();
		}

		section("Network");
		row("down", "Download");
		row("up", "Upload");
		row("conn", "Connection");

		section("System");
		row("battery", "Battery");
		rows.batteryLine.style.display = "none";
		row("time", "Play time");

		var buttons = el("div", "display:flex;gap:4px;margin-top:7px");
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
		body.appendChild(buttons);

		root.appendChild(body);

		// Keep clicks on the panel away from the game's own handlers.
		["mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "pointerdown",
			"pointerup", "touchstart", "touchend"].forEach(function (type) {
			root.addEventListener(type, function (ev) { ev.stopPropagation(); });
		});
		document.body.appendChild(root);
		body.style.display = open ? "block" : "none";

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
		if (lastFrame) {
			var delta = now - lastFrame;
			if (delta > worst) worst = delta;
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
						refresh = [75, 90, 120, 144, 165, 240].reduce(function (best, hz) {
							return Math.abs(hz - fps) < Math.abs(best - fps) ? hz : best;
						}, 240);
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
		return ms <= 20 ? "#7CFC7C" : ms <= 34 ? "#FFD95A" : "#FF7A7A";
	}

	function drawGraph() {
		var ratio = Math.min(nativeRatio(), 2);
		var w = 214, h = 46;
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

	function update() {
		if (!root) return;
		var rounded = Math.round(fps);
		var left = recording ? Math.max(0, Math.ceil((RECORD_MS - (Date.now() - recording.startedAt)) / 1000)) : 0;
		pill.textContent = (fps ? rounded : "--") + " FPS" + (recording ? "  REC " + left + "s" : "");
		if (recordButton) {
			recordButton.textContent = recording ? "Stop (" + left + "s)" : "Record log";
			recordButton.style.background = recording ? "rgba(255,90,90,0.45)" : "transparent";
		}
		pill.style.color = !fps ? "#fff" : rounded >= refresh * 0.83 ? "#7CFC7C"
			: rounded >= refresh * 0.5 ? "#FFD95A" : "#FF7A7A";
		if (!open) return;

		drawGraph();
		rows.frame.textContent = worstShown ? worstShown.toFixed(1) + " ms" : "--";

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
			rows.meshErrors.style.color = pool.errors > 0 ? "#FF7A7A" : "";
		} else {
			rows.mesh.textContent = "not started";
			rows.meshQueue.textContent = rows.meshFlight.textContent = rows.meshDone.textContent = "--";
			rows.meshInline.textContent = rows.meshErrors.textContent = "--";
		}

		var profile = window.__eaglerM1Profile;
		rows.m1.textContent = profile && profile.active ? "on" : "off";

		if (scale) {
			var chosen = chosenScale();
			var isNative = chosen >= nativeRatio() - 0.001;
			scaleLabel.textContent = isNative ? "Native" : chosen + "x";
			autoButton.style.background = autoOn ? "rgba(255,255,255,0.28)" : "transparent";
			rows.autoState.textContent = autoOn
				? "now " + (+scale.effective().toFixed(2)) + "x"
				: (+scale.effective().toFixed(2)) + "x";
		}

		refreshConnections();
		rows.down.textContent = rate(net.downRate) + " (" + amount(net.down) + ")";
		rows.up.textContent = rate(net.upRate) + " (" + amount(net.up) + ")";
		rows.conn.textContent = net.open > 0
			? (net.host.length > 22 ? net.host.slice(0, 21) + "..." : net.host) + " " + net.connectMs + " ms"
			: "none";
		rows.conn.title = net.open > 0 ? net.host + ", connected in " + net.connectMs + " ms" : "";

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
