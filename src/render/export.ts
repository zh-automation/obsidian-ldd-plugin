/**
 * Turn a rendered diagram into something that stands on its own outside the note: SVG text with
 * the theme's colors baked in (the on-screen SVG uses CSS classes and Obsidian variables), and a
 * PNG drawn from that SVG. Plain DOM APIs only.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Presentation properties copied from computed styles onto each element. */
const PROPS = [
	"fill",
	"stroke",
	"stroke-width",
	"stroke-dasharray",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
] as const;

/** Largest PNG side in pixels; very tall routines are drawn at a lower pixel ratio to stay under it. */
const MAX_PNG_SIDE = 16000;

/**
 * Standalone SVG markup: theme colors and fonts inlined as style attributes, an explicit xmlns,
 * and an optional background so the diagram reads on any page.
 */
export function standaloneSvg(svg: SVGSVGElement, background?: string): string {
	const doc = svg.ownerDocument;
	const win = doc.defaultView;
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const from = [svg, ...Array.from(svg.querySelectorAll("*"))];
	const to = [clone, ...Array.from(clone.querySelectorAll("*"))];
	from.forEach((el, i) => {
		const target = to[i];
		if (!target || !win || el.tagName.toLowerCase() === "title") return;
		const cs = win.getComputedStyle(el);
		const decls: string[] = [];
		for (const p of PROPS) {
			const v = cs.getPropertyValue(p).trim();
			if (v && !v.includes("var(")) decls.push(`${p}:${v}`);
		}
		if (decls.length > 0) target.setAttribute("style", decls.join(";"));
	});
	clone.setAttribute("xmlns", SVG_NS);
	if (background) {
		const rect = doc.createElementNS(SVG_NS, "rect");
		rect.setAttribute("width", "100%");
		rect.setAttribute("height", "100%");
		rect.setAttribute("fill", background);
		clone.insertBefore(rect, clone.firstChild);
	}
	return new XMLSerializer().serializeToString(clone);
}

/** The note background color, resolved from the theme, for PNG and SVG backgrounds. */
export function themeBackground(el: Element): string {
	const win = el.ownerDocument.defaultView;
	if (!win) return "#ffffff";
	const v = win.getComputedStyle(el.ownerDocument.body).getPropertyValue("--background-primary").trim();
	return v || "#ffffff";
}

/** Pixel ratio for a PNG of the given size: 2x for crispness, lower for very large diagrams. */
export function pngRatio(width: number, height: number): number {
	const side = Math.max(width, height, 1);
	return Math.max(0.25, Math.min(2, MAX_PNG_SIDE / side));
}

/** Draw standalone SVG markup onto a canvas and encode it as PNG. */
export async function svgToPng(doc: Document, svgText: string, width: number, height: number, background: string): Promise<Blob> {
	const ratio = pngRatio(width, height);
	const img = new Image();
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error("The diagram could not be drawn as an image."));
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
	});
	const canvas = doc.createElement("canvas");
	canvas.width = Math.ceil(width * ratio);
	canvas.height = Math.ceil(height * ratio);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas drawing is not available.");
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve, reject) => {
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png");
	});
}
