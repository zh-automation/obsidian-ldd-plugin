import { describe, expect, it } from "vitest";
import type { Instr, Rung } from "../src/ir/types";
import { parseL5X } from "../src/parsers/l5x";
import { L5X } from "./fixtures/rockwell";

const ops = (r: Rung) => r.body.items.map((n) => (n.kind === "instr" ? n.op : n.kind));

describe("L5X front-end", () => {
	it("X1 single <Rung>: number, comment, and body", () => {
		const r = parseL5X(L5X.X1_single);
		expect(r.errors).toEqual([]);
		expect(r.sections).toHaveLength(1);
		const [rung] = r.sections[0]!.rungs;
		expect(r.sections[0]!.title).toBeUndefined();
		expect(rung!.number).toBe(4);
		expect(rung!.comment).toBe("Valve open command");
		expect(ops(rung!)).toEqual(["XIC", "XIO", "OTE"]);
	});

	it("X2 <RLLContent>: several rungs, multi-line comment, library names", () => {
		const r = parseL5X(L5X.X2_rll_content);
		expect(r.errors).toEqual([]);
		const rungs = r.sections[0]!.rungs;
		expect(rungs.map((g) => g.number)).toEqual([0, 1, 2]);
		expect(rungs[0]!.comment).toBe("Pump start permissive.\nSecond comment line.");
		const ton = rungs[1]!.body.items[1] as Instr;
		expect(ton.operands.map((o) => o.name)).toEqual(["Timer", "Preset", "Accum"]);
		expect((rungs[2]!.body.items[1] as Instr).op).toBe("MOVE");
	});

	it("X3 full document: ladder routines become titled sections, others are skipped with a notice", () => {
		const r = parseL5X(L5X.X3_full_document);
		expect(r.errors).toEqual([]);
		expect(r.sections.map((s) => [s.title, s.rungs.length])).toEqual([
			["Valve_AOI / Logic", 1],
			["MainProgram / MainRoutine", 2],
			["MainProgram / Empty", 0],
		]);
		expect(r.notices).toEqual(["Skipped 2 non-ladder routines (1 ST, 1 FBD)."]);
		const main = r.sections[1]!.rungs;
		expect(main[0]!.comment).toBe("Valve 1 &amp; valve 2 stay literal inside CDATA");
	});

	it("X3 names AOI operands from the definition in the same document", () => {
		const main = parseL5X(L5X.X3_full_document).sections[1]!.rungs;
		const call = main[0]!.body.items[1] as Instr;
		expect(call.op).toBe("Valve_AOI");
		expect(call.operands.map((o) => [o.name, o.value])).toEqual([
			["Valve_AOI", "Valve_01"],
			["Open_Cmd", "Open_Req"],
			["Valve_IO", "Valve_01_IO"],
		]);
	});

	it("X4 keeps non-N rung types", () => {
		const rungs = parseL5X(L5X.X4_edit_types).sections[0]!.rungs;
		expect(rungs.map((g) => g.type)).toEqual([undefined, "I"]);
	});

	it("X5 rung export: draws only Use=\"Target\" rungs, titled by their routine", () => {
		const r = parseL5X(L5X.X5_rung_export);
		expect(r.errors).toEqual([]);
		expect(r.notices).toEqual([]);
		expect(r.sections.map((s) => [s.title, s.rungs.map((g) => g.number)])).toEqual([["MainProgram / MainRoutine", [7]]]);
	});

	it("X6 malformed XML: reports the error position and keeps complete rungs", () => {
		const r = parseL5X(L5X.X6_malformed_xml);
		expect(r.errors).toEqual([{ line: 5, col: 1, message: "XML: Expected </Text> but found </Rung>." }]);
		expect(r.sections[0]!.rungs[0]!.number).toBe(0);
		expect(r.sections[0]!.rungs[0]!.error).toBeUndefined();
	});

	it("X7 neutral-text errors inside CDATA map to block lines and columns", () => {
		const r = parseL5X(L5X.X7_bad_rung_text);
		expect(r.errors).toEqual([{ line: 3, col: 16, message: "Unexpected ']' with no matching '['." }]);
		expect(r.sections[0]!.rungs[0]!.error).toBeDefined();
		expect(r.sections[0]!.rungs[0]!.number).toBe(0);
	});

	it("reports a <Rung> without <Text> as an error rung", () => {
		const r = parseL5X('<Rung Number="3" Type="N"/>');
		expect(r.errors).toEqual([{ line: 1, col: 1, message: "Rung has no <Text> element." }]);
		expect(r.sections[0]!.rungs[0]!.number).toBe(3);
	});

	it("uses <LocalizedComment> when present", () => {
		const r = parseL5X(
			'<Rung Number="0" Type="N"><Comment><LocalizedComment Lang="en-US"><![CDATA[English]]></LocalizedComment></Comment><Text><![CDATA[NOP();]]></Text></Rung>',
		);
		expect(r.sections[0]!.rungs[0]!.comment).toBe("English");
	});
});
