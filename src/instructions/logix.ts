/**
 * Logix instruction table: drawn shape, box description, operand names, right-side status pins,
 * and input/output role. v36+ mnemonics (EQ, MOVE, LIMIT, ...) map to the same entries and are
 * drawn as written.
 *
 * Operand counts are checked against real exports (reference/samples). Box descriptions and operand
 * names follow the Logix 5000 instruction reference; entries not yet compared with Studio 5000 on
 * screen are listed as [verify] in reference/outline.md section 3.4.
 *
 * Unknown mnemonics (AOIs, instructions not listed) draw as a generic box with positional operands,
 * or with parameter names when the AOI definition is available (see AoiTable).
 */
import type { Instr, InstrShape, InstrVariant, Operand } from "../ir/types";

export type Role = "input" | "output";

export interface LogixDef {
	/** Canonical mnemonic (v35 and earlier spelling). */
	name: string;
	shape: InstrShape;
	role: Role;
	variant?: InstrVariant;
	/** Text inside a contact or coil symbol. */
	label?: string;
	/** Box description shown after the mnemonic. */
	title?: string;
	/** Operand names in neutral text order. */
	operands?: readonly string[];
	/** Name for operands past the end of `operands` (variadic instructions). */
	rest?: string;
	/** Right-side status pins. */
	pins?: readonly string[];
	/** Custom naming for variadic instructions; null hides the operand row. */
	names?: (values: readonly string[]) => (string | null)[];
}

/** AOI parameter names from an L5X <AddOnInstructionDefinition>, keyed by upper-case AOI name. */
export interface AoiDef {
	name: string;
	/** Required parameters in definition order; these are the call's operands after the instance tag. */
	params: readonly string[];
}
export type AoiTable = ReadonlyMap<string, AoiDef>;

type Entry = Omit<LogixDef, "name">;

const contact = (variant?: InstrVariant, label?: string): Entry => ({ shape: "contact", role: "input", variant, label });
const coil = (variant?: InstrVariant, label?: string): Entry => ({ shape: "coil", role: "output", variant, label });
const out = (title: string, operands: readonly string[], extra: Partial<Entry> = {}): Entry => ({
	shape: "box",
	role: "output",
	title,
	operands,
	...extra,
});
const cond = (title: string, operands: readonly string[], extra: Partial<Entry> = {}): Entry => ({
	shape: "box",
	role: "input",
	title,
	operands,
	...extra,
});

const AB = ["Source A", "Source B"] as const;
const ABD = ["Source A", "Source B", "Dest"] as const;
const SD = ["Source", "Dest"] as const;
const TIMER = ["Timer", "Preset", "Accum"] as const;
const COUNTER = ["Counter", "Preset", "Accum"] as const;
const FILE_COPY = ["Source", "Dest", "Length"] as const;

/** JSR(Routine, InputCount, In..., Ret...): the count is not drawn; it splits inputs from returns. */
function jsrNames(values: readonly string[]): (string | null)[] {
	const count = /^\d+$/.test(values[1] ?? "") ? Number(values[1]) : -1;
	return values.map((_, i) => {
		if (i === 0) return "Routine Name";
		if (i === 1) return count >= 0 ? null : "Input Count";
		if (count < 0) return "Parameter";
		return i - 2 < count ? "Input Par" : "Return Par";
	});
}

const DEFS: Record<string, Entry> = {
	// Bit
	XIC: contact("no"),
	XIO: contact("nc"),
	ONS: contact(undefined, "ONS"),
	OTE: coil(),
	OTL: coil("latch", "L"),
	OTU: coil("unlatch", "U"),
	OSR: out("One Shot Rising", ["Storage Bit", "Output Bit"]),
	OSF: out("One Shot Falling", ["Storage Bit", "Output Bit"]),

	// Timer and counter
	TON: out("Timer On Delay", TIMER, { pins: ["EN", "DN"] }),
	TOF: out("Timer Off Delay", TIMER, { pins: ["EN", "DN"] }),
	RTO: out("Retentive Timer On", TIMER, { pins: ["EN", "DN"] }),
	CTU: out("Count Up", COUNTER, { pins: ["CU", "DN"] }),
	CTD: out("Count Down", COUNTER, { pins: ["CD", "DN"] }),
	RES: coil(undefined, "RES"),

	// Compare (input instructions)
	EQU: cond("Equal", AB),
	NEQ: cond("Not Equal", AB),
	LES: cond("Less Than (A<B)", AB),
	LEQ: cond("Less Than or Equal (A<=B)", AB),
	GRT: cond("Greater Than (A>B)", AB),
	GEQ: cond("Greater Than or Equal (A>=B)", AB),
	LIM: cond("Limit Test", ["Low Limit", "Test", "High Limit"]),
	MEQ: cond("Masked Equal", ["Source", "Mask", "Compare"]),
	CMP: cond("Compare", ["Expression"]),

	// Compute and math
	CPT: out("Compute", ["Dest", "Expression"]),
	ADD: out("Add", ABD),
	SUB: out("Subtract", ABD),
	MUL: out("Multiply", ABD),
	DIV: out("Divide", ABD),
	MOD: out("Modulo", ABD),
	XPY: out("X To Power of Y", ["Source X", "Source Y", "Dest"]),
	NEG: out("Negate", SD),
	ABS: out("Absolute Value", SD),
	SQR: out("Square Root", SD),
	SIN: out("Sine", SD),
	COS: out("Cosine", SD),
	TAN: out("Tangent", SD),
	ASN: out("Arc Sine", SD),
	ACS: out("Arc Cosine", SD),
	ATN: out("Arc Tangent", SD),
	LN: out("Natural Log", SD),
	LOG: out("Log Base 10", SD),
	TRN: out("Truncate", SD),
	TOD: out("Convert to BCD", SD),
	FRD: out("Convert to Integer", SD),

	// Move and logical
	MOV: out("Move", SD),
	MVM: out("Masked Move", ["Source", "Mask", "Dest"]),
	CLR: out("Clear", ["Dest"]),
	COP: out("Copy File", FILE_COPY),
	CPS: out("Synchronous Copy File", FILE_COPY),
	FLL: out("File Fill", FILE_COPY),
	BTD: out("Bit Field Distribute", ["Source", "Source Bit", "Dest", "Dest Bit", "Length"]),
	AND: out("Bitwise AND", ABD),
	OR: out("Bitwise OR", ABD),
	XOR: out("Bitwise XOR", ABD),
	NOT: out("Bitwise NOT", SD),
	SWPB: out("Swap Byte", ["Source", "Order Mode", "Dest"]),

	// File
	AVE: out("File Average", ["Array", "Dim. To Vary", "Dest", "Control", "Length", "Position"], { pins: ["EN", "DN", "ER"] }),
	SRT: out("File Sort", ["Array", "Dim. To Vary", "Control", "Length", "Position"], { pins: ["EN", "DN", "ER"] }),

	// Program control
	JSR: out("Jump To Subroutine", [], { names: jsrNames }),
	SBR: cond("Subroutine", [], { rest: "Input Par" }),
	RET: out("Return", [], { rest: "Return Par" }),
	JMP: coil(undefined, "JMP"),
	LBL: contact(undefined, "LBL"),
	MCR: coil(undefined, "MCR"),
	AFI: cond("Always False", []),
	NOP: out("No Operation", []),
	TND: out("Temporary End", []),

	// System and communication
	GSV: out("Get System Value", ["Class Name", "Instance Name", "Attribute Name", "Dest"]),
	SSV: out("Set System Value", ["Class Name", "Instance Name", "Attribute Name", "Source"]),
	MSG: out("Message", ["Message Control"], { pins: ["EN", "DN", "ER"] }),

	// Process control
	PID: out("PID", ["PID", "Process Variable", "Tieback", "Control Variable", "PID Master Loop", "Inhold Bit", "Inhold Value"]),

	// Alarms. In ladder, ALMD's In input comes from the rung condition, so it has no operand.
	ALMD: out("Digital Alarm", ["ALMD", "ProgAck", "ProgReset", "ProgDisable", "ProgEnable"]),
	ALMA: out("Analog Alarm", ["ALMA", "In", "ProgAckAll", "ProgDisable", "ProgEnable"]),
};

/**
 * v36+ mnemonics (IEC 61131-3 / PLCopen names) mapped to the v35 entry.
 * Source: Rockwell, Logix Designer "Updated instruction mnemonics".
 */
export const V36_ALIASES: Readonly<Record<string, string>> = {
	ACOS: "ACS",
	ASIN: "ASN",
	ATAN: "ATN",
	TO_BCD: "TOD",
	BCD_TO: "FRD",
	EQ: "EQU",
	GT: "GRT",
	GE: "GEQ",
	LE: "LEQ",
	LT: "LES",
	LIMIT: "LIM",
	MOVE: "MOV",
	NE: "NEQ",
	SQRT: "SQR",
	TRUNC: "TRN",
	EXPT: "XPY",
};

const TABLE = new Map<string, LogixDef>(Object.entries(DEFS).map(([name, e]) => [name, { name, ...e }]));

/** Table entry for a mnemonic (case-insensitive, v36 aliases resolved), or undefined. */
export function logixDef(op: string): LogixDef | undefined {
	const upper = op.toUpperCase();
	return TABLE.get(V36_ALIASES[upper] ?? upper);
}

/**
 * Fill shape, description, operand names, status pins, and role on a parsed instruction.
 * Unknown mnemonics become generic output boxes, named from `aoi` when the definition is known.
 */
export function applyLogixDef(instr: Instr, aoi?: AoiTable): void {
	const def = logixDef(instr.op);
	if (!def) {
		instr.shape = "box";
		instr.role = "output";
		const a = aoi?.get(instr.op.toUpperCase());
		if (a) nameOperands(instr.operands, [a.name, ...a.params]);
		return;
	}
	instr.shape = def.shape;
	instr.role = def.role;
	if (def.variant) instr.variant = def.variant;
	if (def.label) instr.label = def.label;
	if (def.shape !== "box") return;
	if (def.title) instr.title = def.title;
	if (def.pins) instr.outPins = def.pins.map((name) => ({ name, value: "" }));
	if (def.names) {
		const names = def.names(instr.operands.map((o) => o.value));
		instr.operands.forEach((o, i) => {
			const n = names[i];
			if (n === null) o.hidden = true;
			else if (n !== undefined) o.name = n;
		});
		return;
	}
	nameOperands(instr.operands, def.operands ?? [], def.rest);
}

function nameOperands(operands: Operand[], names: readonly string[], rest?: string): void {
	operands.forEach((o, i) => {
		const n = names[i] ?? rest;
		if (n !== undefined) o.name = n;
	});
}
