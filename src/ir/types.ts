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
	/** Rung type code from L5X/L5K when not a normal rung ('N'), e.g. pending or test edits. */
	type?: string;
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
	/**
	 * IEC blocks with more than one power-flow input (CTU's CU and RESET both fed by contacts): the
	 * legs do not join; leg i feeds input pin pins[i] of the block that follows in the series.
	 * Leg 0 feeds the block's main power input.
	 */
	pins?: string[];
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
	/** Box description shown after the mnemonic ('Timer On Delay'). */
	title?: string;
	/** Input (condition) or output instruction. Undefined: contacts are inputs, everything else outputs. */
	role?: "input" | "output";
	/**
	 * "iec": an IEC function block drawn with input pins on the left and output pins on the right
	 * (operands = inputs, outPins = outputs, values outside the box). Otherwise a Logix-style box.
	 */
	form?: "iec";
	/** IEC function block instance name, drawn above the box. */
	instance?: string;
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
	/** Kept for tooltips but not drawn as a box row (e.g. the JSR input count). */
	hidden?: boolean;
	/** IEC block pin that carries rung power (drawn as a wire, no value). */
	power?: boolean;
}
