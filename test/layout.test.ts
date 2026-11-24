import { describe, expect, it } from "vitest";
import type { Rung } from "../src/ir/types";
import { DEFAULT_STYLE, layoutRungs, wrapTag, wrapText, type Geometry, type LayoutStyle, type Prim } from "../src/layout/layout";
import { parseNeutralText } from "../src/parsers/neutralText";
import { parsePLCopen } from "../src/parsers/plcopen";
import { NEUTRAL } from "./fixtures/neutral";
import { PLCOPEN } from "./fixtures/plcopen";

function lay(src: string, style: Partial<LayoutStyle> = {}): Geometry {
	const rungs: Rung[] = parseNeutralText(src).rungs.map((r, i) => ({ ...r, number: i }));
	return layoutRungs(rungs, style);
}

type Sym = Extract<Prim, { t: "contact" | "coil" }>;
const syms = (g: Geometry) => g.prims.filter((p): p is Sym => p.t === "contact" || p.t === "coil");
const texts = (g: Geometry, cls: string) =>
	g.prims.filter((p): p is Extract<Prim, { t: "text" }> => p.t === "text" && p.cls === cls).map((p) => p.text);
const lines = (g: Geometry) => g.prims.filter((p): p is Extract<Prim, { t: "line" }> => p.t === "line");
const verticalWires = (g: Geometry) => lines(g).filter((l) => l.cls === "wire" && l.x1 === l.x2);
const rails = (g: Geometry) => lines(g).filter((l) => l.cls === "rail");
const symByTag = (g: Geometry, tagSubstr: string) => syms(g).find((s) => s.tip.includes(tagSubstr));
const S = DEFAULT_STYLE;
const CELL_W = S.cellChars * S.charW + 8;
/** Right edge of the cell that holds a contact/coil symbol. */
const cellRight = (sym: Sym) => sym.x + sym.w + (CELL_W - sym.w) / 2;

describe("layout: fixtures", () => {
	it("produces finite coordinates for every fixture", () => {
		for (const [name, src] of Object.entries(NEUTRAL)) {
			const g = lay(src);
			for (const p of g.prims) {
				for (const v of Object.values(p)) {
					if (typeof v === "number") expect(Number.isFinite(v), `${name}: ${JSON.stringify(p)}`).toBe(true);
				}
			}
		}
	});

	it("N1 places the coil in the cell right after the contact by default (inline)", () => {
		const g = lay(NEUTRAL.N01_single);
		const [contact, coil] = syms(g);
		expect(contact?.t).toBe("contact");
		expect(coil?.t).toBe("coil");
		expect(coil!.x - contact!.x).toBeCloseTo(CELL_W, 5);
		// A wire carries power from the coil's cell to the right rail.
		const railR = rails(g)[1]!.x1;
		const tail = lines(g).find((l) => l.cls === "wire" && l.x2 === railR);
		expect(tail?.x1).toBeCloseTo(cellRight(coil!), 5);
	});

	it("N1 right-aligns the coil to the right rail with align: right", () => {
		const g = lay(NEUTRAL.N01_single, { align: "right" });
		const coil = syms(g)[1]!;
		const railR = rails(g)[1]!.x1;
		expect(cellRight(coil)).toBeCloseTo(railR - S.rungPadX, 5);
	});

	it("N2 stacks branch legs at the same x with branch lines on both sides", () => {
		const g = lay(NEUTRAL.N02_seal_in);
		const start = symByTag(g, "Start_PB")!;
		const run = syms(g).find((s) => s.t === "contact" && s.tip === "XIC(Motor_Run)")!;
		expect(run.x).toBe(start.x);
		expect(run.y).toBeGreaterThan(start.y + DEFAULT_STYLE.symH);
		expect(verticalWires(g)).toHaveLength(2);
	});

	it("N3 draws two branch lines per nested branch", () => {
		expect(verticalWires(lay(NEUTRAL.N03_nested))).toHaveLength(6);
	});

	it("N4 aligns the legs of an output branch", () => {
		const g = lay(NEUTRAL.N04_output_branch);
		const lamp = symByTag(g, "Lamp_01")!;
		const latch = symByTag(g, "Latch_01")!;
		expect(latch.x).toBe(lamp.x);
		expect(latch.label).toBe("L");
		// Inline: the branch opens right where the input ends, not out at the rail.
		const railR = rails(g)[1]!.x1;
		const rightBranch = Math.max(...verticalWires(g).map((v) => v.x1));
		expect(rightBranch).toBeLessThan(railR - S.rungPadX);
	});

	it("N4 right-aligns the whole output branch with align: right", () => {
		const g = lay(NEUTRAL.N04_output_branch, { align: "right" });
		const railR = rails(g)[1]!.x1;
		const rightBranch = Math.max(...verticalWires(g).map((v) => v.x1));
		expect(rightBranch).toBeCloseTo(railR - S.rungPadX, 5);
	});

	it("N5 draws a wire across the empty leg", () => {
		const g = lay(NEUTRAL.N05_empty_leg);
		const [top, bottom] = verticalWires(g).filter((v) => v.y1 !== v.y2);
		expect(top).toBeDefined();
		const legY = top!.y2;
		const across = lines(g).filter((l) => l.y1 === legY && l.y2 === legY && l.x1 >= top!.x1 && l.x2 <= bottom!.x1);
		const covered = across.reduce((sum, l) => sum + (l.x2 - l.x1), 0);
		expect(covered).toBeCloseTo(bottom!.x1 - top!.x1, 5);
	});

	it("N10 shows '?' for unset operands", () => {
		const g = lay(NEUTRAL.N10_qmarks);
		expect(texts(g, "tag")).toEqual(["?", "?"]);
		expect(texts(g, "box-text")).toEqual(["Timer_01", "?", "?"]);
	});

	it("N9 draws an unknown box (AOI) with positional operands and no names", () => {
		const g = lay(NEUTRAL.N09_aoi);
		expect(texts(g, "box-title")).toEqual(["Valve_AOI"]);
		expect(texts(g, "box-name")).toEqual([]);
		expect(texts(g, "box-text")).toEqual(["Valve_01", "Open_Cmd", "Close_Cmd", "?", "?"]);
	});

	it("N11 lays out a very long rung wider than 2000 px", () => {
		expect(lay(NEUTRAL.N11_long).width).toBeGreaterThan(2000);
	});

	it("N12 draws error rungs and keeps numbering for all rungs", () => {
		const g = lay(NEUTRAL.N12_malformed);
		expect(lines(g).filter((l) => l.cls === "err-wire")).toHaveLength(4);
		expect(texts(g, "num")).toEqual(["0", "1", "2", "3", "4", "5"]);
		expect(texts(g, "err-text")[0]).toContain("Parse error");
	});

	it("wraps long parse-error text inside the rails", () => {
		const g = lay(NEUTRAL.N12_malformed);
		const railR = rails(g)[1]!.x1;
		for (const t of g.prims) {
			if (t.t === "text" && t.cls === "err-text") {
				expect(t.x + t.text.length * S.charW).toBeLessThanOrEqual(railR);
			}
		}
	});
});

describe("layout: boxes", () => {
	const boxes = (g: Geometry) => g.prims.filter((p): p is Extract<Prim, { t: "box" }> => p.t === "box");

	it("draws the mnemonic, description, operand names, and values", () => {
		const g = lay("XIC(Run)TON(Motor_Delay,5000,0);");
		expect(texts(g, "box-title")).toEqual(["TON"]);
		expect(texts(g, "box-desc")).toEqual(["Timer On Delay"]);
		expect(texts(g, "box-name")).toEqual(["Timer", "Preset", "Accum"]);
		expect(texts(g, "box-text")).toEqual(["Motor_Delay", "5000", "0"]);
		// Values line up in one column after the longest name.
		const xs = g.prims.filter((p) => p.t === "text" && p.cls === "box-text").map((p) => (p as { x: number }).x);
		expect(new Set(xs).size).toBe(1);
	});

	it("draws status pins on the right and continues the rung from the first one", () => {
		const g = lay("XIC(Run)TON(Motor_Delay,5000,0);");
		expect(texts(g, "pin")).toEqual(["(EN)", "(DN)"]);
		const box = boxes(g)[0]!;
		const railR = rails(g)[1]!.x1;
		const enWire = lines(g).filter((l) => l.cls === "wire" && l.y1 === l.y2 && l.x1 >= box.x + box.w);
		const wireY = syms(g)[0]!.y;
		// The EN row is the rung wire: wire segments on it reach the right rail.
		expect(enWire.some((l) => l.y1 === wireY && l.x2 === railR)).toBe(true);
		// The DN row is a short stub below it that does not reach the rail.
		const dn = enWire.filter((l) => l.y1 > wireY);
		expect(dn.length).toBeGreaterThan(0);
		expect(dn.every((l) => l.x2 < railR)).toBe(true);
	});

	it("hides the JSR input count row", () => {
		const g = lay("JSR(Sub_01,0);");
		expect(texts(g, "box-name")).toEqual(["Routine Name"]);
		expect(texts(g, "box-text")).toEqual(["Sub_01"]);
	});

	it("treats compare boxes as inputs for align: right", () => {
		const src = "XIC(A)GRT(B,C)OTE(D);";
		const wide = { minInnerW: 900 };
		const inline = boxes(lay(src, wide))[0]!;
		const right = boxes(lay(src, { ...wide, align: "right" }))[0]!;
		expect(right.x).toBe(inline.x);
		const coilInline = syms(lay(src, wide)).find((s) => s.t === "coil")!;
		const coilRight = syms(lay(src, { ...wide, align: "right" })).find((s) => s.t === "coil")!;
		expect(coilRight.x).toBeGreaterThan(coilInline.x);
	});

	it("draws no tag label for coils without operands (MCR)", () => {
		const g = lay("XIC(A)MCR();");
		expect(texts(g, "tag")).toEqual(["A"]);
		expect(syms(g)[1]!.label).toBe("MCR");
	});
});

describe("layout: IEC function blocks", () => {
	const plc = (src: string) => {
		const r = parsePLCopen(src);
		return layoutRungs(
			r.sections[0]!.rungs.map((g, i) => ({ ...g, number: i + 1 })),
			{ symbols: "iec", align: "right" },
		);
	};
	const textAt = (g: Geometry, cls: string, text: string) =>
		g.prims.find((p) => p.t === "text" && p.cls === cls && p.text === text) as Extract<Prim, { t: "text" }>;

	it("draws type, instance, pin names inside, and data values outside the box", () => {
		const g = plc(PLCOPEN.P3_blocks);
		expect(texts(g, "box-title")).toEqual(["TON", "R_TRIG", "CTU"]);
		expect(texts(g, "instance")).toEqual(["tonDelay", "rtPart", "ctuParts"]);
		const box = g.prims.find((p) => p.t === "box")! as Extract<Prim, { t: "box" }>;
		const pt = textAt(g, "box-text", "T#5S");
		const et = textAt(g, "box-text", "tElapsed");
		expect(pt.anchor).toBe("end");
		expect(pt.x).toBeLessThan(box.x);
		expect(et.x).toBeGreaterThan(box.x + box.w);
		expect(textAt(g, "box-name", "PT").x).toBeGreaterThan(box.x);
	});

	it("lines the RESET pin up with the leg that feeds it, with no join line on the right", () => {
		const g = plc(PLCOPEN.P3_blocks);
		const reset = textAt(g, "box-name", "RESET");
		const resetContact = syms(g).find((s) => s.tip.includes("xResetCount"))!;
		// Pin text baseline is the pin row + 4.
		expect(reset.y - 4).toBeCloseTo(resetContact.y, 5);
		const cu = textAt(g, "box-name", "CU");
		expect(cu.y).toBeLessThan(reset.y);
	});

	it("uses the EN/ENO pins as the rung wire", () => {
		const g = plc(PLCOPEN.P7_en_eno);
		const en = textAt(g, "box-name", "EN");
		const contact = syms(g)[0]!;
		expect(en.y - 4).toBeCloseTo(contact.y, 5);
		expect(textAt(g, "box-text", "iSetpoint")).toBeDefined();
		expect(textAt(g, "box-text", "iTarget")).toBeDefined();
	});

	it("records the symbol style for the renderer", () => {
		expect(plc(PLCOPEN.P1_contact_coil).symbols).toBe("iec");
		expect(lay(NEUTRAL.N01_single).symbols).toBe("rockwell");
	});
});

describe("layout: options and text", () => {
	it("marks non-N rung types in the left margin, left of the rung number", () => {
		const rungs: Rung[] = parseNeutralText("XIC(A)OTE(B);\nXIC(C)OTE(D);").rungs.map((r, i) => ({ ...r, number: i }));
		rungs[1]!.type = "I";
		const g = layoutRungs(rungs);
		const badge = g.prims.find((p) => p.t === "text" && p.cls === "badge") as Extract<Prim, { t: "text" }>;
		expect(badge.text).toBe("I");
		const num = g.prims.filter((p) => p.t === "text" && p.cls === "num")[1] as Extract<Prim, { t: "text" }>;
		expect(badge.y).toBe(num.y);
		expect(badge.x + S.charW).toBeLessThan(num.x - S.charW);
	});

	it("omits rung numbers with numbers: false", () => {
		expect(texts(lay(NEUTRAL.N01_single, { numbers: false }), "num")).toEqual([]);
	});

	it("draws rung comments above the rung", () => {
		const g = lay("// Pump start permissive\nXIC(A)OTE(B);");
		const comment = g.prims.find((p) => p.t === "text" && p.cls === "comment");
		const contact = syms(g)[0]!;
		expect(comment && comment.t === "text" && comment.y).toBeLessThan(contact.y);
	});

	it("uses one rung width (shared right rail) for every rung in a block", () => {
		const src = "XIC(A)OTE(B);\nXIC(A)XIC(B)XIC(C)XIC(D)XIC(E)XIC(F)XIC(G)XIC(H)XIC(I)OTE(J);";
		const g = lay(src);
		expect(rails(g)).toHaveLength(2);
		// Inline: each rung's coil follows its own inputs, and both rungs wire through to the shared rail.
		const coils = syms(g).filter((s) => s.t === "coil");
		expect(coils[0]!.x).toBeLessThan(coils[1]!.x);
		const railR = rails(g)[1]!.x1;
		expect(lines(g).filter((l) => l.cls === "wire" && l.x2 === railR)).toHaveLength(2);
		// Right: coils line up against the shared rail.
		const r = syms(lay(src, { align: "right" })).filter((s) => s.t === "coil");
		expect(r[0]!.x).toBe(r[1]!.x);
	});

	it("wraps long tag names at member boundaries", () => {
		expect(wrapTag("Program:MainProgram.Conveyor_01.Motor.Running", 22)).toEqual([
			"Program:MainProgram.",
			"Conveyor_01.Motor.",
			"Running",
		]);
		expect(wrapTag("Short_Tag", 22)).toEqual(["Short_Tag"]);
		// Member boundaries beat a mid-word cut even when they fall in the left half.
		expect(wrapTag("Program:MainProgram.Local_Tag", 16)).toEqual(["Program:", "MainProgram.", "Local_Tag"]);
		// '_' is used when no member boundary is in the right half.
		expect(wrapTag("Station_01_Sensor_01", 16)).toEqual(["Station_01_", "Sensor_01"]);
		expect(wrapTag("Arr[3,1].Member_Name_Long", 16)).toEqual(["Arr[3,1].", "Member_Name_Long"]);
		expect(wrapTag("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 10)).toEqual(["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"]);
	});

	it("word-wraps comments and keeps explicit newlines", () => {
		expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
		expect(wrapText("line1\nline2", 40)).toEqual(["line1", "line2"]);
	});
});
