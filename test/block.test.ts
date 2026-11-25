// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { caretSnippet, renderBlock } from "../src/render/block";
import { pngRatio, standaloneSvg } from "../src/render/export";
import { DEFAULT_SETTINGS } from "../src/settings";
import { NEUTRAL } from "./fixtures/neutral";
import { PLCOPEN } from "./fixtures/plcopen";
import { L5K, L5X } from "./fixtures/rockwell";

function render(source: string): HTMLElement {
	const el = document.createElement("div");
	renderBlock(source, el);
	return el;
}

const block = (el: HTMLElement) => el.querySelector(".ldd-block") as HTMLElement;

describe("renderBlock", () => {
	it("renders neutral text as an SVG with rails, contacts, and coils", () => {
		const el = render(NEUTRAL.N02_seal_in);
		expect(block(el).dataset.format).toBe("neutral");
		const svg = el.querySelector("svg");
		expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
		expect(svg?.getAttribute("aria-label")).toBe("Ladder diagram, 1 rung");
		expect(svg?.querySelectorAll("line.ldd-rail")).toHaveLength(2);
		expect(svg?.querySelectorAll("g.ldd-instr")).toHaveLength(4);
		expect(el.querySelector(".ldd-error")).toBeNull();
	});

	it("adds a hover tooltip with the instruction as written", () => {
		const el = render("XIC(Start_PB)OTE(Run);");
		const titles = [...el.querySelectorAll("g.ldd-instr > title")].map((t) => t.textContent);
		expect(titles).toEqual(["XIC(Start_PB)", "OTE(Run)"]);
	});

	it("numbers rungs from the header start value", () => {
		const el = render("---\nstart: 12\n---\nXIC(A)OTE(B);\nXIC(C)OTE(D);");
		expect([...el.querySelectorAll("text.ldd-num")].map((t) => t.textContent)).toEqual(["12", "13"]);
	});

	it("shows parse errors with block line numbers and a caret, and still renders good rungs", () => {
		const el = render(`---\nstart: 1\n---\n${NEUTRAL.N12_malformed}`);
		const items = [...el.querySelectorAll(".ldd-error-item")];
		expect(items).toHaveLength(4);
		expect(items[0]?.firstChild?.textContent).toBe(
			"Line 5, col 21: Branch opened at line 2, col 1 is not closed with ']'.",
		);
		expect(items[1]?.querySelector("pre")?.textContent).toBe("XIC(F)]OTE(G);\n      ^");
		expect(el.querySelectorAll("svg line.ldd-err-wire")).toHaveLength(4);
		expect(el.querySelectorAll("svg g.ldd-instr")).toHaveLength(4);
	});

	it("shows header errors and still renders the diagram", () => {
		const el = render("---\nbogus: 1\n---\nXIC(A)OTE(B);");
		expect(el.querySelector(".ldd-error")?.textContent).toContain("Line 2");
		expect(el.querySelector("svg")).not.toBeNull();
	});

	it("renders PLCopen in IEC style, networks numbered from 1, coils at the right rail", () => {
		const el = render(PLCOPEN.P3_blocks);
		expect(block(el).dataset.format).toBe("plcopen");
		expect(block(el).dataset.style).toBe("iec");
		expect([...el.querySelectorAll("text.ldd-num")].map((t) => t.textContent)).toEqual(["1", "2"]);
		expect(el.querySelector("text.ldd-comment")?.textContent).toBe("Start delay");
		// IEC contacts are two straight bars: no hooks, so each half is a single M..H..M..V path.
		const contactPath = el.querySelector("g.ldd-instr path")?.getAttribute("d") ?? "";
		expect(contactPath).toMatch(/^M[\d.]+ [\d.]+H[\d.]+M[\d.]+ [\d.]+V[\d.]+$/);
	});

	it("lets the header switch PLCopen to Rockwell symbols and inline outputs", () => {
		const el = render(`---\nstyle: rockwell\nstart: 0\n---\n${PLCOPEN.P1_contact_coil}`);
		expect(block(el).dataset.style).toBe("rockwell");
		expect(el.querySelector("text.ldd-num")?.textContent).toBe("0");
	});

	it("shows PLCopen network errors with their block line", () => {
		const el = render(`---\nnumbers: on\n---\n${PLCOPEN.P6_bridge}`);
		expect(el.querySelector(".ldd-error-item")?.firstChild?.textContent).toMatch(/^Line 6, col 1: The network is not series-parallel/);
		expect(el.querySelectorAll("svg line.ldd-err-wire")).toHaveLength(1);
	});

	it("renders L5K routine text", () => {
		const el = render(L5K.K2_comment_escapes);
		expect(block(el).dataset.format).toBe("l5k");
		expect(el.querySelector("svg")?.getAttribute("aria-label")).toBe("Ladder diagram, 1 rung");
		expect(el.querySelector("text.ldd-comment")?.textContent).toBe("Pump permissive");
	});

	it("renders a full L5X document as titled sections with a notice for skipped routines", () => {
		const el = render(L5X.X3_full_document);
		expect(block(el).dataset.format).toBe("l5x");
		expect([...el.querySelectorAll(".ldd-section-title")].map((t) => t.textContent)).toEqual([
			"Valve_AOI / Logic",
			"MainProgram / MainRoutine",
			"MainProgram / Empty",
		]);
		expect(el.querySelectorAll("svg")).toHaveLength(2);
		const notes = [...el.querySelectorAll(".ldd-note")].map((n) => n.textContent);
		expect(notes).toEqual(["Skipped 2 non-ladder routines (1 ST, 1 FBD).", "No rungs."]);
		expect(el.querySelectorAll("svg")[1]?.getAttribute("aria-label")).toBe("Ladder diagram, MainProgram / MainRoutine, 2 rungs");
	});

	it("keeps L5X rung numbers and maps L5X errors to block lines below the header", () => {
		expect([...render(L5X.X2_rll_content).querySelectorAll("text.ldd-num")].map((t) => t.textContent)).toEqual([
			"0",
			"1",
			"2",
		]);
		const el = render(`---\nnumbers: on\n---\n${L5X.X7_bad_rung_text}`);
		expect(el.querySelector(".ldd-error-item")?.firstChild?.textContent).toBe(
			"Line 6, col 16: Unexpected ']' with no matching '['.",
		);
	});

	it("shows a note for an empty block", () => {
		expect(render("   \n").querySelector(".ldd-note")?.textContent).toBe("No rungs found.");
	});

	it("never interprets block text as HTML", () => {
		const el = render("// <img src=x onerror=alert(1)>\nXIC(<b>A</b>)OTE(B);");
		expect(el.querySelector("img")).toBeNull();
		expect(el.querySelector("b")).toBeNull();
		expect(el.querySelector("text.ldd-comment")?.textContent).toContain("<img");
	});

	it("wraps to the given width and lays out again on relayout without re-parsing", () => {
		const el = document.createElement("div");
		const block = renderBlock(NEUTRAL.N11_long, el, { width: 640 });
		const svg1 = el.querySelector("svg")!;
		expect(Number(svg1.getAttribute("width"))).toBeLessThanOrEqual(640);
		expect(el.querySelectorAll("text.ldd-wrap").length).toBeGreaterThan(0);

		// The 41-element rung is about 5,000 px wide unwrapped.
		block.relayout(8000);
		const svg2 = el.querySelector("svg")!;
		expect(svg2).not.toBe(svg1);
		expect(el.querySelectorAll("text.ldd-wrap")).toHaveLength(0);
		expect(Number(svg2.getAttribute("height"))).toBeLessThan(Number(svg1.getAttribute("height")));

		// A width change below the step is ignored.
		block.relayout(8004);
		expect(el.querySelector("svg")).toBe(svg2);
	});

	it("applies settings: scale, symbols, and no wrapping", () => {
		const el = document.createElement("div");
		renderBlock(NEUTRAL.N11_long, el, { width: 640, settings: { ...DEFAULT_SETTINGS, wrap: false, scale: 50, style: "iec" } });
		expect(el.querySelectorAll("text.ldd-wrap")).toHaveLength(0);
		expect((el.querySelector(".ldd-block") as HTMLElement).dataset.style).toBe("iec");
		const svg = el.querySelector("svg")!;
		const viewW = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
		expect(Number(svg.getAttribute("width"))).toBe(Math.ceil(viewW / 2));
	});

	it("numbers cached rungs afresh for each header start", () => {
		const body = "XIC(A)OTE(B);\nXIC(C)OTE(D);";
		const nums = (src: string) => [...render(src).querySelectorAll("text.ldd-num")].map((t) => t.textContent);
		expect(nums(`---\nstart: 5\n---\n${body}`)).toEqual(["5", "6"]);
		expect(nums(body)).toEqual(["0", "1"]);
	});

	it("replaces previous content when re-rendered into the same element", () => {
		const el = document.createElement("div");
		renderBlock("XIC(A)OTE(B);", el);
		renderBlock("XIC(A)OTE(B);", el);
		expect(el.querySelectorAll(".ldd-block")).toHaveLength(1);
	});
});

describe("export", () => {
	it("makes standalone SVG: xmlns, inlined theme styles, background, text intact", () => {
		const style = document.createElement("style");
		style.textContent = ".ldd-wire { stroke: #123456; stroke-width: 1.5px; }";
		document.head.appendChild(style);
		const el = render("XIC(Start_PB)OTE(Run);");
		document.body.appendChild(el);
		const text = standaloneSvg(el.querySelector("svg")!, "#fafafa");
		style.remove();
		el.remove();

		expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(text).toMatch(/<rect width="100%" height="100%" fill="#fafafa"/);
		expect(text).toMatch(/class="ldd-wire"[^>]*style="[^"]*stroke:\s*(#123456|rgb\(18, 52, 86\))/);
		expect(text).toContain(">Start_PB<");
		expect(text).toContain("<title>XIC(Start_PB)</title>");
	});

	it("lowers the PNG pixel ratio for very large diagrams", () => {
		expect(pngRatio(800, 600)).toBe(2);
		expect(pngRatio(1000, 32000)).toBe(0.5);
		expect(pngRatio(1000, 1e9)).toBe(0.25);
	});
});

describe("caretSnippet", () => {
	it("puts the caret under the column", () => {
		expect(caretSnippet("XIC(A)]OTE(B);", 7)).toBe("XIC(A)]OTE(B);\n      ^");
	});

	it("windows long lines around the column", () => {
		const line = `${"A".repeat(100)}!${"B".repeat(100)}`;
		const [shown, caret] = caretSnippet(line, 101).split("\n");
		expect(shown?.startsWith("...")).toBe(true);
		expect(shown?.endsWith("...")).toBe(true);
		expect(shown?.[caret!.indexOf("^")]).toBe("!");
	});
});
