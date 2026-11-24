/**
 * Intermediate representation shared by every front-end (neutral text, L5X, L5K, PLCopen XML).
 * Front-ends produce Rung[]; the layout engine and renderer only ever see this IR.
 */

/** Position of a construct in the code block source. Lines and columns are 1-based. */
export interface SourceSpan {
	start: number;
	end: number;
	line: number;
	col: number;
}

export interface Rung {
	number?: number;
	comment?: string;
	body: Series;
	span?: SourceSpan;
	/** Set when the rung could not be parsed; body is then empty. */
	error?: string;
}

export type Node = Series | Parallel | Instr;

/** Elements left to right. */
export interface Series {
	kind: "series";
	items: Node[];
}

/** Branch legs top to bottom. An empty leg (items: []) is a plain wire. */
export interface Parallel {
	kind: "parallel";
	legs: Series[];
}

export type InstrShape = "contact" | "coil" | "box";

export type InstrVariant = "no" | "nc" | "pos" | "neg" | "set" | "reset" | "latch" | "unlatch";

export interface Instr {
	kind: "instr";
	/** Mnemonic as written ('XIC', 'TON', 'MyAOI') or IEC element kind ('contact', 'coil'). */
	op: string;
	shape: InstrShape;
	variant?: InstrVariant;
	/** Text drawn inside a contact or coil symbol ('L', 'U', 'ONS', 'RES'). */
	label?: string;
	/** Positional (Logix) or named (IEC block pins) operands. */
	operands: Operand[];
	/** Right-side status or output pins (EN, DN, Q, ET). */
	outPins?: Operand[];
	/** Pin that receives rung power (EN, IN). Undefined means implicit. */
	powerIn?: string;
	/** Pin that continues the rung (ENO, Q). Undefined means implicit. */
	powerOut?: string;
	span?: SourceSpan;
}

export interface Operand {
	name?: string;
	value: string;
}
