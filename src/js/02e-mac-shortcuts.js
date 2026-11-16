
/*
 * Command key shortcuts on a Mac.
 *
 * The game decides which key means "select all / copy / paste / cut" from the
 * operating system name it was built with, and in this build that makes Control
 * the shortcut key even on a Mac, so Command+A, C, V and X do nothing there
 * (the original file behaves the same way). On a Mac this turns Command+A/C/V/X
 * into the Control version before the game sees it. Windows and Linux are not
 * affected, and Control+A/C/V/X keep working on a Mac.
 *
 * The browser never sends the key release of a letter while Command is held, so
 * the Control version is sent as a press followed by a release.
 */
(function () {
	"use strict";
	if (!/Mac/.test(navigator.platform || "") || navigator.maxTouchPoints > 1) return;
	var KEYS = { a: 65, c: 67, v: 86, x: 88 };
	var swallowRelease = {};

	function shortcutKey(ev) {
		var key = (ev.key || "").toLowerCase();
		return KEYS.hasOwnProperty(key) ? key : null;
	}
	function controlVersion(ev, type, key) {
		return new KeyboardEvent(type, { key: ev.key, code: ev.code, keyCode: KEYS[key], which: KEYS[key],
			ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
			bubbles: true, cancelable: true, composed: true, view: window });
	}

	window.addEventListener("keydown", function (ev) {
		if (!ev.isTrusted || !ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
		var key = shortcutKey(ev);
		if (!key) return;
		ev.stopImmediatePropagation();
		var target = ev.target || document;
		var press = controlVersion(ev, "keydown", key);
		target.dispatchEvent(press);
		// Do whatever the game decided for the Control version, so the browser does
		// not also paste or select on its own.
		if (press.defaultPrevented) ev.preventDefault();
		target.dispatchEvent(controlVersion(ev, "keyup", key));
		swallowRelease[key] = true;
	}, true);

	window.addEventListener("keyup", function (ev) {
		if (!ev.isTrusted) return;
		var key = shortcutKey(ev);
		if (key && swallowRelease[key]) {
			delete swallowRelease[key];
			ev.stopImmediatePropagation();
		}
	}, true);
})();
