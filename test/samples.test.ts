/// <reference types="node" />
/**
 * Regression run over the real exports in reference/samples/ (gitignored, local only).
 * Skipped when the folder is absent. Failure messages give counts, positions, and error messages
 * only, never rung text or names, so customer identifiers stay out of test output.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Instr, Node, Rung } from "../src/ir/types";
import { layoutRungs } from "../src/layout/layout";
import type { FrontEndResult } from "../src/parsers/common";
import { parseL5K } from "../src/parsers/l5k";
import { parseL5X } from "../src/parsers/l5x";
import { parsePLCopen } from "../src/parsers/plcopen";

const SAMPLES = fileURLToPath(new URL("../reference/samples", import.meta.url));

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = path.join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}

/** Count of <Rung> elements / N: lines by plain text search, as an independent cross-check. */
function rawRungCount(text: string, ext: string): number {
	return ext === ".l5x" ? (text.match(/<Rung\s/g)?.length ?? 0) : (text.match(/^\s*N:/gm)?.length ?? 0);
}

function instrs(n: Node): Instr[] {
	if (n.kind === "instr") return [n];
	if (n.kind === "series") return n.items.flatMap(instrs);
	return n.legs.flatMap(instrs);
}

const everything = existsSync(SAMPLES) ? walk(SAMPLES) : [];
const files = everything.filter((f) => /\.(l5x|l5k)$/i.test(f));
const xmlFiles = everything.filter((f) => /\.xml$/i.test(f));
const results = new Map<string, FrontEndResult>();

describe.skipIf(everything.length === 0)("real samples", () => {
	for (const file of files) {
		const name = path.basename(file);
		const ext = path.extname(file).toLowerCase();

		it(`${name}: every rung parses through the ${ext === ".l5x" ? "L5X" : "L5K"} front-end and lays out`, () => {
			const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
			const t0 = performance.now();
			const r = ext === ".l5x" ? parseL5X(text) : parseL5K(text);
			const t1 = performance.now();
			results.set(file, r);

			expect(r.errors.map((e) => `line ${e.line}, col ${e.col}: ${e.message}`)).toEqual([]);
			const rungs = r.sections.flatMap((s) => s.rungs);
			expect(rungs.length).toBe(rawRungCount(text, ext));

			let prims = 0;
			for (const s of r.sections) {
				const g = layoutRungs(s.rungs.map((g2, i) => ({ ...g2, number: g2.number ?? i })));
				const bad = g.prims.filter((p) => Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v)));
				expect(bad).toHaveLength(0);
				prims += g.prims.length;
			}
			const t2 = performance.now();

			const all = rungs.flatMap((g) => instrs(g.body));
			const boxes = all.filter((i) => i.shape === "box");
			const named = boxes.filter((i) => i.operands.some((o) => o.name));
			console.info(
				`${name}: ${r.sections.length} sections, ${rungs.length} rungs, ${rungs.filter((g) => g.comment).length} comments, ` +
					`${boxes.length} boxes (${named.length} with operand names), parse ${(t1 - t0).toFixed(1)} ms, ` +
					`layout ${(t2 - t1).toFixed(1)} ms, ${prims} prims; ${r.notices.join(" ")}`,
			);
		});
	}

	for (const file of xmlFiles) {
		const name = path.basename(file);
		it(`${name}: every LD network reduces and lays out`, () => {
			const text = readFileSync(file, "utf8").replace(/^﻿/, "");
			const t0 = performance.now();
			const r = parsePLCopen(text);
			const t1 = performance.now();
			expect(r.errors.map((e) => `line ${e.line}, col ${e.col}: ${e.message}`)).toEqual([]);

			// Independent count: CODESYS networktitle markers, else one right rail per rung.
			const titles = text.match(/>networktitle</g)?.length ?? 0;
			const expected = titles > 0 ? titles : (text.match(/<rightPowerRail\b/g)?.length ?? 0);
			const rungs = r.sections.flatMap((s) => s.rungs);
			expect(rungs.length).toBe(expected);
			expect(rungs.filter((g) => g.error)).toHaveLength(0);

			let prims = 0;
			for (const s of r.sections) {
				const g = layoutRungs(s.rungs.map((g2, i) => ({ ...g2, number: i + 1 })), { symbols: "iec", align: "right" });
				const bad = g.prims.filter((p) => Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v)));
				expect(bad).toHaveLength(0);
				prims += g.prims.length;
			}
			const all = rungs.flatMap((g) => instrs(g.body));
			const blocks = all.filter((i) => i.form === "iec");
			console.info(
				`${name}: ${r.sections.length} sections, ${rungs.length} networks, ${all.length} elements, ${blocks.length} blocks ` +
					`(${blocks.filter((b) => b.operands.filter((o) => o.power).length > 1).length} with two power inputs), ` +
					`parse ${(t1 - t0).toFixed(1)} ms, ${prims} prims; ${r.notices.join(" ")}`,
			);
		});
	}

	it("L5K and L5X exports of the same project agree on rung text and comments", () => {
		const l5k = [...results.entries()].filter(([f]) => /\.l5k$/i.test(f));
		let pairs = 0;
		for (const [kFile, k] of l5k) {
			const kRungs = k.sections.flatMap((s) => s.rungs);
			const match = [...results.entries()].find(
				([f, x]) => /\.l5x$/i.test(f) && x.sections.flatMap((s) => s.rungs).length === kRungs.length && x.sections.length === k.sections.length,
			);
			if (!match) continue;
			pairs++;
			const xRungs = match[1].sections.flatMap((s) => s.rungs);
			const norm = (c?: string) => (c ?? "").replace(/\s+$/gm, "").trim();
			const commentDiffs = kRungs.flatMap((g, i) => (norm(g.comment) === norm(xRungs[i]?.comment) ? [] : [i]));
			const bodyDiffs = kRungs.flatMap((g, i) => (JSON.stringify(strip(g)) === JSON.stringify(strip(xRungs[i])) ? [] : [i]));
			expect({ file: path.basename(kFile), commentDiffs, bodyDiffs }).toEqual({ file: path.basename(kFile), commentDiffs: [], bodyDiffs: [] });
			expect(k.sections.map((s) => s.title)).toEqual(match[1].sections.map((s) => s.title));
		}
		console.info(`L5K/L5X pairs compared: ${pairs}`);
	});
});

/** Rung body without source spans (offsets differ between formats). */
function strip(r: Rung | undefined): unknown {
	return JSON.parse(JSON.stringify(r?.body ?? null, (k, v: unknown) => (k === "span" ? undefined : v)));
}
