import { describe, expect, it } from "vitest";
import type { Rung } from "../src/ir/types";
import { DEFAULT_STYLE, layoutRungs, wrapTag, wrapText, type Geometry, type LayoutStyle, type Prim } from "../src/layout/layout";
import { parseNeutralText } from "../src/parsers/neutralText";
import { NEUTRAL } from "./fixtures/neutral";

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

	it("N1 right-aligns the coil to the right rail by default", () => {
		const g = lay(NEUTRAL.N01_single);
		const [contact, coil] = syms(g);
		expect(contact?.t).toBe("contact");
		expect(coil?.t).toBe("coil");
		const railR = rails(g)[1]!.x1;
		expect(cellRight(coil!)).toBeCloseTo(railR - S.rungPadX, 5);
	});

	it("N1 places the coil in the cell right after the contact with align: inline", () => {
		const g = lay(NEUTRAL.N01_single, { align: "inline" });
		const [contact, coil] = syms(g);
		expect(coil!.x - contact!.x).toBeCloseTo(CELL_W, 5);
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

	it("N4 right-aligns the whole output branch and aligns its legs", () => {
		const g = lay(NEUTRAL.N04_output_branch);
		const lamp = symByTag(g, "Lamp_01")!;
		const latch = symByTag(g, "Latch_01")!;
		expect(latch.x).toBe(lamp.x);
		expect(latch.label).toBe("L");
		// The branch's closing line sits at the right edge of the rung area.
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

describe("layout: options and text", () => {
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
		const g = lay("XIC(A)OTE(B);\nXIC(A)XIC(B)XIC(C)XIC(D)XIC(E)XIC(F)XIC(G)XIC(H)XIC(I)OTE(J);");
		expect(rails(g)).toHaveLength(2);
		const coils = syms(g).filter((s) => s.t === "coil");
		expect(coils[0]!.x).toBe(coils[1]!.x);
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
