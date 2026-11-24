/**
 * Geometry -> SVG. Plain DOM APIs only; all text goes through textContent.
 */
import type { Geometry, Prim, Symbols } from "../layout/layout";

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
	const node = doc.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

const r = (n: number) => Math.round(n * 10) / 10;

export function renderGeometry(doc: Document, g: Geometry, ariaLabel: string): SVGSVGElement {
	const root = svgEl(doc, "svg", {
		class: "ldd-svg",
		width: g.width,
		height: g.height,
		viewBox: `0 0 ${g.width} ${g.height}`,
		role: "img",
		"aria-label": ariaLabel,
	});
	for (const p of g.prims) root.appendChild(renderPrim(doc, p, g.symbols));
	return root;
}

function withTip(doc: Document, tip: string, cls: string, children: SVGElement[]): SVGGElement {
	const group = svgEl(doc, "g", { class: cls });
	const title = svgEl(doc, "title");
	title.textContent = tip;
	group.appendChild(title);
	for (const c of children) group.appendChild(c);
	return group;
}

function renderPrim(doc: Document, p: Prim, symbols: Symbols): SVGElement {
	switch (p.t) {
		case "line":
			return svgEl(doc, "line", { class: `ldd-${p.cls}`, x1: r(p.x1), y1: r(p.y1), x2: r(p.x2), y2: r(p.y2) });
		case "text": {
			const t = svgEl(doc, "text", { class: `ldd-${p.cls}`, x: r(p.x), y: r(p.y), "text-anchor": p.anchor });
			t.textContent = p.text;
			return t;
		}
		case "box":
			return withTip(doc, p.tip, "ldd-instr", [
				svgEl(doc, "rect", { class: "ldd-box", x: r(p.x), y: r(p.y), width: r(p.w), height: r(p.h), rx: 2 }),
			]);
		case "contact":
			return withTip(
				doc,
				p.tip,
				"ldd-instr",
				symbols === "iec" ? iecContactShapes(doc, p.x, p.y, p.w, p.variant, p.label) : contactShapes(doc, p.x, p.y, p.w, p.variant, p.label),
			);
		case "coil":
			return withTip(doc, p.tip, "ldd-instr", coilShapes(doc, p.x, p.y, p.w, p.label));
	}
}

const HALF = 9; // half symbol height
const BAR = 6; // bracket inset from symbol edge

/** Rockwell contact: ] [  with optional slash (normally closed) or inner text (ONS, LBL). */
function contactShapes(doc: Document, x: number, y: number, w: number, variant?: string, label?: string): SVGElement[] {
	const xl = x + BAR;
	const xr = x + w - BAR;
	const shapes: SVGElement[] = [
		svgEl(doc, "path", {
			class: "ldd-sym",
			d: `M${r(x)} ${r(y)}H${r(xl)}M${r(x + 1)} ${r(y - HALF)}H${r(xl)}V${r(y + HALF)}H${r(x + 1)}`,
		}),
		svgEl(doc, "path", {
			class: "ldd-sym",
			d: `M${r(x + w)} ${r(y)}H${r(xr)}M${r(x + w - 1)} ${r(y - HALF)}H${r(xr)}V${r(y + HALF)}H${r(x + w - 1)}`,
		}),
	];
	if (variant === "nc") {
		shapes.push(svgEl(doc, "line", { class: "ldd-sym", x1: r(xl + 3), y1: r(y + HALF - 2), x2: r(xr - 3), y2: r(y - HALF + 2) }));
	}
	if (label) shapes.push(symText(doc, x + w / 2, y, label));
	return shapes;
}

/** IEC contact: | |  with a slash (negated) or inner text (P, N for edge contacts). */
function iecContactShapes(doc: Document, x: number, y: number, w: number, variant?: string, label?: string): SVGElement[] {
	const xl = x + BAR;
	const xr = x + w - BAR;
	const shapes: SVGElement[] = [
		svgEl(doc, "path", { class: "ldd-sym", d: `M${r(x)} ${r(y)}H${r(xl)}M${r(xl)} ${r(y - HALF)}V${r(y + HALF)}` }),
		svgEl(doc, "path", { class: "ldd-sym", d: `M${r(x + w)} ${r(y)}H${r(xr)}M${r(xr)} ${r(y - HALF)}V${r(y + HALF)}` }),
	];
	if (variant === "nc") {
		shapes.push(svgEl(doc, "line", { class: "ldd-sym", x1: r(xl + 3), y1: r(y + HALF - 2), x2: r(xr - 3), y2: r(y - HALF + 2) }));
	}
	if (label) shapes.push(symText(doc, x + w / 2, y, label));
	return shapes;
}

/** Coil: ( ) with optional inner text (L, U, RES, JMP; IEC S, R, P, N, /). Same in both styles. */
function coilShapes(doc: Document, x: number, y: number, w: number, label?: string): SVGElement[] {
	const shapes: SVGElement[] = [
		svgEl(doc, "path", {
			class: "ldd-sym",
			d: `M${r(x)} ${r(y)}H${r(x + 4)}M${r(x + 9)} ${r(y - HALF)}Q${r(x - 1)} ${r(y)} ${r(x + 9)} ${r(y + HALF)}`,
		}),
		svgEl(doc, "path", {
			class: "ldd-sym",
			d: `M${r(x + w)} ${r(y)}H${r(x + w - 4)}M${r(x + w - 9)} ${r(y - HALF)}Q${r(x + w + 1)} ${r(y)} ${r(x + w - 9)} ${r(y + HALF)}`,
		}),
	];
	if (label) shapes.push(symText(doc, x + w / 2, y, label));
	return shapes;
}

function symText(doc: Document, cx: number, y: number, text: string): SVGTextElement {
	const t = svgEl(doc, "text", { class: "ldd-sym-text", x: r(cx), y: r(y + 4), "text-anchor": "middle" });
	t.textContent = text;
	return t;
}
