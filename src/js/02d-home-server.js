
/*
 * Home server preset.
 *
 * window.__eaglerHomeServer is filled in at build time from local/home-server.json
 * (kept out of the repository) and is null in a plain build. An optional
 * "panel": false in either form builds a copy without the performance panel
 * and start-up banner (see 02b and 02c). Two forms:
 *
 *   { "name": "Home server", "relay": "wss://host", "target": "127.0.0.1:25565", "token": "..." }
 *   { "name": "Home server", "relay": "wss://host", "target": "127.0.0.1:25565",
 *     "enc": { "v": 1, "iter": 600000, "salt": "...", "iv": "...", "data": "..." } }
 *
 * The second form holds the relay token encrypted with a password (PBKDF2-SHA256
 * and AES-GCM, produced by tools/encrypt-token.html), so the HTML file alone does
 * not reveal it. The password is asked for once per browser; after that the
 * token lives in the game's own saved relay list, where the game needs it anyway.
 *
 * The game keeps its relay list in localStorage as base64 JSON under
 * "_eaglercraftX.relay.list.v3" and uses the first multiplayer-capable entry for
 * Java servers. This puts the home relay first, with its token, so nothing has
 * to be typed into the Relays screen. Other saved relays are kept. A brand-new
 * browser profile also gets the game's default public relay as a second entry,
 * which the game would otherwise add itself for LAN worlds.
 *
 * Joining uses the game's own startup link: ?server=<target>&transport=relay.
 * window.__eaglerHomeServerJoin() reloads the page with those parameters.
 * window.__eaglerHomeServerForget() removes the saved token from this browser.
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
	function bytesOf(text) {
		var binary = atob(text), bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}
	function encode(text) {
		var bytes = new TextEncoder().encode(text), binary = "";
		for (var i = 0; i < bytes.length; ++i) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	function readList() {
		try {
			var stored = localStorage.getItem(KEY);
			if (stored === null) return null;
			var list = JSON.parse(new TextDecoder("utf-8").decode(bytesOf(stored)));
			return Array.isArray(list) ? list : [];
		} catch (e) {
			return [];
		}
	}
	function savedEntry() {
		var list = readList() || [];
		for (var i = 0; i < list.length; ++i) {
			if (list[i] && endpoint(list[i].address) === endpoint(config.relay)) return list[i];
		}
		return null;
	}

	// Put the home relay first in the game's saved list.
	function install(token) {
		var entry = { name: config.name || "Home server", address: config.relay, "private": !!token,
			capability: "multiplayer", detected: "multiplayer" };
		if (token) entry.token = token;
		try {
			var list = readList();
			if (list === null) list = [DEFAULT_RELAY];
			list = list.filter(function (item) { return item && endpoint(item.address) !== endpoint(config.relay); });
			list.unshift(entry);
			localStorage.setItem(KEY, encode(JSON.stringify(list)));
			config.installed = true;
		} catch (e) {
			config.installed = false;
		}
		config.token = token || "";
		config.locked = false;
		try { window.dispatchEvent(new Event("eagler-home-server-ready")); } catch (e) {}
	}

	function decrypt(password) {
		var enc = config.enc;
		return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
			.then(function (material) {
				return crypto.subtle.deriveKey(
					{ name: "PBKDF2", hash: "SHA-256", salt: bytesOf(enc.salt), iterations: enc.iter },
					material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
			}).then(function (key) {
				return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesOf(enc.iv) }, key, bytesOf(enc.data));
			}).then(function (plain) {
				return new TextDecoder("utf-8").decode(plain);
			});
	}

	// Ask for the password until it is right or the player gives up.
	function unlock(message) {
		if (!window.crypto || !crypto.subtle) {
			config.error = "This browser cannot decrypt the server token";
			return Promise.resolve(false);
		}
		var password = window.prompt(message || ("Password for " + (config.name || "the home server") + ":"));
		if (password === null || password === "") return Promise.resolve(false);
		return decrypt(password).then(function (token) {
			install(token);
			return true;
		}, function () {
			return unlock("Wrong password. Password for " + (config.name || "the home server") + ":");
		});
	}
	config.unlock = function () { return config.locked ? unlock() : Promise.resolve(true); };

	config.joinParams = function () {
		var params = new URLSearchParams(window.location.search);
		params.set("server", config.target);
		params.set("transport", "relay");
		return "?" + params.toString();
	};
	window.__eaglerHomeServerJoin = function () {
		config.unlock().then(function (ok) {
			if (ok) window.location.search = config.joinParams();
		});
	};
	window.__eaglerHomeServerForget = function () {
		try {
			var list = (readList() || []).filter(function (item) {
				return item && endpoint(item.address) !== endpoint(config.relay);
			});
			localStorage.setItem(KEY, encode(JSON.stringify(list)));
		} catch (e) {}
		config.token = "";
		config.locked = !!config.enc;
	};

	if (config.enc) {
		// Already unlocked in this browser: the game's list still holds the token.
		var saved = savedEntry();
		if (saved && saved.token) {
			install(saved.token);
		} else {
			config.locked = true;
			config.token = "";
			// Only interrupt start-up when this visit is meant to join the server.
			var params = new URLSearchParams(window.location.search);
			if (params.get("server") === config.target && params.get("transport") === "relay") unlock();
		}
	} else {
		install(typeof config.token === "string" ? config.token : "");
	}
})();
