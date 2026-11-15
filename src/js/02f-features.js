
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
 *
 * This script runs in every build, including the ones without the panel, so the
 * defaults (everything on) always apply.
 */
(function () {
	"use strict";
	var KEY = "eaglercraft26.features";
	var CORNERS = { tl: 1, tr: 1, bl: 1, br: 1 };
	var state = { jade: true, coords: true, coordsPos: "tl" };
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
		if (name === "jade" || name === "coords") state[name] = !!value;
		else if (name === "coordsPos" && CORNERS[value] === 1) state.coordsPos = value;
		else return false;
		try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
		return true;
	};
})();
