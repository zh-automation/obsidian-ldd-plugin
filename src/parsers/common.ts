/**
 * Pieces shared by the front-ends that wrap neutral text (L5X, L5K) and the block renderer.
 */
import type { Rung } from "../ir/types";
import type { ParseMessage } from "./neutralText";

/** A group of rungs drawn as one diagram, e.g. one routine of a full export. */
export interface Section {
	/** Routine name, prefixed with its program or AOI when known. */
	title?: string;
	rungs: Rung[];
}

export interface FrontEndResult {
	sections: Section[];
	/** Positions are 1-based, relative to the text handed to the front-end. */
	errors: ParseMessage[];
	/** Informational messages (skipped routines and the like). */
	notices: string[];
}

export interface Loc {
	line: number;
	col: number;
}

/** Offset to line/column lookup. */
export class LineIndex {
	private readonly starts: number[] = [0];

	constructor(src: string) {
		for (let i = 0; i < src.length; i++) {
			if (src.charCodeAt(i) === 10) this.starts.push(i + 1);
		}
	}

	loc(pos: number): Loc {
		let lo = 0;
		let hi = this.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.starts[mid] ?? 0) <= pos) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo + 1, col: pos - (this.starts[lo] ?? 0) + 1 };
	}
}

/** "34 ST, 1 FBD" from type counts, largest first. */
export function describeCounts(counts: ReadonlyMap<string, number>): string {
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${n} ${k}`)
		.join(", ");
}

export function bump(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}
