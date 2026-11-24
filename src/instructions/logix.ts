/**
 * Logix instruction table.
 *
 * M1 scope: only what decides the drawn shape. Contacts and coils are listed; everything else is a
 * box. M2 adds box titles, operand names, status pins, and v36 mnemonic aliases.
 */
import type { InstrShape, InstrVariant } from "../ir/types";

export interface LogixDef {
	shape: InstrShape;
	variant?: InstrVariant;
	/** Text inside the contact or coil symbol. */
	label?: string;
}

const DEFS: Record<string, LogixDef> = {
	// Input instructions drawn as contacts
	XIC: { shape: "contact", variant: "no" },
	XIO: { shape: "contact", variant: "nc" },
	ONS: { shape: "contact", label: "ONS" },
	LBL: { shape: "contact", label: "LBL" },
	// Output instructions drawn as coils
	OTE: { shape: "coil" },
	OTL: { shape: "coil", variant: "latch", label: "L" },
	OTU: { shape: "coil", variant: "unlatch", label: "U" },
	RES: { shape: "coil", label: "RES" },
	JMP: { shape: "coil", label: "JMP" },
	MCR: { shape: "coil", label: "MCR" },
};

const BOX: LogixDef = { shape: "box" };

export function logixDef(op: string): LogixDef {
	return DEFS[op.toUpperCase()] ?? BOX;
}
