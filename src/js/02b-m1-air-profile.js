
/*
 * MacBook Air M1 performance profile.
 *
 * The game reads two browser properties to size itself, both once per frame or
 * at startup, so they can be tuned here without rebuilding the Wasm image:
 *
 *  - window.devicePixelRatio: the canvas backing store is CSS size x DPR. On the
 *    Air's 2x Retina panel a fullscreen canvas is ~5.2M pixels, which the fanless
 *    8-core GPU cannot sustain. Capping the ratio to 1 renders a quarter of the
 *    pixels and upscales by an exact 2x, which stays sharp with pixelated scaling.
 *
 *  - navigator.hardwareConcurrency: the mesh worker pool ceiling is cores - 2,
 *    up to 4. The M1 reports 8 cores but only 4 are performance cores, already
 *    shared by the main thread and the integrated server worker, and every mesh
 *    worker is a separate Wasm-GC heap. Reporting 4 keeps the pool at 2 workers.
 *
 * URL parameters:
 *   ?m1=1            force the profile on (any machine)
 *   ?m1=0            force it off
 *   ?renderscale=N   device pixel ratio cap, 0.5 to 3 (default 1)
 * ?meshworkers=N still sets an exact mesh worker count as before.
 *
 * A status banner is shown for a few seconds at startup on Macs, so the result
 * can be checked without opening the developer tools.
 */
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var forced = params.get("m1");

	function gpuRenderer() {
		try {
			var canvas = document.createElement("canvas");
			var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
			if (!gl) return "";
			var info = gl.getExtension("WEBGL_debug_renderer_info");
			var name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
			var lose = gl.getExtension("WEBGL_lose_context");
			if (lose) lose.loseContext();
			return "" + (name || "");
		} catch (e) {
			return "";
		}
	}

	// Logical resolutions of the 13.3" 2560x1600 panel used by the M1 Air.
	function isAirPanel() {
		var modes = { "1440x900": 1, "1680x1050": 1, "1280x800": 1, "1152x720": 1, "1024x640": 1 };
		return modes[screen.width + "x" + screen.height] === 1 && window.devicePixelRatio >= 2;
	}

	function detect() {
		var isMac = /Mac/.test(navigator.platform || "") && !(navigator.maxTouchPoints > 1);
		if (!isMac) return { match: false, renderer: "", mac: false };
		var renderer = gpuRenderer();
		// Chrome and Firefox name the chip; Safari only reports "Apple GPU".
		var named = /Apple M1(?!\s*(Pro|Max|Ultra))/.test(renderer);
		var masked = /^Apple GPU$/.test(renderer) && (navigator.hardwareConcurrency | 0) === 8 && isAirPanel();
		return { match: named || masked, renderer: renderer, mac: true };
	}

	var detected = forced === "1" ? { match: true, renderer: "forced", mac: true }
		: forced === "0" ? { match: false, renderer: "disabled", mac: true } : detect();

	// On-screen status, for browsers where the developer console is unavailable.
	function banner(text) {
		function show() {
			try {
				var el = document.createElement("div");
				el.id = "eag_m1_profile_banner";
				el.textContent = text;
				el.style.cssText = "position:fixed;z-index:2147483647;left:50%;top:12px;"
					+ "transform:translateX(-50%);max-width:90vw;padding:8px 14px;border-radius:6px;"
					+ "background:rgba(0,0,0,0.8);color:#fff;font:13px/1.4 sans-serif;"
					+ "text-align:center;pointer-events:none;transition:opacity 600ms linear";
				document.body.appendChild(el);
				setTimeout(function () { el.style.opacity = "0"; }, 9000);
				setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 10000);
			} catch (e) {}
		}
		if (document.body) show();
		else document.addEventListener("DOMContentLoaded", show, { once: true });
	}

	var profile = window.__eaglerM1Profile = {
		active: detected.match,
		renderer: detected.renderer,
		renderScale: null,
		nativePixelRatio: window.devicePixelRatio || 1,
		reportedCores: navigator.hardwareConcurrency | 0
	};
	if (!detected.match) {
		if (detected.mac) {
			banner(forced === "0" ? "M1 profile: OFF (?m1=0)"
				: "M1 profile: OFF - this Mac was not detected as an M1 Air (GPU: "
					+ (detected.renderer || "unknown") + "). Add ?m1=1 to the address to force it on.");
		}
		return;
	}

	// ---- Render resolution cap ----
	var cap = parseFloat(params.get("renderscale"));
	if (!(cap >= 0.5 && cap <= 3)) cap = 1;
	profile.renderScale = cap;
	var dprOwner = window;
	var dprDesc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
	if (!dprDesc && window.Window) {
		dprOwner = Window.prototype;
		dprDesc = Object.getOwnPropertyDescriptor(Window.prototype, "devicePixelRatio");
	}
	function nativeRatio() {
		try {
			var value = dprDesc && dprDesc.get ? dprDesc.get.call(window) : profile.nativePixelRatio;
			return value > 0 ? value : 1;
		} catch (e) {
			return profile.nativePixelRatio;
		}
	}
	try {
		Object.defineProperty(window, "devicePixelRatio", {
			configurable: true,
			enumerable: true,
			get: function () { return Math.min(nativeRatio(), cap); },
			set: function () {}
		});
	} catch (e) {
		profile.renderScale = null;
	}
	// The game marks its canvas image-rendering: pixelated. That is only clean for
	// whole-number upscales; smooth the canvas when the ratio is fractional.
	function updateScaling() {
		var ratio = nativeRatio() / Math.min(nativeRatio(), cap);
		var smooth = Math.abs(ratio - Math.round(ratio)) > 0.01;
		document.documentElement.classList.toggle("eag-smooth-canvas", smooth);
	}
	try {
		var style = document.createElement("style");
		style.textContent = "html.eag-smooth-canvas ._eaglercraftX_canvas_element"
			+ "{image-rendering:auto !important}";
		document.head.appendChild(style);
		updateScaling();
		window.addEventListener("resize", updateScaling);
	} catch (e) {}

	// ---- Mesh worker ceiling ----
	try {
		Object.defineProperty(navigator, "hardwareConcurrency", {
			configurable: true,
			enumerable: true,
			get: function () { return 4; }
		});
		profile.reportedCores = 4;
	} catch (e) {}

	banner("M1 profile: ON - render scale " + (profile.renderScale === null ? "unchanged" : profile.renderScale)
		+ " (screen is " + profile.nativePixelRatio + "x), mesh workers max 2"
		+ (forced === "1" ? " (forced by ?m1=1)" : ""));
	try {
		console.log("[shell] MacBook Air M1 profile active: render scale " + profile.renderScale
			+ " (native " + profile.nativePixelRatio + "), cores reported as " + profile.reportedCores
			+ ", GPU " + profile.renderer);
	} catch (e) {}
})();
