import { describe, expect, it } from "vitest";
import type { Instr, Node, Rung } from "../src/ir/types";
import { parsePLCopen } from "../src/parsers/plcopen";
import { PLCOPEN } from "./fixtures/plcopen";

/** Compact text form of a rung body, as in the series-parallel tests, with variants. */
function show(nodes: Node[]): string {
	return nodes
		.map((n) => {
			if (n.kind === "instr") {
				const v = n.variant && n.variant !== "no" ? `:${n.variant}` : "";
				return n.shape === "box" ? n.op : `${n.shape === "contact" ? "C" : "Y"}(${n.operands[0]?.value ?? ""})${v}`;
			}
			if (n.kind === "series") return show(n.items);
			return `[${n.legs.map((l, i) => show(l.items) + (n.pins ? `>${n.pins[i]}` : "")).join(" | ")}]`;
		})
		.join(" ");
}

const bodies = (src: string) => parsePLCopen(src).sections.flatMap((s) => s.rungs.map((r) => show(r.body.items)));
const box = (r: Rung, op: string) => r.body.items.find((n): n is Instr => n.kind === "instr" && n.op === op)!;

describe("PLCopen front-end", () => {
	it("P1 contact, negated contact, and coil", () => {
		const r = parsePLCopen(PLCOPEN.P1_contact_coil);
		expect(r.errors).toEqual([]);
		expect(r.sections.map((s) => s.title)).toEqual([undefined]);
		expect(bodies(PLCOPEN.P1_contact_coil)).toEqual(["C(stInputs.xReady) C(stInputs.xFault):nc Y(aSteps[10].xDone)"]);
	});

	it("P2 splits rungs by rail pair and builds parallel contacts", () => {
		expect(bodies(PLCOPEN.P2_parallel_two_rungs)).toEqual(["[C(xAuto) | C(xManual)] C(xFault):nc Y(xRun)", "C(xRun) Y(xLamp)"]);
	});

	it("P3 CODESYS networks: blocks with data pins, and a second power input as a pin leg", () => {
		const r = parsePLCopen(PLCOPEN.P3_blocks);
		expect(r.errors).toEqual([]);
		expect(bodies(PLCOPEN.P3_blocks)).toEqual([
			"C(xStart) TON Y(xDelayDone)",
			"[C(xPartSensor) R_TRIG>CU | C(xResetCount)>RESET] CTU Y(xBatchDone)",
		]);
		const [n1, n2] = r.sections[0]!.rungs;
		expect(n1!.comment).toBe("Start delay");
		expect(n2!.comment).toBe("Part counter");

		const ton = box(n1!, "TON");
		expect(ton.form).toBe("iec");
		expect(ton.instance).toBe("tonDelay");
		expect(ton.powerIn).toBe("IN");
		expect(ton.powerOut).toBe("Q");
		expect(ton.operands).toEqual([
			{ name: "IN", value: "", power: true },
			{ name: "PT", value: "T#5S" },
		]);
		expect(ton.outPins).toEqual([
			{ name: "Q", value: "", power: true },
			{ name: "ET", value: "tElapsed" },
		]);

		const ctu = box(n2!, "CTU");
		expect(ctu.operands.map((o) => [o.name, o.value, o.power ?? false])).toEqual([
			["CU", "", true],
			["RESET", "", true],
			["PV", "100", false],
		]);
	});

	it("P4 comments, titles, edge contacts, and set/reset/negated coils", () => {
		const r = parsePLCopen(PLCOPEN.P4_variants_comments);
		expect(r.errors).toEqual([]);
		expect(bodies(PLCOPEN.P4_variants_comments)).toEqual([
			"C(xStart):pos C(xStop):nc Y(xRun):set",
			"C(xStop):neg [Y(xRun):reset | Y(xIdle):nc]",
		]);
		const rungs = r.sections[0]!.rungs;
		expect(rungs[0]!.comment).toBe("Run latch\nLatch the run bit\non a rising start edge");
		expect(rungs[1]!.comment).toBeUndefined();
		const labels = rungs[0]!.body.items.map((n) => (n.kind === "instr" ? (n.label ?? "") : ""));
		expect(labels).toEqual(["P", "", "S"]);
	});

	it("P5 whole project: POUs and actions become sections; ST bodies are skipped", () => {
		const r = parsePLCopen(PLCOPEN.P5_project);
		expect(r.errors).toEqual([]);
		expect(r.sections.map((s) => [s.title, s.rungs.length])).toEqual([
			["PRG_Main", 1],
			["PRG_Main / ACT_Reset", 1],
		]);
		expect(r.notices).toEqual(["Skipped 1 non-LD body (1 ST)."]);
	});

	it("P6 bridge wiring becomes an error rung with a position", () => {
		const r = parsePLCopen(PLCOPEN.P6_bridge);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]!.message).toMatch(/not series-parallel/);
		expect(r.errors[0]!.line).toBe(3);
		expect(r.sections[0]!.rungs[0]!.error).toMatch(/not series-parallel/);
	});

	it("P7 EN/ENO box: EN carries power, IN and OUT are data", () => {
		const r = parsePLCopen(PLCOPEN.P7_en_eno);
		expect(r.errors).toEqual([]);
		const rung = r.sections[0]!.rungs[0]!;
		expect(show(rung.body.items)).toBe("C(xEnable) MOVE Y(xMoved)");
		const move = box(rung, "MOVE");
		expect(move.instance).toBeUndefined();
		expect([move.powerIn, move.powerOut]).toEqual(["EN", "ENO"]);
		expect(move.operands).toEqual([
			{ name: "EN", value: "", power: true },
			{ name: "IN", value: "iSetpoint" },
		]);
		expect(move.outPins).toEqual([
			{ name: "ENO", value: "", power: true },
			{ name: "OUT", value: "iTarget" },
		]);
	});

	it("P8 a connection to a missing localId is an error rung", () => {
		const r = parsePLCopen(PLCOPEN.P8_bad_reference);
		expect(r.errors.map((e) => e.message)).toEqual(["Connection to localId 99, which does not exist."]);
	});
});
