import { describe, expect, it } from "vitest";
import type { Instr, Node, Parallel, Series } from "../src/ir/types";
import { parseNeutralText } from "../src/parsers/neutralText";
import { NEUTRAL } from "./fixtures/neutral";

function ok(src: string) {
	const r = parseNeutralText(src);
	expect(r.errors).toEqual([]);
	return r.rungs;
}

function body(src: string): Node[] {
	const rungs = ok(src);
	expect(rungs).toHaveLength(1);
	return rungs[0]!.body.items;
}

const instr = (n: Node | undefined): Instr => {
	expect(n?.kind).toBe("instr");
	return n as Instr;
};
const par = (n: Node | undefined): Parallel => {
	expect(n?.kind).toBe("parallel");
	return n as Parallel;
};
const ops = (n: Node | undefined) => instr(n).operands.map((o) => o.value);

/** Strip spans so structural comparisons ignore source positions. */
function shape(n: Node | Series): unknown {
	switch (n.kind) {
		case "instr":
			return [n.op, n.shape, n.variant ?? null, n.operands.map((o) => o.value)];
		case "series":
			return n.items.map(shape);
		case "parallel":
			return { legs: n.legs.map(shape) };
	}
}

function depth(n: Node | Series): number {
	switch (n.kind) {
		case "instr":
			return 0;
		case "series":
			return Math.max(0, ...n.items.map(depth));
		case "parallel":
			return 1 + Math.max(...n.legs.map(depth));
	}
}

describe("neutral text: fixtures", () => {
	it("N1 single contact and coil", () => {
		const items = body(NEUTRAL.N01_single);
		expect(shape({ kind: "series", items })).toEqual([
			["XIC", "contact", "no", ["Start"]],
			["OTE", "coil", null, ["Run"]],
		]);
	});

	it("N2 seal-in branch from the left rail", () => {
		const items = body(NEUTRAL.N02_seal_in);
		expect(items).toHaveLength(3);
		const p = par(items[0]);
		expect(p.legs.map((l) => l.items.map((i) => (i as Instr).operands[0]?.value))).toEqual([
			["Start_PB"],
			["Motor_Run"],
		]);
		expect(instr(items[1]).variant).toBe("nc");
		expect(instr(items[2]).op).toBe("OTE");
	});

	it("N3 nested branches three deep", () => {
		const rung = ok(NEUTRAL.N03_nested)[0]!;
		expect(depth(rung.body)).toBe(3);
	});

	it("N4 output-side branch with mixed outputs", () => {
		const items = body(NEUTRAL.N04_output_branch);
		const p = par(items[1]);
		expect(p.legs.map((l) => instr(l.items[0]).op)).toEqual(["OTE", "OTL", "TON"]);
		expect(instr(p.legs[1]!.items[0]).label).toBe("L");
		expect(instr(p.legs[2]!.items[0]).shape).toBe("box");
	});

	it("N5 empty branch leg is a plain wire", () => {
		const p = par(body(NEUTRAL.N05_empty_leg)[1]);
		expect(p.legs).toHaveLength(2);
		expect(p.legs[1]!.items).toEqual([]);
	});

	it("N6 box inside a branch leg", () => {
		const p = par(body(NEUTRAL.N06_box_in_leg)[1]);
		expect(ops(p.legs[0]!.items[0])).toEqual(["T1", "1000", "0"]);
		expect(p.legs[1]!.items.map((i) => instr(i).op)).toEqual(["XIC", "MOV"]);
	});

	it("N7 subscripts with commas, bit-of-word, UDT members, program scope", () => {
		const items = body(NEUTRAL.N07_operands);
		expect(items.map((i) => ops(i)[0])).toEqual([
			"Arr[3,1].5",
			"Udt.Member.Sub",
			"Tbl[Idx].Bit",
			"Program:MainProgram.Local_Tag",
			"Out[2]",
		]);
	});

	it("N8 expressions with nested parens keep top-level commas only", () => {
		const items = body(NEUTRAL.N08_expressions);
		expect(ops(items[0])).toEqual(["ABS(A-B)>(C*2)"]);
		expect(ops(items[1])).toEqual(["Out", "ABS(A-B)*2+MOD(C,4)"]);
	});

	it("N9 unknown mnemonic (AOI) becomes a box with positional operands", () => {
		const aoi = instr(body(NEUTRAL.N09_aoi)[1]);
		expect(aoi.op).toBe("Valve_AOI");
		expect(aoi.shape).toBe("box");
		expect(ops(aoi)).toEqual(["Valve_01", "Open_Cmd", "Close_Cmd", "?", "?"]);
	});

	it("N10 '?' operands are kept as written", () => {
		const items = body(NEUTRAL.N10_qmarks);
		expect(items.map(ops)).toEqual([["?"], ["Timer_01", "?", "?"], ["?"]]);
	});

	it("N11 very long rung parses as one series", () => {
		expect(body(NEUTRAL.N11_long)).toHaveLength(41);
	});

	it("N12 malformed rungs report line/col and the parser recovers", () => {
		const r = parseNeutralText(NEUTRAL.N12_malformed);
		expect(r.rungs).toHaveLength(6);
		expect(r.rungs.map((g) => g.error === undefined)).toEqual([true, false, false, false, true, false]);
		expect(r.errors).toEqual([
			{ line: 2, col: 21, message: "Branch opened at line 2, col 1 is not closed with ']'." },
			{ line: 3, col: 7, message: "Unexpected ']' with no matching '['." },
			{ line: 4, col: 4, message: "'(' after XIC is not closed." },
			{ line: 6, col: 13, message: "Missing ';' at end of rung." },
		]);
		expect(ops(r.rungs[4]!.body.items[0])).toEqual(["J"]);
	});
});

describe("neutral text: syntax details", () => {
	it("tolerates whitespace, tabs, CRLF, and Studio 5000 spacing before commas", () => {
		const compact = shape(ok("XIC(A)[XIC(B),XIC(C)]OTE(D);")[0]!.body);
		expect(shape(ok("XIC( A ) [ XIC(B) , XIC(C) ]\r\n\tOTE(D) ;")[0]!.body)).toEqual(compact);
		expect(shape(ok("XIC(A)[XIC(B) ,XIC(C) ]OTE(D);")[0]!.body)).toEqual(compact);
	});

	it("flattens a one-leg branch", () => {
		expect(body("[XIC(A)]OTE(B);").map((n) => n.kind)).toEqual(["instr", "instr"]);
	});

	it("parses an empty rung and no-operand instructions", () => {
		expect(ok(";")[0]!.body.items).toEqual([]);
		const nop = instr(body("NOP();")[0]);
		expect(nop.shape).toBe("box");
		expect(nop.operands).toEqual([]);
	});

	it("keeps empty middle operands", () => {
		expect(ops(body("TON(T1,,0);")[0])).toEqual(["T1", "", "0"]);
	});

	it("keeps quoted operands intact, including commas and parens", () => {
		expect(ops(body("COP('a,b)',Dest,1);")[0])).toEqual(["'a,b)'", "Dest", "1"]);
	});

	it("classifies mnemonics case-insensitively but keeps them as written", () => {
		const items = body("xic(a)ote(b);");
		expect(instr(items[0]).shape).toBe("contact");
		expect(instr(items[0]).op).toBe("xic");
		expect(instr(items[1]).shape).toBe("coil");
	});

	it("attaches // lines to the next rung and same-line // to the previous rung", () => {
		const rungs = ok("// first\n// second\nXIC(A)OTE(B); // trailing\n\nXIC(C)OTE(D);\n// orphan at end");
		expect(rungs).toHaveLength(2);
		expect(rungs[0]!.comment).toBe("first\nsecond\ntrailing");
		expect(rungs[1]!.comment).toBeUndefined();
	});

	it("rejects // in the middle of a rung", () => {
		const r = parseNeutralText("XIC(A) // nope\nOTE(B);");
		expect(r.errors[0]).toMatchObject({ line: 1, col: 8 });
		expect(r.errors[0]?.message).toContain("own line");
	});

	it("records instruction spans with 1-based line and column", () => {
		const rungs = ok("XIC(A)OTE(B);\n  XIO(C)OTE(D);");
		const xio = instr(rungs[1]!.body.items[0]);
		expect(xio.span).toMatchObject({ line: 2, col: 3 });
		expect(rungs[1]!.span).toMatchObject({ line: 2, col: 3 });
	});

	it("reports unexpected characters", () => {
		const r = parseNeutralText("XIC(A)$OTE(B);\nXIC(C)OTE(D);");
		expect(r.errors).toEqual([{ line: 1, col: 7, message: "Unexpected '$'." }]);
		expect(r.rungs[1]?.error).toBeUndefined();
	});

	it("reports a mnemonic without parentheses", () => {
		const r = parseNeutralText("XIC A OTE(B);");
		expect(r.errors[0]?.message).toBe("Expected '(' after XIC.");
	});

	it("reports bracket errors inside operands", () => {
		expect(parseNeutralText("XIC(A])OTE(B);").errors[0]?.message).toBe("Unexpected ']' inside XIC(...).");
		expect(parseNeutralText("XIC(A[1)OTE(B);").errors[0]?.message).toBe("Unclosed '[' inside XIC(...).");
	});
});
