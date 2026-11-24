import esbuild from "esbuild";
import process from "node:process";
import path from "node:path";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";

const prod = process.argv[2] === "production";
const PLUGIN_ID = "ladder-logic-diagrams";

// Where the built plugin is copied after each build. Defaults to the in-repo dev vault;
// set OBSIDIAN_PLUGIN_DIR to point at <your vault>/.obsidian/plugins/ladder-logic-diagrams instead.
const pluginDir =
	process.env.OBSIDIAN_PLUGIN_DIR ?? path.join("test-vault", ".obsidian", "plugins", PLUGIN_ID);

const copyToVault = {
	name: "copy-to-vault",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			mkdirSync(pluginDir, { recursive: true });
			for (const file of ["main.js", "manifest.json", "styles.css"]) {
				copyFileSync(file, path.join(pluginDir, file));
			}
			console.log(`[ldd] build copied to ${pluginDir}`);
		});
	},
};

const context = await esbuild.context({
	banner: { js: "/* Ladder Logic Diagrams. Bundled with esbuild; see src/ for sources. */" },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
	plugins: [copyToVault],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
