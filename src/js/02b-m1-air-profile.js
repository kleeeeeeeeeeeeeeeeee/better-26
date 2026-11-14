
/*
 * Render scale control and device performance profiles (MacBook Air M1 and an
 * Intel laptop with an integrated GPU).
 *
 * The game reads two browser properties to size itself, both once per frame or
 * at startup, so they can be tuned here without rebuilding the Wasm image:
 *
 *  - window.devicePixelRatio: the canvas backing store is CSS size x DPR. On the
 *    Air's 2x Retina panel a fullscreen canvas is ~5.2M pixels, which the fanless
 *    8-core GPU cannot sustain. Measured on a real M1 Air, 1x and 1.5x run at
 *    about the same frame rate while native 2x fluctuates heavily, so the default
 *    cap is 1.5: roughly half the pixels of native, noticeably sharper than 1x.
 *
 *  - navigator.hardwareConcurrency: the mesh worker pool ceiling is cores - 2,
 *    up to 4. The M1 reports 8 cores but only 4 are performance cores, already
 *    shared by the main thread and the integrated server worker, and every mesh
 *    worker is a separate Wasm-GC heap. Reporting 4 keeps the pool at 2 workers.
 *
 * The render scale cap works on every machine and can be changed while the game
 * runs through window.__eaglerRenderScale (used by the performance panel); the
 * choice is remembered in localStorage. Only the M1 Air gets a default cap of
 * 1.5 and the reduced core count.
 *
 * URL parameters:
 *   ?m1=1            force the M1 profile on (any machine)
 *   ?m1=0            force it off
 *   ?renderscale=N   device pixel ratio cap for this visit, 0.5 to 3
 * ?meshworkers=N still sets an exact mesh worker count as before.
 *
 * A status banner is shown for a few seconds at startup on Macs, so the result
 * can be checked without opening the developer tools.
 */
(function () {
	"use strict";
	var SCALE_KEY = "eaglercraft26.renderScale";
	var params = new URLSearchParams(window.location.search);
	var forced = params.get("m1");
	var forcedPC = params.get("pc");

	function gpuRenderer() {
		try {
			var canvas = document.createElement("canvas");
			// Ask for the same GPU the game asks for (it requests "high-performance"), so
			// that on a laptop with two graphics chips this names the one the game will use.
			var gl = canvas.getContext("webgl2", { powerPreference: "high-performance", antialias: false, alpha: false })
				|| canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
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

	// The GPU the browser actually uses; also shown in the panel and in recorded logs.
	var gpu = gpuRenderer();

	function detect() {
		var isMac = /Mac/.test(navigator.platform || "") && !(navigator.maxTouchPoints > 1);
		if (!isMac) return { match: false, renderer: "", mac: false };
		var renderer = gpu;
		// Chrome and Firefox name the chip; Safari only reports "Apple GPU".
		var named = /Apple M1(?!\s*(Pro|Max|Ultra))/.test(renderer);
		var masked = /^Apple GPU$/.test(renderer) && (navigator.hardwareConcurrency | 0) === 8 && isAirPanel();
		return { match: named || masked, renderer: renderer, mac: true };
	}

	var detected = forced === "1" ? { match: true, renderer: "forced", mac: true }
		: forced === "0" ? { match: false, renderer: "disabled", mac: true } : detect();

	// "ANGLE (Intel, Intel(R) UHD Graphics (0x00004628) Direct3D11 vs_5_0 ps_5_0, D3D11)"
	// -> "Intel(R) UHD Graphics"
	function shortGpu(name) {
		var text = String(name || "").replace(/^ANGLE \(/, "").replace(/\)$/, "");
		var parts = text.split(", ");
		var model = parts.length > 1 ? parts[1] : parts[0];
		var metal = /Metal Renderer: (.+)$/.exec(model);
		if (metal) return metal[1];
		return model.replace(/ \(0x[0-9a-fA-F]+\).*$/, "").replace(/ Direct3D.*$| Metal.*$| Vulkan.*$| OpenGL.*$/, "")
			.replace(/^Intel, /, "") || "unknown";
	}
	window.__eaglerShortGpu = shortGpu;

	// On-screen status, for browsers where the developer console is unavailable.
	function banner(text, seconds) {
		// A build made with "panel": false in its local configuration shows no
		// status interface at all.
		if (window.__eaglerHomeServer && window.__eaglerHomeServer.panel === false) return;
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
				var ms = (seconds || 10) * 1000;
				setTimeout(function () { el.style.opacity = "0"; }, ms - 1000);
				setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
			} catch (e) {}
		}
		if (document.body) show();
		else document.addEventListener("DOMContentLoaded", show, { once: true });
	}

	// Intel laptop with an integrated GPU, 12 logical processors (the user's MSI with an
	// i5-13420H). A browser cannot read the CPU model, so this goes by system, thread
	// count and GPU. If Chrome is using a dedicated GPU instead, this does not match.
	var intelIntegrated = /Intel/i.test(gpu) && /UHD|Iris|HD Graphics|Xe/i.test(gpu);
	function detectPC() {
		return /Win/.test(navigator.platform || "") && (navigator.hardwareConcurrency | 0) === 12 && intelIntegrated;
	}
	var pcActive = !detected.match
		&& (forcedPC === "1" ? true : forcedPC === "0" ? false : detectPC());

	var profile = window.__eaglerM1Profile = {
		active: detected.match || pcActive,
		kind: detected.match ? "m1" : pcActive ? "pc" : null,
		// The panel turns its automatic render scale on by default for this profile.
		defaultAuto: pcActive,
		gpu: gpu,
		integratedGpu: intelIntegrated,
		renderer: detected.renderer || gpu,
		renderScale: null,
		nativePixelRatio: window.devicePixelRatio || 1,
		reportedCores: navigator.hardwareConcurrency | 0
	};

	// ---- Render resolution cap ----
	function validScale(value) {
		value = parseFloat(value);
		return value >= 0.5 && value <= 3 ? value : null;
	}
	// null means "no cap": render at the display's native ratio.
	var cap = validScale(params.get("renderscale"));
	var chosen = cap !== null;
	if (!chosen) {
		var stored = null;
		try { stored = localStorage.getItem(SCALE_KEY); } catch (e) {}
		if (stored === "native") {
			chosen = true;
		} else if (validScale(stored) !== null) {
			cap = validScale(stored);
			chosen = true;
		}
	}
	// Only the profiled machines get a default cap; a stored "native" choice is respected.
	// The Intel laptop's screen is usually at ratio 1, where a cap of 1 changes nothing
	// but keeps a higher Windows display scaling from multiplying the pixel count.
	if (!chosen && detected.match) cap = 1.5;
	else if (!chosen && pcActive) cap = 1;

	var dprDesc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
	if (!dprDesc && window.Window) {
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
	function effectiveRatio() {
		var native = nativeRatio();
		return cap === null ? native : Math.min(native, cap);
	}
	var overrideInstalled = false;
	try {
		Object.defineProperty(window, "devicePixelRatio", {
			configurable: true,
			enumerable: true,
			get: effectiveRatio,
			set: function () {}
		});
		overrideInstalled = true;
	} catch (e) {}

	// The game marks its canvas image-rendering: pixelated. That is only clean for
	// whole-number upscales; smooth the canvas when the ratio is fractional.
	function updateScaling() {
		var ratio = nativeRatio() / effectiveRatio();
		var smooth = Math.abs(ratio - Math.round(ratio)) > 0.01;
		document.documentElement.classList.toggle("eag-smooth-canvas", smooth);
		profile.renderScale = overrideInstalled ? cap : null;
	}
	try {
		var style = document.createElement("style");
		style.textContent = "html.eag-smooth-canvas ._eaglercraftX_canvas_element"
			+ "{image-rendering:auto !important}";
		document.head.appendChild(style);
		window.addEventListener("resize", updateScaling);
	} catch (e) {}
	updateScaling();

	window.__eaglerRenderScale = {
		available: overrideInstalled,
		// Current cap, or null when rendering at the native ratio.
		get: function () { return cap; },
		native: nativeRatio,
		effective: effectiveRatio,
		// The game re-reads devicePixelRatio every frame, so this applies at once.
		// Pass temporary = true for automatic adjustments that should not replace
		// the scale the player chose.
		set: function (value, temporary) {
			cap = value === null ? null : validScale(value);
			if (!temporary) {
				try {
					if (cap === null) localStorage.setItem(SCALE_KEY, "native");
					else localStorage.setItem(SCALE_KEY, String(cap));
				} catch (e) {}
			}
			updateScaling();
			return cap;
		}
	};

	if (!detected.match && !pcActive) {
		if (detected.mac) {
			banner(forced === "0" ? "M1 profile: OFF (?m1=0)"
				: "M1 profile: OFF - this Mac was not detected as an M1 Air (GPU: "
					+ (detected.renderer || "unknown") + "). Add ?m1=1 to the address to force it on.");
		}
		return;
	}

	// ---- Mesh worker ceiling ----
	try {
		Object.defineProperty(navigator, "hardwareConcurrency", {
			configurable: true,
			enumerable: true,
			get: function () { return 4; }
		});
		profile.reportedCores = 4;
	} catch (e) {}

	var workersText = /[?&]meshworkers=[1-4](?:&|$)/.test(window.location.search)
		? "mesh workers set by ?meshworkers" : "mesh workers max 2";
	if (pcActive) {
		banner("PC profile: ON - GPU " + shortGpu(gpu) + (intelIntegrated ? " (integrated)" : "")
			+ ", render scale cap " + (profile.renderScale === null ? "none" : profile.renderScale) + ", " + workersText
			+ (forcedPC === "1" ? " (forced by ?pc=1)" : "")
			+ (intelIntegrated ? ". If this laptop also has an NVIDIA graphics chip, set Chrome to High performance"
				+ " in Windows Settings > System > Display > Graphics, then restart Chrome." : ""), 18);
	} else {
		banner("M1 profile: ON - render scale " + (profile.renderScale === null ? "native" : profile.renderScale)
			+ " (screen is " + profile.nativePixelRatio + "x), " + workersText
			+ (forced === "1" ? " (forced by ?m1=1)" : ""));
	}
	try {
		console.log("[shell] " + (pcActive ? "Intel PC" : "MacBook Air M1") + " profile active: render scale " + profile.renderScale
			+ " (native " + profile.nativePixelRatio + "), cores reported as " + profile.reportedCores
			+ ", GPU " + profile.renderer);
	} catch (e) {}
})();
