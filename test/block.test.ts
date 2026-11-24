// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { caretSnippet, renderBlock } from "../src/render/block";
import { NEUTRAL } from "./fixtures/neutral";

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

	it("shows a note for formats that arrive in later milestones", () => {
		const el = render("---\nformat: l5k\n---\nN: XIC(A)OTE(B);");
		expect(block(el).dataset.format).toBe("l5k");
		expect(el.querySelector(".ldd-note")?.textContent).toContain("M2");
		expect(el.querySelector("svg")).toBeNull();
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

	it("replaces previous content when re-rendered into the same element", () => {
		const el = document.createElement("div");
		renderBlock("XIC(A)OTE(B);", el);
		renderBlock("XIC(A)OTE(B);", el);
		expect(el.querySelectorAll(".ldd-block")).toHaveLength(1);
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
