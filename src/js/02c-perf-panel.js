
/*
 * On-screen performance panel.
 *
 * A small pill in the top-left corner shows the frame rate. Clicking it opens a
 * panel with frame time, canvas resolution and mesh worker state, plus
 * buttons that change the render scale while the game is running (see
 * 02b-m1-air-profile.js). Free the mouse with Esc first when in a world.
 *
 * ?panel=0 removes the panel for this visit.
 */
(function () {
	"use strict";
	if (/[?&]panel=0(?:&|$)/.test(window.location.search)) return;
	var OPEN_KEY = "eaglercraft26.perfPanel";

	function el(tag, css, text) {
		var node = document.createElement(tag);
		if (css) node.style.cssText = css;
		if (text) node.textContent = text;
		return node;
	}

	var root, pill, body, rows = {}, scaleButtons = [];
	var open = false;
	try { open = localStorage.getItem(OPEN_KEY) === "open"; } catch (e) {}

	function setOpen(value) {
		open = value;
		body.style.display = open ? "block" : "none";
		try { localStorage.setItem(OPEN_KEY, open ? "open" : "closed"); } catch (e) {}
		update();
	}

	// Plain elements instead of <button>: they never take keyboard focus, so
	// Space or Enter pressed in the game cannot re-trigger them.
	function clickable(node, action) {
		node.style.cursor = "pointer";
		node.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
		node.addEventListener("click", function (ev) { ev.preventDefault(); action(); });
	}

	function row(key, label) {
		var line = el("div", "display:flex;justify-content:space-between;gap:14px");
		line.appendChild(el("span", "opacity:0.7", label));
		rows[key] = el("span", "text-align:right");
		line.appendChild(rows[key]);
		body.appendChild(line);
		return line;
	}

	function build() {
		root = el("div", "position:fixed;z-index:2147483645;left:6px;top:6px;color:#fff;"
			+ "font:11px/1.5 Menlo,Consolas,monospace;user-select:none;-webkit-user-select:none");
		root.id = "eag_perf_panel";
		pill = el("div", "display:inline-block;padding:2px 7px;border-radius:4px;"
			+ "background:rgba(0,0,0,0.55)", "-- FPS");
		clickable(pill, function () { setOpen(!open); });
		root.appendChild(pill);

		body = el("div", "margin-top:4px;padding:7px 9px;border-radius:4px;min-width:190px;"
			+ "background:rgba(0,0,0,0.78)");
		row("frame", "Worst frame");
		rows.gameLine = row("game", "Game frame");
		row("res", "Resolution");
		rows.meshLine = row("mesh", "Mesh workers");
		row("m1", "M1 profile");

		var scale = window.__eaglerRenderScale;
		if (scale && scale.available) {
			body.appendChild(el("div", "margin-top:6px;opacity:0.7", "Render scale"));
			var bar = el("div", "display:flex;gap:4px;margin-top:3px");
			[[1, "1x"], [1.5, "1.5x"], [null, "Native"]].forEach(function (option) {
				var button = el("div", "flex:1;text-align:center;padding:3px 0;border-radius:3px;"
					+ "border:1px solid rgba(255,255,255,0.35)", option[1]);
				clickable(button, function () { scale.set(option[0]); update(); });
				scaleButtons.push({ node: button, value: option[0] });
				bar.appendChild(button);
			});
			body.appendChild(bar);
			body.appendChild(el("div", "margin-top:4px;opacity:0.6;max-width:210px;white-space:normal",
				"Lower scale = faster, less sharp."));
		}
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
		}
		document.addEventListener("fullscreenchange", follow);
		document.addEventListener("webkitfullscreenchange", follow);
	}

	// ---- Measurement ----
	// requestAnimationFrame callbacks are delayed by the game's own work on the
	// main thread, so their rate follows the rate the game presents frames at.
	var frames = 0, worst = 0, lastFrame = 0, windowStart = 0;
	var fps = 0, worstShown = 0;
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
			frames = 0;
			worst = 0;
			windowStart = now;
			update();
		}
		requestAnimationFrame(tick);
	}

	function update() {
		if (!root) return;
		var rounded = Math.round(fps);
		pill.textContent = (fps ? rounded : "--") + " FPS";
		pill.style.color = !fps ? "#fff" : rounded >= 50 ? "#7CFC7C" : rounded >= 30 ? "#FFD95A" : "#FF7A7A";
		if (!open) return;

		rows.frame.textContent = worstShown ? worstShown.toFixed(1) + " ms" : "--";

		var pool = window.__meshWorkerPool;
		var hasGame = !!(pool && pool.frameEwmaMs > 0);
		rows.gameLine.style.display = hasGame ? "flex" : "none";
		if (hasGame) {
			rows.game.textContent = pool.frameEwmaMs.toFixed(1) + " ms"
				+ (pool.frameP95Ms > 0 ? " (p95 " + pool.frameP95Ms.toFixed(1) + ")" : "");
		}

		var canvas = document.querySelector("._eaglercraftX_canvas_element");
		var scale = window.__eaglerRenderScale;
		rows.res.textContent = canvas ? canvas.width + " x " + canvas.height
			+ (scale ? " @" + (+scale.effective().toFixed(2)) + "x" : "") : "--";

		rows.meshLine.style.display = pool ? "flex" : "none";
		if (pool) rows.mesh.textContent = (pool.ready | 0) + " ready, max " + (pool.workerCeiling | 0);

		var profile = window.__eaglerM1Profile;
		rows.m1.textContent = profile && profile.active ? "on" : "off";

		var current = scale ? scale.get() : null;
		for (var i = 0; i < scaleButtons.length; ++i) {
			var active = scaleButtons[i].value === current;
			scaleButtons[i].node.style.background = active ? "rgba(255,255,255,0.28)" : "transparent";
		}
	}

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
