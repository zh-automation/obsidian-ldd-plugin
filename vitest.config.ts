import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// The obsidian package ships types only; tests run the plugin against a small stand-in.
		alias: { obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)) },
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
