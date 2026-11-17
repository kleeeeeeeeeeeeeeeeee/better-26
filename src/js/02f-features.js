
/*
 * Feature switches for things that are built into the game itself.
 *
 * The game reads window.__eaglerFeatures every frame (ClientFeatures in the game
 * source), so a change here applies at once. The performance panel's Features
 * tab is the interface; the choices are remembered in localStorage.
 *
 *   jade       the "what am I looking at" tooltip at the top of the screen
 *   coords     the coordinates readout
 *   coordsPos  its corner: "tl", "tr", "bl" or "br"
 *   background keep the game running while the tab is hidden (see the end of this file)
 *   autoDrop   close a game connection that has received nothing for 15 s (used by 02c-perf-panel.js)
 *
 * This script runs in every build, including the ones without the panel, so the
 * defaults (everything on, unless the build's local configuration says otherwise) always apply.
 */
(function () {
	"use strict";
	var KEY = "eaglercraft26.features";
	var CORNERS = { tl: 1, tr: 1, bl: 1, br: 1 };
	var state = { jade: true, coords: true, coordsPos: "tl", background: true, autoDrop: true };
	// A build can change the defaults with "features" in its local configuration
	// (local/home-server.json), e.g. {"features": {"coords": false}} for a build without
	// the panel, where the player cannot switch things back on. A choice the player has
	// saved in the panel still wins.
	var preset = window.__eaglerHomeServer && window.__eaglerHomeServer.features;
	if (preset && typeof preset === "object") {
		if (typeof preset.jade === "boolean") state.jade = preset.jade;
		if (typeof preset.coords === "boolean") state.coords = preset.coords;
		if (CORNERS[preset.coordsPos] === 1) state.coordsPos = preset.coordsPos;
	}
	try {
		var saved = JSON.parse(localStorage.getItem(KEY) || "null");
		if (saved && typeof saved === "object") {
			if (typeof saved.jade === "boolean") state.jade = saved.jade;
			if (typeof saved.coords === "boolean") state.coords = saved.coords;
			if (CORNERS[saved.coordsPos] === 1) state.coordsPos = saved.coordsPos;
		}
	} catch (e) {}

	window.__eaglerFeatures = state;
	window.__eaglerFeatureSet = function (name, value) {
		if (name === "jade" || name === "coords" || name === "background" || name === "autoDrop") state[name] = !!value;
		else if (name === "coordsPos" && CORNERS[value] === 1) state.coordsPos = value;
		else return false;
		try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
		return true;
	};

	// ---- keep running in the background
	// A browser stops calling requestAnimationFrame for a hidden tab or a covered window, so the
	// game stops entirely, cannot answer the server's keep-alive, and the server drops the player
	// ("Timed out"). While the page is hidden, a worker's timer (not paused the same way) calls the
	// waiting frame callbacks instead, about 20 times a second. Visible pages behave as before.
	try {
		var nativeRaf = window.requestAnimationFrame.bind(window);
		var nativeCancel = window.cancelAnimationFrame.bind(window);
		var waiting = {};
		var nextId = 1000000000;
		var ticker = null;
		function fire(id, stamp) {
			var entry = waiting[id];
			if (!entry) return;
			delete waiting[id];
			nativeCancel(entry.native);
			entry.callback(typeof stamp === "number" ? stamp : performance.now());
		}
		function startTicker() {
			if (ticker) return;
			try {
				var source = "setInterval(function(){postMessage(0)},50)";
				var url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
				ticker = new Worker(url);
				URL.revokeObjectURL(url);
				ticker.onmessage = function () {
					if (!document.hidden) return;
					Object.keys(waiting).forEach(function (id) { fire(id); });
				};
			} catch (e) { ticker = null; }
		}
		function stopTicker() {
			if (ticker) { try { ticker.terminate(); } catch (e) {} ticker = null; }
		}
		window.requestAnimationFrame = function (callback) {
			if (!state.background) return nativeRaf(callback);
			var id = nextId++;
			waiting[id] = { callback: callback, native: nativeRaf(function (stamp) { fire(id, stamp); }) };
			return id;
		};
		window.cancelAnimationFrame = function (id) {
			var entry = waiting[id];
			if (entry) { delete waiting[id]; nativeCancel(entry.native); }
			else nativeCancel(id);
		};
		function sync() {
			if (document.hidden && state.background) startTicker();
			else stopTicker();
		}
		document.addEventListener("visibilitychange", sync);
		sync();
		window.__eaglerBackground = { active: function () { return !!ticker; } };
	} catch (e) {}

	// The game does not wait for frames with requestAnimationFrame: its green threads yield through
	// setTimeout (teavmAsync.offer in the TeaVM runtime). A browser delays timers in a hidden tab to
	// one a second, and much less after a few minutes, so the game still stalls there. While the page
	// is hidden, setTimeout calls made with a function are carried out by a worker's timers instead,
	// which are not slowed down that way. Calls made while the page is visible are untouched.
	try {
		var nativeSetTimeout = window.setTimeout.bind(window);
		var nativeClearTimeout = window.clearTimeout.bind(window);
		var timerWorker = null;
		var timerCallbacks = {};
		var nextTimerId = 1500000000;
		function startTimerWorker() {
			if (timerWorker) return timerWorker;
			try {
				var source = "var h={};onmessage=function(e){var d=e.data;"
					+ "if(d.c){clearTimeout(h[d.i]);delete h[d.i];return}"
					+ "h[d.i]=setTimeout(function(){delete h[d.i];postMessage(d.i)},d.t)}";
				var url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
				timerWorker = new Worker(url);
				URL.revokeObjectURL(url);
				timerWorker.onmessage = function (event) {
					var callback = timerCallbacks[event.data];
					if (!callback) return;
					delete timerCallbacks[event.data];
					callback();
				};
			} catch (e) { timerWorker = null; }
			return timerWorker;
		}
		window.setTimeout = function (callback, delay) {
			if (!state.background || !document.hidden || typeof callback !== "function") {
				return nativeSetTimeout.apply(window, arguments);
			}
			var worker = startTimerWorker();
			if (!worker) return nativeSetTimeout.apply(window, arguments);
			var extra = Array.prototype.slice.call(arguments, 2);
			var id = nextTimerId++;
			timerCallbacks[id] = function () { callback.apply(window, extra); };
			worker.postMessage({ i: id, t: Math.max(0, +delay || 0) });
			return id;
		};
		window.clearTimeout = function (id) {
			if (timerCallbacks[id]) {
				delete timerCallbacks[id];
				if (timerWorker) timerWorker.postMessage({ i: id, c: 1 });
				return;
			}
			nativeClearTimeout(id);
		};
		window.__eaglerTimerWorker = { active: function () { return !!timerWorker; }, pending: function () { return Object.keys(timerCallbacks).length; } };
	} catch (e) {}
})();
