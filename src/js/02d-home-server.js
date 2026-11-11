
/*
 * Home server preset.
 *
 * window.__eaglerHomeServer is filled in at build time from local/home-server.json
 * (kept out of the repository because it holds the relay token) and is null in a
 * plain build. When present it looks like:
 *
 *   { "name": "Home server", "relay": "wss://host", "token": "...", "target": "127.0.0.1:25565" }
 *
 * The game keeps its relay list in localStorage as base64 JSON under
 * "_eaglercraftX.relay.list.v3" and uses the first multiplayer-capable entry for
 * Java servers. This puts the home relay first, with its token, before the game
 * starts, so nothing has to be typed into the Relays screen. Other saved relays
 * are kept. A brand-new browser profile also gets the game's default public relay
 * as a second entry, which the game would otherwise add itself for LAN worlds.
 *
 * Joining uses the game's own startup link: ?server=<target>&transport=relay.
 * window.__eaglerHomeServerJoin() reloads the page with those parameters.
 */
(function () {
	"use strict";
	var config = window.__eaglerHomeServer;
	if (!config || typeof config.relay !== "string" || typeof config.target !== "string") {
		window.__eaglerHomeServer = null;
		return;
	}
	var KEY = "_eaglercraftX.relay.list.v3";
	var DEFAULT_RELAY = { name: "Heroku public relay", address: "wss://oxer-26-2-relay-c5f9ad499e09.herokuapp.com",
		"private": false, capability: "auto", detected: "both" };

	function endpoint(address) {
		return String(address || "").trim().toLowerCase().replace(/\/+$/, "");
	}
	function decode(text) {
		var binary = atob(text), bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
		return new TextDecoder("utf-8").decode(bytes);
	}
	function encode(text) {
		var bytes = new TextEncoder().encode(text), binary = "";
		for (var i = 0; i < bytes.length; ++i) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}

	var entry = { name: config.name || "Home server", address: config.relay, "private": !!config.token,
		capability: "multiplayer", detected: "multiplayer" };
	if (config.token) entry.token = config.token;

	try {
		var stored = localStorage.getItem(KEY);
		var list = null;
		if (stored !== null) {
			try { list = JSON.parse(decode(stored)); } catch (e) { list = null; }
		}
		if (!Array.isArray(list)) list = stored === null ? [DEFAULT_RELAY] : [];
		list = list.filter(function (item) { return item && endpoint(item.address) !== endpoint(config.relay); });
		list.unshift(entry);
		localStorage.setItem(KEY, encode(JSON.stringify(list)));
		config.installed = true;
	} catch (e) {
		config.installed = false;
	}

	config.joinParams = function () {
		var params = new URLSearchParams(window.location.search);
		params.set("server", config.target);
		params.set("transport", "relay");
		return "?" + params.toString();
	};
	config.isJoining = function () {
		var params = new URLSearchParams(window.location.search);
		return params.get("server") === config.target && params.get("transport") === "relay";
	};
	window.__eaglerHomeServerJoin = function () {
		window.location.search = config.joinParams();
	};
})();
