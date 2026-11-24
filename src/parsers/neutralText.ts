/**
 * Studio 5000 / Logix neutral text parser.
 *
 *   file        := { lineComment | rung }
 *   rung        := series ";"
 *   series      := { instruction | branch }
 *   branch      := "[" series { "," series } "]"
 *   instruction := MNEMONIC "(" [ operand { "," operand } ] ")"
 *   operand     := raw text up to a top-level "," or ")"   (nested (), [], and quotes tracked)
 *   lineComment := "//" text EOL          (between rungs; attaches to the next rung,
 *                                          or to the previous rung when on the same line as its ';')
 *
 * On a syntax error the parser records the error, skips to the next ';', emits a placeholder rung
 * (so rung numbering stays aligned with the PLC), and continues.
 */
import type { Instr, Node, Operand, Parallel, Rung, Series, SourceSpan } from "../ir/types";
import { logixDef } from "../instructions/logix";

export interface ParseMessage {
	/** 1-based line within the parsed text. */
	line: number;
	/** 1-based column within that line. */
	col: number;
	message: string;
}

export interface NeutralParseResult {
	rungs: Rung[];
	errors: ParseMessage[];
}

export function parseNeutralText(src: string): NeutralParseResult {
	return new NeutralParser(src).parse();
}

class Fail extends Error {
	constructor(
		readonly pos: number,
		message: string,
	) {
		super(message);
	}
}

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

class NeutralParser {
	private pos = 0;
	private readonly lineStarts: number[] = [0];

	constructor(private readonly src: string) {
		for (let i = 0; i < src.length; i++) {
			if (src.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
		}
	}

	parse(): NeutralParseResult {
		const rungs: Rung[] = [];
		const errors: ParseMessage[] = [];
		let pending: string[] = [];
		let lastRungEndLine = -1;

		for (;;) {
			this.skipWs();
			if (this.pos >= this.src.length) break;

			if (this.src.startsWith("//", this.pos)) {
				const line = this.loc(this.pos).line;
				const text = this.readLineComment();
				const prev = rungs[rungs.length - 1];
				if (prev && line === lastRungEndLine) {
					prev.comment = prev.comment ? `${prev.comment}\n${text}` : text;
				} else {
					pending.push(text);
				}
				continue;
			}

			const start = this.pos;
			const comment = pending.length > 0 ? pending.join("\n") : undefined;
			pending = [];
			try {
				const body = this.series();
				this.skipWs();
				const c = this.peek();
				if (c !== ";") {
					if (c === undefined) throw new Fail(this.pos, "Missing ';' at end of rung.");
					if (c === "]") throw new Fail(this.pos, "Unexpected ']' with no matching '['.");
					if (c === ",") throw new Fail(this.pos, "Unexpected ',' outside a branch.");
					throw new Fail(this.pos, `Unexpected '${c}'.`);
				}
				this.pos++;
				rungs.push(withComment({ body, span: this.span(start, this.pos) }, comment));
			} catch (e) {
				if (!(e instanceof Fail)) throw e;
				const { line, col } = this.loc(Math.min(e.pos, this.src.length));
				errors.push({ line, col, message: e.message });
				this.recover();
				rungs.push(
					withComment(
						{ body: { kind: "series", items: [] }, span: this.span(start, this.pos), error: e.message },
						comment,
					),
				);
			}
			lastRungEndLine = this.loc(Math.max(this.pos - 1, 0)).line;
		}

		return { rungs, errors };
	}

	private series(): Series {
		const items: Node[] = [];
		for (;;) {
			this.skipWs();
			const c = this.peek();
			if (c === undefined || c === ";" || c === "]" || c === ",") return { kind: "series", items };
			if (c === "[") {
				const p = this.branch();
				// A one-leg branch draws the same as no branch.
				const only = p.legs.length === 1 ? p.legs[0] : undefined;
				if (only) items.push(...only.items);
				else items.push(p);
			} else if (IDENT_START.test(c)) {
				items.push(this.instruction());
			} else if (this.src.startsWith("//", this.pos)) {
				throw new Fail(this.pos, "Comments ('//') must be on their own line between rungs.");
			} else {
				throw new Fail(this.pos, `Unexpected '${c}'.`);
			}
		}
	}

	private branch(): Parallel {
		const open = this.pos;
		this.pos++;
		const legs: Series[] = [this.series()];
		for (;;) {
			this.skipWs();
			const c = this.peek();
			if (c === ",") {
				this.pos++;
				legs.push(this.series());
			} else if (c === "]") {
				this.pos++;
				return { kind: "parallel", legs };
			} else {
				const o = this.loc(open);
				throw new Fail(this.pos, `Branch opened at line ${o.line}, col ${o.col} is not closed with ']'.`);
			}
		}
	}

	private instruction(): Instr {
		const start = this.pos;
		IDENT.lastIndex = this.pos;
		const m = IDENT.exec(this.src);
		const op = m?.[0] ?? "";
		this.pos += op.length;
		this.skipWs();
		if (this.peek() !== "(") throw new Fail(this.pos, `Expected '(' after ${op}.`);
		const open = this.pos;
		this.pos++;

		const operands: Operand[] = [];
		let cur = "";
		let depthP = 0;
		let depthB = 0;
		let quote: string | null = null;
		for (;;) {
			const c = this.src[this.pos];
			if (c === undefined || (c === ";" && quote === null)) {
				throw new Fail(open, `'(' after ${op} is not closed.`);
			}
			this.pos++;
			if (quote !== null) {
				cur += c;
				if (c === quote) quote = null;
				continue;
			}
			if (c === "'" || c === '"') {
				quote = c;
			} else if (c === "(") {
				depthP++;
			} else if (c === "[") {
				depthB++;
			} else if (c === "]") {
				if (depthB === 0) throw new Fail(this.pos - 1, `Unexpected ']' inside ${op}(...).`);
				depthB--;
			} else if (c === ")") {
				if (depthP === 0) {
					if (depthB > 0) throw new Fail(this.pos - 1, `Unclosed '[' inside ${op}(...).`);
					const v = cur.trim();
					if (operands.length > 0 || v !== "") operands.push({ value: v });
					break;
				}
				depthP--;
			} else if (c === "," && depthP === 0 && depthB === 0) {
				operands.push({ value: cur.trim() });
				cur = "";
				continue;
			}
			cur += c;
		}

		const def = logixDef(op);
		const instr: Instr = { kind: "instr", op, shape: def.shape, operands, span: this.span(start, this.pos) };
		if (def.variant) instr.variant = def.variant;
		if (def.label) instr.label = def.label;
		return instr;
	}

	/** Skip to just past the next ';' (outside quotes), or to the end of input. */
	private recover(): void {
		let quote: string | null = null;
		while (this.pos < this.src.length) {
			const c = this.src[this.pos++];
			if (quote !== null) {
				if (c === quote) quote = null;
			} else if (c === "'" || c === '"') {
				quote = c;
			} else if (c === ";") {
				return;
			}
		}
	}

	private readLineComment(): string {
		const start = this.pos + 2;
		let end = this.src.indexOf("\n", start);
		if (end === -1) end = this.src.length;
		this.pos = end;
		return this.src.slice(start, end).replace(/\r$/, "").replace(/^ /, "").trimEnd();
	}

	private skipWs(): void {
		while (this.pos < this.src.length && /\s/.test(this.src[this.pos] ?? "")) this.pos++;
	}

	private peek(): string | undefined {
		return this.src[this.pos];
	}

	private loc(pos: number): { line: number; col: number } {
		let lo = 0;
		let hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.lineStarts[mid] ?? 0) <= pos) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo + 1, col: pos - (this.lineStarts[lo] ?? 0) + 1 };
	}

	private span(start: number, end: number): SourceSpan {
		const { line, col } = this.loc(start);
		return { start, end, line, col };
	}
}

function withComment(rung: Rung, comment: string | undefined): Rung {
	if (comment !== undefined) rung.comment = comment;
	return rung;
}
