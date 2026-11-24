import { describe, expect, it } from "vitest";
import type { Instr } from "../src/ir/types";
import { collectL5kAoiDefs, decodeL5kString, parseL5K } from "../src/parsers/l5k";
import { L5K } from "./fixtures/rockwell";

describe("L5K front-end", () => {
	it("K1 N: lines only become one untitled section", () => {
		const r = parseL5K(L5K.K1_rungs_only);
		expect(r.errors).toEqual([]);
		expect(r.sections).toHaveLength(1);
		expect(r.sections[0]!.title).toBeUndefined();
		expect(r.sections[0]!.rungs).toHaveLength(2);
		expect(r.sections[0]!.rungs.every((g) => g.number === undefined)).toBe(true);
	});

	it("K2 RC: joins quoted segments, decodes escapes, and attaches to the next rung", () => {
		const r = parseL5K(L5K.K2_comment_escapes);
		expect(r.errors).toEqual([]);
		expect(r.sections[0]!.rungs[0]!.comment).toBe("Pump permissive\nUses \"quoted\" text, it's 100$ sure");
	});

	it("K3 ROUTINE blocks become titled sections; ST routines are skipped", () => {
		const r = parseL5K(L5K.K3_routine_wrapper);
		expect(r.errors).toEqual([]);
		expect(r.sections.map((s) => [s.title, s.rungs.length])).toEqual([["MainProgram / MainRoutine", 2]]);
		expect(r.sections[0]!.rungs[0]!.comment).toBe("Start");
		expect(r.notices).toEqual(["Skipped 1 non-ladder routine (1 ST)."]);
	});

	it("K4 rungs may span lines; errors map to block positions", () => {
		const r = parseL5K(L5K.K4_multiline_error);
		expect(r.errors).toEqual([{ line: 2, col: 24, message: "Branch opened at line 2, col 4 is not closed with ']'." }]);
		const rungs = r.sections[0]!.rungs;
		expect(rungs).toHaveLength(2);
		expect(rungs[0]!.error).toBeDefined();
		expect(rungs[1]!.error).toBeUndefined();
	});

	it("K5 non-N prefixes inside a routine keep their code as the rung type", () => {
		const rungs = parseL5K(L5K.K5_edit_prefix).sections[0]!.rungs;
		expect(rungs.map((g) => g.type)).toEqual([undefined, "I"]);
	});

	it("K6 names AOI operands from PARAMETERS and ignores N: lines outside routines", () => {
		const r = parseL5K(L5K.K6_aoi_and_description);
		expect(r.errors).toEqual([]);
		expect(r.sections.map((s) => [s.title, s.rungs.length])).toEqual([["MainProgram / MainRoutine", 1]]);
		const call = r.sections[0]!.rungs[0]!.body.items[1] as Instr;
		expect(call.operands.map((o) => o.name)).toEqual(["Valve_AOI", "Open_Cmd", "Valve_IO"]);
		expect(collectL5kAoiDefs(L5K.K6_aoi_and_description).get("VALVE_AOI")?.params).toEqual(["Open_Cmd", "Valve_IO"]);
	});

	it("reports an unterminated comment and an orphan comment at the end", () => {
		expect(parseL5K('RC: "open').errors[0]?.message).toBe("Quoted text in rung comment (RC:) is not closed.");
		expect(parseL5K('N: XIC(A)OTE(B);\nRC: "dangling";').notices).toEqual([
			"A rung comment (RC:) at the end has no rung after it.",
		]);
	});

	it("decodes the L5K escape set", () => {
		expect(decodeL5kString("a$Nb$Lc$Td$Re$$f$'g$Qh$\"i$41$Zj")).toBe("a\nb\nc\tde$f'g\"h\"iA$Zj");
	});
});
