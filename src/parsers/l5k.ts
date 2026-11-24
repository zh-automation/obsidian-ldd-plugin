/**
 * L5K front-end. Accepts routine text pasted from an L5K file, from a few rungs up to a whole
 * controller export:
 *
 *   RC: "First comment line$N"
 *       "second line";
 *   N: XIC(A)OTE(B);
 *
 * - "RC:" is a rung comment made of one or more quoted segments ending with ';'. It attaches to the
 *   next rung. Escapes: $N $L $P (newline), $R (dropped), $T (tab), $Q $" (double quote),
 *   $' (single quote), $$ (dollar), $hh (hex character code).
 * - "N:" is a normal rung; its text is neutral text up to the ';' that ends it (may span lines).
 *   Inside a ROUTINE block, other one- or two-letter prefixes are taken as rungs in an edit state and
 *   keep the prefix as the rung type.
 * - ROUTINE ... END_ROUTINE blocks become sections titled "Program / Routine" (or "AOI / Logic").
 *   ST_ROUTINE, FBD_ROUTINE, and SFC_ROUTINE blocks are skipped with a notice. Every other line
 *   (tags, modules, data types) is ignored. When the text has ROUTINE blocks, RC:/N: are only read
 *   inside them, so a multi-line tag description that happens to start a line with "N:" is not
 *   taken for a rung.
 * - ADD_ON_INSTRUCTION_DEFINITION PARAMETERS blocks name AOI operands (Required := Yes parameters,
 *   in order, after the instance tag), as the L5X front-end does.
 */
import type { Rung } from "../ir/types";
import type { AoiDef } from "../instructions/logix";
import { bump, describeCounts, LineIndex, type FrontEndResult, type Section } from "./common";
import { parseNeutralText, type ParseMessage } from "./neutralText";

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
const SKIPPED_BLOCKS: Record<string, string> = { ST_ROUTINE: "ST", FBD_ROUTINE: "FBD", SFC_ROUTINE: "SFC" };
const OWNER_START: Record<string, string> = {
	PROGRAM: "END_PROGRAM",
	ADD_ON_INSTRUCTION_DEFINITION: "END_ADD_ON_INSTRUCTION_DEFINITION",
	EQUIPMENT_PHASE: "END_EQUIPMENT_PHASE",
};

export function parseL5K(src: string): FrontEndResult {
	return new L5kParser(src).parse();
}

class L5kParser {
	private pos = 0;
	private readonly idx: LineIndex;
	private readonly errors: ParseMessage[] = [];
	private readonly sections: Section[] = [];
	private readonly skipped = new Map<string, number>();
	private loose: Section | undefined;
	private routine: Section | undefined;
	private owner: string | undefined;
	private ownerEnd: string | undefined;
	private pendingComment: string[] = [];
	private readonly aoi: Map<string, AoiDef>;
	private readonly hasRoutines: boolean;

	constructor(private readonly src: string) {
		this.idx = new LineIndex(src);
		this.aoi = collectL5kAoiDefs(src);
		this.hasRoutines = /^[ \t]*ROUTINE\b/m.test(src);
	}

	parse(): FrontEndResult {
		const n = this.src.length;
		while (this.skipWs() < n) {
			const word = this.wordAt(this.pos);
			const afterWord = this.pos + word.length;
			const colon =
				word !== "" && this.src[this.skipBlanks(afterWord)] === ":" && (this.routine !== undefined || !this.hasRoutines);

			if (colon && word === "RC") {
				this.rungComment(this.skipBlanks(afterWord) + 1);
			} else if (colon && (word === "N" || (this.routine !== undefined && /^[A-Za-z]{1,2}$/.test(word)))) {
				this.rung(word, this.skipBlanks(afterWord) + 1);
			} else {
				this.keywordLine(word, afterWord);
			}
		}

		const notices: string[] = [];
		if (this.skipped.size > 0) {
			const total = [...this.skipped.values()].reduce((a, b) => a + b, 0);
			notices.push(`Skipped ${total} non-ladder routine${total === 1 ? "" : "s"} (${describeCounts(this.skipped)}).`);
		}
		if (this.pendingComment.length > 0) notices.push("A rung comment (RC:) at the end has no rung after it.");
		const sections = this.loose ? [this.loose, ...this.sections] : this.sections;
		if (sections.length === 0 && this.errors.length === 0) notices.push("No rungs (N: lines) found.");
		return { sections, errors: this.errors, notices };
	}

	/** ROUTINE / END_ROUTINE / PROGRAM ... or any other line, which is skipped. */
	private keywordLine(word: string, afterWord: number): void {
		const upper = word.toUpperCase();
		if (upper === "ROUTINE") {
			const name = this.wordAt(this.skipBlanks(afterWord));
			const title = [this.owner, name].filter(Boolean).join(" / ");
			this.routine = title ? { title, rungs: [] } : { rungs: [] };
			this.sections.push(this.routine);
		} else if (upper === "END_ROUTINE") {
			this.routine = undefined;
		} else if (OWNER_START[upper]) {
			this.owner = this.wordAt(this.skipBlanks(afterWord)) || undefined;
			this.ownerEnd = OWNER_START[upper];
		} else if (this.ownerEnd !== undefined && upper === this.ownerEnd) {
			this.owner = undefined;
			this.ownerEnd = undefined;
		} else if (SKIPPED_BLOCKS[upper]) {
			bump(this.skipped, SKIPPED_BLOCKS[upper] ?? upper);
			this.skipBlock(`END_${upper}`);
			return;
		}
		this.pos = this.lineEnd(this.pos);
	}

	private rungComment(from: number): void {
		const start = this.pos;
		const parts: string[] = [];
		let p = from;
		for (;;) {
			p = this.skipWsFrom(p);
			const c = this.src[p];
			if (c === '"') {
				const end = this.stringEnd(p);
				if (end < 0) {
					this.error(p, "Quoted text in rung comment (RC:) is not closed.");
					this.pos = this.src.length;
					return;
				}
				parts.push(decodeL5kString(this.src.slice(p + 1, end)));
				p = end + 1;
			} else if (c === ";") {
				p++;
				break;
			} else {
				this.error(c === undefined ? start : p, "Expected quoted text or ';' in rung comment (RC:).");
				this.pos = statementEnd(this.src, p);
				return;
			}
		}
		this.pendingComment.push(parts.join(""));
		this.pos = p;
	}

	private rung(prefix: string, textStart: number): void {
		const semi = statementEnd(this.src, textStart);
		const text = this.src.slice(textStart, semi);
		this.pos = semi;
		const parsed = parseNeutralText(text, { aoi: this.aoi, origin: this.idx.loc(textStart) });
		this.errors.push(...parsed.errors);
		const [first, second] = parsed.rungs;
		if (second?.span) {
			const { line, col } = second.span;
			this.errors.push({ line, col, message: "More than one rung after one N: prefix; only the first is drawn." });
		}
		const rung: Rung = first ?? { body: { kind: "series", items: [] } };
		delete rung.comment;
		if (prefix !== "N") rung.type = prefix;
		if (this.pendingComment.length > 0) {
			rung.comment = this.pendingComment.join("\n");
			this.pendingComment = [];
		}
		this.target().rungs.push(rung);
	}

	private target(): Section {
		if (this.routine) return this.routine;
		this.loose ??= { rungs: [] };
		return this.loose;
	}

	/** Offset of the closing '"' of a string starting at `open`, honoring $ escapes; -1 if none. */
	private stringEnd(open: number): number {
		for (let i = open + 1; i < this.src.length; i++) {
			const c = this.src[i];
			if (c === "$") i++;
			else if (c === '"') return i;
		}
		return -1;
	}

	private skipBlock(endWord: string): void {
		for (;;) {
			this.pos = this.lineEnd(this.pos);
			if (this.skipWs() >= this.src.length) return;
			if (this.wordAt(this.pos).toUpperCase() === endWord) {
				this.pos = this.lineEnd(this.pos);
				return;
			}
		}
	}

	private error(pos: number, message: string): void {
		this.errors.push({ ...this.idx.loc(Math.min(pos, this.src.length)), message });
	}

	private wordAt(p: number): string {
		WORD.lastIndex = p;
		return WORD.exec(this.src)?.[0] ?? "";
	}

	private skipWs(): number {
		this.pos = this.skipWsFrom(this.pos);
		return this.pos;
	}

	private skipWsFrom(p: number): number {
		while (p < this.src.length && /\s/.test(this.src[p] ?? "")) p++;
		return p;
	}

	/** Skip spaces and tabs only. */
	private skipBlanks(p: number): number {
		while (this.src[p] === " " || this.src[p] === "\t") p++;
		return p;
	}

	private lineEnd(p: number): number {
		const e = this.src.indexOf("\n", p);
		return e < 0 ? this.src.length : e + 1;
	}
}

/** Offset just past the ';' that ends a statement (outside quotes), or the end of input. */
function statementEnd(src: string, from: number): number {
	let quote: string | null = null;
	for (let i = from; i < src.length; i++) {
		const c = src[i];
		if (quote !== null) {
			if (c === "$") i++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === ";") {
			return i + 1;
		}
	}
	return src.length;
}

/**
 * AOI definitions in L5K text, keyed by upper-case name:
 *
 *   ADD_ON_INSTRUCTION_DEFINITION Valve_AOI (...)
 *     PARAMETERS
 *       Open_Cmd : BOOL (Usage := Input, Required := Yes, Visible := Yes);
 *     END_PARAMETERS
 */
export function collectL5kAoiDefs(src: string): Map<string, AoiDef> {
	const out = new Map<string, AoiDef>();
	if (!src.includes("ADD_ON_INSTRUCTION_DEFINITION")) return out;
	const defRe = /^[ \t]*ADD_ON_INSTRUCTION_DEFINITION[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm;
	const paramsRe = /^[ \t]*(PARAMETERS|END_ADD_ON_INSTRUCTION_DEFINITION)\b/gm;
	for (const m of src.matchAll(defRe)) {
		const name = m[1] ?? "";
		paramsRe.lastIndex = m.index + m[0].length;
		const pm = paramsRe.exec(src);
		const params: string[] = [];
		if (pm?.[1] === "PARAMETERS") {
			let p = pm.index + pm[0].length;
			for (;;) {
				while (p < src.length && /\s/.test(src[p] ?? "")) p++;
				if (p >= src.length || src.startsWith("END_PARAMETERS", p)) break;
				const end = statementEnd(src, p);
				const stmt = src.slice(p, end);
				const pName = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(stmt)?.[1];
				if (pName && /\bRequired\s*:=\s*Yes\b/i.test(stmt)) params.push(pName);
				p = end;
			}
		}
		out.set(name.toUpperCase(), { name, params });
	}
	return out;
}

/** Decode L5K string escapes ($N, $Q, $', $$, $hh, ...). Unknown escapes are kept as written. */
export function decodeL5kString(s: string): string {
	if (!s.includes("$")) return s;
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c !== "$") {
			out += c;
			continue;
		}
		const d = s[i + 1];
		const hex = s.slice(i + 1, i + 3);
		if (d !== undefined && "NnLlPp".includes(d)) out += "\n";
		else if (d === "R" || d === "r") out += "";
		else if (d === "T" || d === "t") out += "\t";
		else if (d === "Q" || d === "q" || d === '"') out += '"';
		else if (d === "'") out += "'";
		else if (d === "$") out += "$";
		else if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
			out += String.fromCharCode(parseInt(hex, 16));
			i += 2;
			continue;
		} else {
			out += c;
			continue;
		}
		i++;
	}
	return out;
}
