
		(async () => {
			try {
				window.__eagPrepareInlineAssets();
				// Compile once so worker instances can reuse the module.
				let tv;
				try {
					if (typeof window.__eaglerWasmGCInstantiate !== "function") {
						throw new Error("worker-bootstrap.js helper missing");
					}
					let module;
					const meshModulePromise = WebAssembly.compileStreaming(
							fetch("mesh-worker.wasm?v=21b0a73c5a7f5526"), { builtins: ["js-string"] }
						).catch(async (meshStreamErr) => {
							window.__log.push("W:[shell] mesh compileStreaming failed (" + meshStreamErr + "), falling back to byte fetch");
							const meshResp = await fetch("mesh-worker.wasm?v=21b0a73c5a7f5526");
							return WebAssembly.compile(await meshResp.arrayBuffer(), { builtins: ["js-string"] });
						});
					const serverModulePromise = true ? WebAssembly.compileStreaming(
						fetch("server-worker.wasm?v=21b0a73c5a7f5526"), { builtins: ["js-string"] }
					).catch(async (serverStreamErr) => {
						window.__log.push("W:[shell] server compileStreaming failed (" + serverStreamErr + "), falling back to byte fetch");
						try {
							const serverResp = await fetch("server-worker.wasm?v=21b0a73c5a7f5526");
							return await WebAssembly.compile(await serverResp.arrayBuffer(), { builtins: ["js-string"] });
						} catch (serverByteErr) {
							window.__log.push("W:[shell] dedicated server Wasm unavailable (" + serverByteErr + "); using full image for server worker");
							return null;
						}
					}) : Promise.resolve(null);
					try {
						module = await WebAssembly.compileStreaming(fetch("classes.wasm?v=21b0a73c5a7f5526"), { builtins: ["js-string"] });
						window.__log.push("L:[shell] wasm compileStreaming path OK");
					} catch (streamErr) {
						window.__log.push("L:[shell] compileStreaming failed (" + streamErr + "), falling back to byte fetch");
						const resp = await fetch("classes.wasm?v=21b0a73c5a7f5526");
						const bytes = await resp.arrayBuffer();
						window.__log.push("L:[shell] fetched classes.wasm " + bytes.byteLength + " bytes");
						module = await WebAssembly.compile(bytes, { builtins: ["js-string"] });
					}
					// Finish the two worker images concurrently with the full client. Keep the
					// large client module local; worker bootstrap reads the smaller globals.
					const workerModules = await Promise.all([meshModulePromise, serverModulePromise]);
					window.__eaglerWasmModule = module;
					window.__eagReleaseInlineWasm();
					window.__eaglerMeshWasmModule = workerModules[0];
					window.__eaglerServerWasmModule = workerModules[1];
					window.__log.push(true
						? "L:[shell] dedicated mesh + server Wasm compiled"
						: "L:[shell] dedicated mesh Wasm + shared full-image server module compiled");
					window.__eaglerWasmRuntimeURL = null;
					window.__eaglerWasmWorkerBootstrapURL = (window.__eaglerInlineWorkerBlobURL || new URL("worker-bootstrap.js", location.href).href);
					if (typeof window.__eaglerWasmServerWorkerBootstrapURL !== "string") {
						window.__eaglerWasmServerWorkerBootstrapURL = window.__eaglerWasmWorkerBootstrapURL;
					}
					tv = await window.__eaglerWasmGCInstantiate(module, { installImports(i) {} });
				} catch (helperErr) {
					// Fall back to TeaVM loading without workers.
					window.__log.push("W:[shell] compile-once path unavailable (" + helperErr + "); TeaVM.wasmGC.load fallback (workers disabled)");
					window.__eaglerWasmModule = null;
					window.__eaglerMeshWasmModule = null;
					window.__eaglerServerWasmModule = null;
					tv = await TeaVM.wasmGC.load("classes.wasm?v=21b0a73c5a7f5526", { installImports(i) {} });
					window.__log.push("L:[shell] wasm compileStreaming path OK");
				}
				window.__loaded = true;
				window.__eaglerCrashJournal.stage("wasm-instantiated");
				window.__tv = tv; // Exposes Wasm memory to diagnostics.
				window.__log.push("L:[shell] wasm compiled + instantiated");
				const main = tv.exports && tv.exports.main;
				if (typeof main !== "function") { window.__log.push("E:[shell] no exports.main"); return; }

				// Remove the splash after the first frame.
				const load = document.getElementById("loading_screen");
				const t0 = Date.now();
				let eagtekGone = false;
				(function poll() {
					const crashed = document.querySelector("._eaglercraftX_crash_element");
					if (crashed !== null || Date.now() - t0 > 300000) {
						if (load && load.parentNode) { load.parentNode.removeChild(load); }
						document.body.style.backgroundColor = "black";
						return;
					}
					// The first real frame is Minecraft's native red Mojang loading
					// overlay. Fade the 1.8 Wasm-GC shell away to reveal it.
					if (!eagtekGone && window.__eaglerGameReady === true) {
						window.__eaglerCrashJournal.stage("game-ready");
						eagtekGone = true;
						if (load) {
							load.classList.add("is-ready");
							setTimeout(function () { load.style.display = "none"; }, 200);
						}
						document.body.style.backgroundColor = "black";
						return;
					}
					setTimeout(poll, 150);
				})();

				// Let the early-load layer paint before synchronous startup.
				setTimeout(() => {
					try {
						window.__eaglerCrashJournal.stage("java-main");
						main([]);
						window.__log.push("L:[shell] main([]) returned");
					} catch (e) {
						window.__err = (e && (e.name + ": " + e.message)) || String(e);
						console.error("SHELL_ERR " + window.__err + (e && e.stack ? "\n" + e.stack : ""));
						window.__eaglerShowShellCrash(e);
					}
				}, 60);
			} catch (e) {
				window.__err = (e && (e.name + ": " + e.message)) || String(e);
				console.error("SHELL_ERR " + window.__err + (e && e.stack ? "\n" + e.stack : ""));
				window.__eaglerShowShellCrash(e);
			}
		})();
	