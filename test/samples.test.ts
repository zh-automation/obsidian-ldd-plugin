/// <reference types="node" />
/**
 * Regression run over the real exports in reference/samples/ (gitignored, local only).
 * Skipped when the folder is absent. Failure messages name the file and rung index only,
 * never rung text, so customer tag names stay out of test output.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Rung } from "../src/ir/types";
import { layoutRungs } from "../src/layout/layout";
import { parseNeutralText } from "../src/parsers/neutralText";

const SAMPLES = fileURLToPath(new URL("../reference/samples", import.meta.url));

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = path.join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}

/** Rung texts from L5X (<Text> CDATA) and L5K (N: lines). */
function rungTexts(file: string): string[] {
	const text = readFileSync(file, "utf8");
	const ext = path.extname(file).toLowerCase();
	if (ext === ".l5x") {
		return [...text.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1] ?? "");
	}
	if (ext === ".l5k") {
		return [...text.matchAll(/^\s*N:\s*(.*)$/gm)].map((m) => m[1] ?? "");
	}
	return [];
}

const files = existsSync(SAMPLES) ? walk(SAMPLES).filter((f) => /\.(l5x|l5k)$/i.test(f)) : [];

describe.skipIf(files.length === 0)("real Rockwell samples", () => {
	for (const file of files) {
		const name = path.basename(file);

		it(`${name}: every rung parses and lays out`, () => {
			const texts = rungTexts(file);
			expect(texts.length).toBeGreaterThan(0);

			const failures: string[] = [];
			const rungs: Rung[] = [];
			const t0 = performance.now();
			texts.forEach((t, i) => {
				const r = parseNeutralText(t);
				if (r.errors.length > 0 || r.rungs.length !== 1) {
					failures.push(`rung index ${i}: ${r.errors[0]?.message ?? `${r.rungs.length} rungs`}`);
					return;
				}
				rungs.push({ ...r.rungs[0]!, number: i });
			});
			const t1 = performance.now();
			const g = layoutRungs(rungs);
			const t2 = performance.now();

			expect(failures).toEqual([]);
			const bad = g.prims.filter((p) => Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v)));
			expect(bad).toHaveLength(0);
			console.info(
				`${name}: ${texts.length} rungs, parse ${(t1 - t0).toFixed(1)} ms, layout ${(t2 - t1).toFixed(1)} ms, ` +
					`${g.prims.length} prims, ${g.width}x${g.height}px`,
			);
		});
	}
});
