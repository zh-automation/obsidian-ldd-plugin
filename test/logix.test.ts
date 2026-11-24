import { describe, expect, it } from "vitest";
import type { Instr } from "../src/ir/types";
import { applyLogixDef, logixDef, V36_ALIASES } from "../src/instructions/logix";
import { parseNeutralText } from "../src/parsers/neutralText";

function first(src: string, aoi?: Parameters<typeof applyLogixDef>[1]): Instr {
	const node = parseNeutralText(src, aoi ? { aoi } : {}).rungs[0]?.body.items[0];
	if (node?.kind !== "instr") throw new Error("expected an instruction");
	return node;
}

const names = (i: Instr) => i.operands.map((o) => o.name);

describe("Logix instruction table", () => {
	it("maps every v36 mnemonic to an existing v35 entry", () => {
		for (const [v36, v35] of Object.entries(V36_ALIASES)) {
			expect(logixDef(v36)?.name, v36).toBe(v35);
		}
		expect(Object.keys(V36_ALIASES)).toHaveLength(16);
	});

	it("looks up mnemonics case-insensitively", () => {
		expect(logixDef("move")?.name).toBe("MOV");
		expect(logixDef("Ton")?.title).toBe("Timer On Delay");
		expect(logixDef("Valve_AOI")).toBeUndefined();
	});

	it("names timer operands and adds EN/DN status pins", () => {
		const ton = first("TON(Motor_Delay,5000,0);");
		expect(ton.shape).toBe("box");
		expect(ton.role).toBe("output");
		expect(ton.title).toBe("Timer On Delay");
		expect(names(ton)).toEqual(["Timer", "Preset", "Accum"]);
		expect(ton.outPins?.map((p) => p.name)).toEqual(["EN", "DN"]);
	});

	it("draws v36 names as written with the v35 entry's operand names", () => {
		const eq = first("EQ(A,B)OTE(C);");
		expect(eq.op).toBe("EQ");
		expect(eq.role).toBe("input");
		expect(names(eq)).toEqual(["Source A", "Source B"]);
		expect(names(first("MOVE(0,Dest);"))).toEqual(["Source", "Dest"]);
		expect(names(first("LIMIT(10,Temp,90)OTE(Ok);"))).toEqual(["Low Limit", "Test", "High Limit"]);
	});

	it("marks compare boxes as inputs and math boxes as outputs", () => {
		expect(first("GRT(A,B)OTE(C);").role).toBe("input");
		expect(first("CMP(A>B)OTE(C);").role).toBe("input");
		expect(first("ADD(A,B,C);").role).toBe("output");
	});

	it("hides the JSR input count and splits input and return parameters", () => {
		const simple = first("JSR(Sub_01,0);");
		expect(simple.operands.map((o) => [o.name, o.hidden ?? false])).toEqual([
			["Routine Name", false],
			[undefined, true],
		]);
		const withPars = first("JSR(Sub_01,2,In_A,In_B,Ret_A);");
		expect(names(withPars)).toEqual(["Routine Name", undefined, "Input Par", "Input Par", "Return Par"]);
	});

	it("names ALMD operands without In (it comes from the rung condition in ladder)", () => {
		expect(names(first("ALMD(Alarm_01,Ack_PB,Reset_PB,0,0);"))).toEqual([
			"ALMD",
			"ProgAck",
			"ProgReset",
			"ProgDisable",
			"ProgEnable",
		]);
	});

	it("keeps contact and coil shapes, and labels inside symbols", () => {
		const items = parseNeutralText("XIO(A)ONS(B)OTL(C);").rungs[0]!.body.items as Instr[];
		expect(items.map((i) => [i.shape, i.variant ?? null, i.label ?? null])).toEqual([
			["contact", "nc", null],
			["contact", null, "ONS"],
			["coil", "latch", "L"],
		]);
	});

	it("leaves unknown boxes positional, and names AOI operands when the definition is known", () => {
		const src = "Valve_AOI(Valve_01,Open_Req,Valve_01_IO);";
		expect(names(first(src))).toEqual([undefined, undefined, undefined]);
		const aoi = new Map([["VALVE_AOI", { name: "Valve_AOI", params: ["Open_Cmd", "Valve_IO"] }]]);
		const named = first(src, aoi);
		expect(names(named)).toEqual(["Valve_AOI", "Open_Cmd", "Valve_IO"]);
		expect(named.role).toBe("output");
	});
});
