
/*
 * Coordinates readout, drawn by the page from the snapshot the game hands over every
 * frame in window.__eaglerGame (GameStateBridge in the game source; see jade/). Because
 * the drawing is here and not in the game, its look and rules can change without
 * rebuilding the game.
 *
 * Shows exact position, the block the player is in, the facing direction and the biome.
 * Switched by window.__eaglerFeatures.coords and placed by .coordsPos ("tl", "tr", "bl",
 * "br"), both from 02f-features.js and the panel's Mods tab. Stays visible with chat or
 * the pause menu open; hidden with F3 (which shows the same numbers), with F1, outside a
 * world, and when the game stops sending (an older game without the bridge never sends).
 *
 * Runs in every build, including the ones without the panel.
 */
(function () {
	"use strict";
	var MARGIN = 6;
	// Below the panel's round menu button, which sits in the top left corner by default.
	var TOP_LEFT_Y = 48;
	var STALE_MS = 1000;
	var box = null, line1 = null, line2 = null, line3 = null;
	var shown = "", lastCorner = "", lastUpdate = 0;

	function el(tag, css) {
		var node = document.createElement(tag);
		if (css) node.style.cssText = css;
		return node;
	}

	function build() {
		box = el("div", "position:fixed;z-index:2147483640;display:none;pointer-events:none;"
			+ "padding:5px 9px 6px;border-radius:6px;background:rgba(14,16,22,0.72);"
			+ "border:1px solid rgba(255,255,255,0.14);color:#fff;"
			+ "font:600 13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
			+ "font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,0.6);white-space:nowrap");
		box.id = "eag_coords";
		line1 = el("div");
		line2 = el("div", "font-weight:500;color:rgba(255,255,255,0.75)");
		line3 = el("div", "font-weight:500;color:rgba(255,255,255,0.55)");
		box.appendChild(line1);
		box.appendChild(line2);
		box.appendChild(line3);
		document.body.appendChild(box);

		// The game puts #game_frame into fullscreen; elements outside it disappear.
		function follow() {
			var full = document.fullscreenElement || document.webkitFullscreenElement;
			var host = full && full.tagName !== "CANVAS" ? full : document.body;
			if (box.parentNode !== host) host.appendChild(box);
		}
		document.addEventListener("fullscreenchange", follow);
		document.addEventListener("webkitfullscreenchange", follow);
		requestAnimationFrame(tick);
	}

	function fixed1(value) {
		var tenths = Math.round(value * 10);
		var sign = tenths < 0 ? "-" : "";
		tenths = Math.abs(tenths);
		return sign + Math.floor(tenths / 10) + "." + (tenths % 10);
	}

	// Minecraft yaw: 0 faces south (+Z), 90 west (-X), 180 north (-Z), 270 east (+X).
	function facing(yaw) {
		var names = ["South (+Z)", "West (-X)", "North (-Z)", "East (+X)"];
		var index = Math.floor((((yaw % 360) + 360) % 360 + 45) / 90) % 4;
		return names[index];
	}

	// "minecraft:dark_forest" -> "Dark Forest"; other namespaces keep their prefix.
	function prettyName(id) {
		if (!id) return "";
		var parts = String(id).split(":");
		var path = parts.length > 1 ? parts[1] : parts[0];
		var words = path.split(/[_\/]/).map(function (word) {
			return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
		}).join(" ");
		return parts.length > 1 && parts[0] !== "minecraft" ? parts[0] + ": " + words : words;
	}

	function axis(label, color, value) {
		return "<span style=\"color:" + color + "\">" + label + "</span> " + fixed1(value);
	}

	function place(corner) {
		var right = corner.charAt(1) === "r", bottom = corner.charAt(0) === "b";
		box.style.left = right ? "auto" : MARGIN + "px";
		box.style.right = right ? MARGIN + "px" : "auto";
		box.style.top = bottom ? "auto" : (right ? MARGIN : TOP_LEFT_Y) + "px";
		box.style.bottom = bottom ? MARGIN + "px" : "auto";
	}

	function tick(now) {
		requestAnimationFrame(tick);
		// Ten updates a second are plenty for a readout and keep layout work low.
		if (now - lastUpdate < 100) return;
		lastUpdate = now;

		var game = window.__eaglerGame;
		var features = window.__eaglerFeatures || {};
		var visible = features.coords !== false && !!game && game.inWorld === true && !game.debug && !game.hudHidden
			&& typeof game.t === "number" && performance.now() - game.t < STALE_MS;
		box.style.display = visible ? "block" : "none";
		if (!visible) return;

		var corner = features.coordsPos || "tl";
		if (corner !== lastCorner) {
			lastCorner = corner;
			place(corner);
		}
		var text1 = axis("X", "#FF5555", game.x) + "&nbsp;&nbsp;" + axis("Y", "#55FF55", game.y)
			+ "&nbsp;&nbsp;" + axis("Z", "#55FFFF", game.z);
		var text2 = "Block " + game.bx + " " + game.by + " " + game.bz + " \u00b7 " + facing(game.yaw);
		var dimension = game.dimension && game.dimension !== "minecraft:overworld" ? " \u00b7 " + prettyName(game.dimension) : "";
		var text3 = prettyName(game.biome) + dimension;
		var key = text1 + "|" + text2 + "|" + text3;
		if (key === shown) return;
		shown = key;
		line1.innerHTML = text1;
		line2.textContent = text2;
		line3.textContent = text3;
		line3.style.display = text3 ? "block" : "none";
	}

	if (document.body) build();
	else document.addEventListener("DOMContentLoaded", build, { once: true });
})();
