/**
 * Layout engine: IR rungs -> flat list of drawing primitives with absolute coordinates.
 *
 * Pure and deterministic (no DOM, fixed monospace character width) so it is unit-testable.
 *
 * Every measured node has a width `w`, height `h`, and anchor `a`: the y offset of its power wire
 * from its own top. Series align children on a shared anchor; parallels stack legs and join them
 * with vertical branch lines.
 */
import type { Instr, InstrVariant, Node, Rung, Series } from "../ir/types";

export type Align = "inline" | "right";

export interface LayoutStyle {
	charW: number;
	lineH: number;
	symW: number;
	symH: number;
	elemPadX: number;
	/** Contact/coil cell width in characters. Every contact and coil gets this width; longer tags wrap. */
	cellChars: number;
	legGap: number;
	branchStub: number;
	rungGap: number;
	rungPadX: number;
	minInnerW: number;
	boxPadX: number;
	boxPadY: number;
	numbers: boolean;
	/** "inline": outputs follow the last input, then a wire to the right rail (Studio 5000). "right": trailing outputs sit against the right rail. */
	align: Align;
	/** Contact symbol style: Rockwell "] [" or IEC "| |". */
	symbols: Symbols;
	/**
	 * Total drawing width to wrap rungs into (layout units); 0 never wraps. Wide rungs break at
	 * top-level element boundaries and continue on the next row, marked ">>" at both ends.
	 */
	wrapWidth: number;
}

export type Symbols = "rockwell" | "iec";

/** Defaults assume a 12px monospace font (about 0.6em per character). */
export const DEFAULT_STYLE: LayoutStyle = {
	charW: 7.2,
	lineH: 14,
	symW: 28,
	symH: 18,
	elemPadX: 10,
	cellChars: 16,
	legGap: 6,
	branchStub: 10,
	rungGap: 18,
	rungPadX: 12,
	minInnerW: 420,
	boxPadX: 8,
	boxPadY: 4,
	numbers: true,
	align: "inline",
	symbols: "rockwell",
	wrapWidth: 0,
};

export type TextClass =
	| "tag"
	| "num"
	| "badge"
	| "comment"
	| "box-title"
	| "box-desc"
	| "box-name"
	| "box-text"
	| "pin"
	| "instance"
	| "wrap"
	| "err-text";
export type LineClass = "wire" | "rail" | "err-wire";

export type Prim =
	| { t: "line"; cls: LineClass; x1: number; y1: number; x2: number; y2: number }
	| { t: "contact"; x: number; y: number; w: number; variant?: InstrVariant; label?: string; tip: string }
	| { t: "coil"; x: number; y: number; w: number; variant?: InstrVariant; label?: string; tip: string }
	| { t: "box"; x: number; y: number; w: number; h: number; tip: string }
	| { t: "text"; cls: TextClass; x: number; y: number; text: string; anchor: "start" | "middle" | "end" };

export interface Geometry {
	width: number;
	height: number;
	prims: Prim[];
	symbols: Symbols;
}

// ---------------------------------------------------------------------------------------------
// Measurement

interface BoxRow {
	name?: string;
	value: string;
}

interface MInstr {
	kind: "instr";
	node: Instr;
	w: number;
	h: number;
	a: number;
	labelLines: string[];
	symW: number;
	boxW: number;
	boxH: number;
	rows: BoxRow[];
	/** Width of the operand-name column in characters (0 when rows are unnamed). */
	nameChars: number;
	pins: string[];
	pinW: number;
	/** IEC function block geometry (node.form === "iec"). */
	iec?: IecBox;
}

interface IecPin {
	name: string;
	value: string;
	power: boolean;
	/** Row y relative to the rung wire (the block's main power pin is 0). */
	dy: number;
}

interface IecBox {
	ins: IecPin[];
	outs: IecPin[];
	/** Width left of the box (input values and lead-in wire) and right of it (output values). */
	leftW: number;
	rightW: number;
	/** Box top relative to the element top. */
	boxTop: number;
	boxH: number;
}

interface MSeries {
	kind: "series";
	w: number;
	h: number;
	a: number;
	kids: Measured[];
}
interface MParallel {
	kind: "parallel";
	w: number;
	h: number;
	a: number;
	legs: MSeries[];
	/** Legs feed these pins of the IEC block after this parallel instead of joining. */
	pins?: string[];
	/** For pin legs: the y of each target pin relative to the rung wire (set by the series). */
	targets?: number[];
}
type Measured = MInstr | MSeries | MParallel;

const LABEL_GAP = 3;
const PIN_STUB = 6;
const BOX_MARGIN_TOP = 4;
const BOX_MARGIN_BOTTOM = 6;
const EMPTY_LEG_A = 8;
const EMPTY_LEG_H = 14;

function measure(node: Node, s: LayoutStyle): Measured {
	switch (node.kind) {
		case "instr":
			return measureInstr(node, s);
		case "series":
			return measureSeries(node, s);
		case "parallel": {
			const legs = node.legs.map((l) => measureSeries(l, s));
			const inner = Math.max(0, ...legs.map((l) => l.w));
			const h = legs.reduce((sum, l) => sum + l.h, 0) + s.legGap * Math.max(0, legs.length - 1);
			const m: MParallel = { kind: "parallel", w: inner + 2 * s.branchStub, h, a: legs[0]?.a ?? EMPTY_LEG_A, legs };
			if (node.pins) m.pins = node.pins;
			return m;
		}
	}
}

/** Wire y of each leg of a parallel, relative to the parallel's anchor. */
function legOffsets(p: MParallel, s: LayoutStyle): number[] {
	let top = 0;
	return p.legs.map((leg) => {
		const y = top + leg.a - p.a;
		top += leg.h + s.legGap;
		return y;
	});
}

function measureSeries(node: Series, s: LayoutStyle): MSeries {
	if (node.items.length === 0) return { kind: "series", w: 0, h: EMPTY_LEG_H, a: EMPTY_LEG_A, kids: [] };
	const kids = node.items.map((n) => measure(n, s));
	// Legs that feed different pins of the next IEC block: stretch the block so each pin lines up
	// with its leg, and remember where each leg has to end.
	kids.forEach((k, i) => {
		const next = kids[i + 1];
		if (k.kind !== "parallel" || !k.pins || next?.kind !== "instr" || next.node.form !== "iec") return;
		const offsets = legOffsets(k, s);
		const want = new Map(k.pins.map((p, j) => [p, offsets[j] ?? 0]));
		const box = measureIecBox(next.node, s, want);
		kids[i + 1] = box;
		k.targets = k.pins.map((p) => box.iec?.ins.find((pin) => pin.name === p)?.dy ?? 0);
	});
	const a = Math.max(...kids.map((k) => k.a));
	const h = Math.max(...kids.map((k) => a - k.a + k.h));
	const w = kids.reduce((sum, k) => sum + k.w, 0);
	return { kind: "series", w, h, a, kids };
}

function operandText(instr: Instr, i: number): string {
	const v = instr.operands[i]?.value ?? "";
	return v === "" ? "?" : v;
}

const noBox = () => ({ boxW: 0, boxH: 0, rows: [] as BoxRow[], nameChars: 0, pins: [] as string[], pinW: 0 });

/**
 * IEC function block: type name at the top, instance name above, input pins on the left and
 * outputs on the right with their values outside the box. The main power pins sit on the rung
 * wire; `want` places extra power-input pins at the y of the legs that feed them.
 */
function measureIecBox(node: Instr, s: LayoutStyle, want: ReadonlyMap<string, number> = new Map()): MInstr {
	const ins: IecPin[] = [];
	let dy = -s.lineH;
	for (const o of node.operands) {
		if (o.hidden) continue;
		const natural = dy + s.lineH;
		dy = want.has(o.name ?? "") ? Math.max(natural, want.get(o.name ?? "") ?? natural) : natural;
		ins.push({ name: o.name ?? "", value: o.value, power: o.power === true, dy });
	}
	const outs: IecPin[] = (node.outPins ?? []).map((o, j) => ({ name: o.name ?? "", value: o.value, power: o.power === true, dy: j * s.lineH }));
	const maxDy = Math.max(0, ...ins.map((p) => p.dy), ...outs.map((p) => p.dy));

	const inChars = Math.max(0, ...ins.map((p) => p.name.length));
	const outChars = Math.max(0, ...outs.map((p) => p.name.length));
	const inner = Math.max(node.op.length, inChars + (inChars && outChars ? 2 : 0) + outChars);
	const boxW = Math.max(56, inner * s.charW + 2 * s.boxPadX);
	const valW = (pins: IecPin[]) => {
		const chars = Math.max(0, ...pins.filter((p) => !p.power).map((p) => p.value.length));
		return chars > 0 ? chars * s.charW + 2 * PIN_STUB + 4 : 2 * PIN_STUB;
	};
	const leftW = valW(ins);
	const rightW = valW(outs);

	const instH = node.instance ? s.lineH : 0;
	const boxTop = BOX_MARGIN_TOP + instH;
	const a = boxTop + s.boxPadY + s.lineH + s.lineH / 2;
	const boxH = s.boxPadY + s.lineH + maxDy + s.lineH + s.boxPadY;
	const instChars = node.instance?.length ?? 0;
	const w = Math.max(leftW + boxW + rightW, instChars * s.charW) + 2 * s.elemPadX;
	return {
		kind: "instr",
		node,
		w,
		h: boxTop + boxH + BOX_MARGIN_BOTTOM,
		a,
		labelLines: [],
		symW: 0,
		...noBox(),
		boxW,
		boxH,
		iec: { ins, outs, leftW, rightW, boxTop, boxH },
	};
}

function measureInstr(node: Instr, s: LayoutStyle): MInstr {
	if (node.form === "iec") return measureIecBox(node, s);
	if (node.shape === "box") {
		const rows: BoxRow[] = node.operands.flatMap((o) => {
			if (o.hidden) return [];
			const value = o.value === "" ? "?" : o.value;
			return [o.name ? { name: o.name, value } : { value }];
		});
		const nameChars = Math.max(0, ...rows.map((r) => r.name?.length ?? 0));
		const valueChars = Math.max(0, ...rows.map((r) => r.value.length));
		const rowChars = nameChars > 0 ? nameChars + 2 + valueChars : valueChars;
		const titleChars = node.op.length + (node.title ? 2 + node.title.length : 0);
		const boxW = Math.max(56, Math.max(titleChars, rowChars) * s.charW + 2 * s.boxPadX);
		const pins = (node.outPins ?? []).map((p) => p.name ?? p.value);
		const pinW = pins.length > 0 ? (Math.max(...pins.map((p) => p.length)) + 2) * s.charW + 2 * PIN_STUB + 2 : 0;
		const boxH = Math.max(1 + rows.length, pins.length) * s.lineH + 2 * s.boxPadY;
		return {
			kind: "instr",
			node,
			w: boxW + pinW + 2 * s.elemPadX,
			h: BOX_MARGIN_TOP + boxH + BOX_MARGIN_BOTTOM,
			a: BOX_MARGIN_TOP + s.boxPadY + s.lineH / 2,
			labelLines: [],
			symW: 0,
			boxW,
			boxH,
			rows,
			nameChars,
			pins,
			pinW,
		};
	}
	// Uniform cells (like the PLC editor) keep symbols in stacked branch legs vertically aligned.
	// Instructions without operands (MCR) get no tag label.
	const labelLines = node.operands.length > 0 ? wrapTag(operandText(node, 0), s.cellChars) : [];
	const inner = node.label ?? "";
	const symW = inner.length > 1 ? Math.max(s.symW, inner.length * s.charW + 16) : s.symW;
	const cellW = s.cellChars * s.charW + 8;
	const a = labelLines.length * s.lineH + LABEL_GAP + s.symH / 2;
	return {
		kind: "instr",
		node,
		w: Math.max(symW + 2 * s.elemPadX, cellW),
		h: a + s.symH / 2 + 4,
		a,
		labelLines,
		symW,
		boxW: 0,
		boxH: 0,
		rows: [],
		nameChars: 0,
		pins: [],
		pinW: 0,
	};
}

// ---------------------------------------------------------------------------------------------
// Placement

function tipOf(instr: Instr): string {
	if (instr.form === "iec") {
		const pins = [
			...instr.operands.filter((o) => !o.power).map((o) => `${o.name}:=${o.value || "?"}`),
			...(instr.outPins ?? []).filter((o) => !o.power && o.value).map((o) => `${o.name}=>${o.value}`),
		];
		return `${instr.instance ? `${instr.instance} : ` : ""}${instr.op}(${pins.join(", ")})`;
	}
	return `${instr.op}(${instr.operands.map((o) => o.value).join(",")})`;
}

function wire(out: Prim[], x1: number, x2: number, y: number): void {
	// Ignore slivers left by floating-point sums.
	if (x2 - x1 > 0.05) out.push({ t: "line", cls: "wire", x1, y1: y, x2, y2: y });
}

function place(m: Measured, x: number, top: number, availW: number, s: LayoutStyle, out: Prim[]): void {
	const wireY = top + m.a;
	switch (m.kind) {
		case "instr":
			placeInstr(m, x, top, s, out);
			break;
		case "series": {
			let cx = x;
			for (const k of m.kids) {
				place(k, cx, wireY - k.a, k.w, s, out);
				cx += k.w;
			}
			wire(out, cx, x + availW, wireY);
			return;
		}
		case "parallel": {
			let legTop = top;
			const ys: number[] = [];
			const innerW = m.w - 2 * s.branchStub;
			const toPins = m.targets !== undefined;
			const bendX = x + m.w - s.branchStub / 2;
			m.legs.forEach((leg, j) => {
				const y = legTop + leg.a;
				ys.push(y);
				wire(out, x, x + s.branchStub, y);
				place(leg, x + s.branchStub, legTop, innerW, s, out);
				const target = toPins ? wireY + (m.targets?.[j] ?? 0) : y;
				if (target === y) {
					wire(out, x + m.w - s.branchStub, x + m.w, y);
				} else {
					// Leg feeds a block pin at another height: bend to it.
					wire(out, x + m.w - s.branchStub, bendX, y);
					out.push({ t: "line", cls: "wire", x1: bendX, y1: y, x2: bendX, y2: target });
					wire(out, bendX, x + m.w, target);
				}
				legTop += leg.h + s.legGap;
			});
			const y0 = ys[0] ?? wireY;
			const yN = ys[ys.length - 1] ?? wireY;
			out.push({ t: "line", cls: "wire", x1: x, y1: y0, x2: x, y2: yN });
			if (!toPins) out.push({ t: "line", cls: "wire", x1: x + m.w, y1: y0, x2: x + m.w, y2: yN });
			break;
		}
	}
	wire(out, x + m.w, x + availW, wireY);
}

function placeInstr(m: MInstr, x: number, top: number, s: LayoutStyle, out: Prim[]): void {
	const node = m.node;
	const wireY = top + m.a;
	const tip = tipOf(node);

	if (m.iec) {
		placeIecBox(m, m.iec, x, top, wireY, tip, s, out);
		return;
	}

	if (node.shape === "box") {
		const bx = x + s.elemPadX;
		const by = top + BOX_MARGIN_TOP;
		const tx = bx + s.boxPadX;
		wire(out, x, bx, wireY);
		out.push({ t: "box", x: bx, y: by, w: m.boxW, h: m.boxH, tip });
		const rowMid = (row: number) => by + s.boxPadY + row * s.lineH + s.lineH / 2;
		const textY = (row: number) => rowMid(row) + 4;
		out.push({ t: "text", cls: "box-title", x: tx, y: textY(0), text: node.op, anchor: "start" });
		if (node.title) {
			out.push({ t: "text", cls: "box-desc", x: tx + (node.op.length + 2) * s.charW, y: textY(0), text: node.title, anchor: "start" });
		}
		const valueX = m.nameChars > 0 ? tx + (m.nameChars + 2) * s.charW : tx;
		m.rows.forEach((r, i) => {
			if (r.name) out.push({ t: "text", cls: "box-name", x: tx, y: textY(i + 1), text: r.name, anchor: "start" });
			out.push({ t: "text", cls: "box-text", x: valueX, y: textY(i + 1), text: r.value, anchor: "start" });
		});
		// Status pins: -(EN)- on the right edge, one per row; the rung continues from the first.
		const px = bx + m.boxW;
		m.pins.forEach((pin, i) => {
			const y = rowMid(i);
			const mid = px + m.pinW / 2;
			const half = ((pin.length + 2) * s.charW) / 2 + 1;
			wire(out, px, mid - half, y);
			out.push({ t: "text", cls: "pin", x: mid, y: y + 4, text: `(${pin})`, anchor: "middle" });
			wire(out, mid + half, px + m.pinW, y);
		});
		wire(out, px + m.pinW, x + m.w, wireY);
		return;
	}

	const sx = x + (m.w - m.symW) / 2;
	wire(out, x, sx, wireY);
	const sym: Extract<Prim, { t: "contact" | "coil" }> = { t: node.shape, x: sx, y: wireY, w: m.symW, tip };
	if (node.variant) sym.variant = node.variant;
	if (node.label) sym.label = node.label;
	out.push(sym);
	wire(out, sx + m.symW, x + m.w, wireY);
	const cx = x + m.w / 2;
	m.labelLines.forEach((line, i) => {
		out.push({ t: "text", cls: "tag", x: cx, y: top + i * s.lineH + s.lineH - 3, text: line, anchor: "middle" });
	});
}

function placeIecBox(m: MInstr, b: IecBox, x: number, top: number, wireY: number, tip: string, s: LayoutStyle, out: Prim[]): void {
	const node = m.node;
	const bx = x + s.elemPadX + b.leftW;
	const by = top + b.boxTop;
	const right = bx + m.boxW;
	out.push({ t: "box", x: bx, y: by, w: m.boxW, h: b.boxH, tip });
	if (node.instance) {
		out.push({ t: "text", cls: "instance", x: bx + m.boxW / 2, y: by - 4, text: node.instance, anchor: "middle" });
	}
	out.push({ t: "text", cls: "box-title", x: bx + m.boxW / 2, y: by + s.boxPadY + s.lineH - 3, text: node.op, anchor: "middle" });

	for (const p of b.ins) {
		const y = wireY + p.dy;
		out.push({ t: "text", cls: "box-name", x: bx + s.boxPadX, y: y + 4, text: p.name, anchor: "start" });
		if (p.power) {
			wire(out, x, bx, y);
		} else if (p.value !== "") {
			wire(out, bx - PIN_STUB, bx, y);
			out.push({ t: "text", cls: "box-text", x: bx - PIN_STUB - 3, y: y + 4, text: p.value, anchor: "end" });
		}
	}
	let powerOut = false;
	for (const p of b.outs) {
		const y = wireY + p.dy;
		out.push({ t: "text", cls: "box-name", x: right - s.boxPadX, y: y + 4, text: p.name, anchor: "end" });
		if (p.power && p.dy === 0) {
			powerOut = true;
		} else if (p.value !== "") {
			wire(out, right, right + PIN_STUB, y);
			out.push({ t: "text", cls: "box-text", x: right + PIN_STUB + 3, y: y + 4, text: p.value, anchor: "start" });
		}
	}
	// The rung continues from the power output (or the box edge when there is none).
	if (powerOut || b.outs.length === 0) wire(out, right, x + m.w, wireY);
}

// ---------------------------------------------------------------------------------------------
// Rungs

function isOutput(m: Measured): boolean {
	switch (m.kind) {
		case "instr":
			return m.node.role ? m.node.role === "output" : m.node.shape !== "contact";
		case "series":
			return m.kids.length > 0 && m.kids.every(isOutput);
		case "parallel":
			return m.legs.every(isOutput);
	}
}

/** Marker drawn where a wrapped rung leaves one row and picks up on the next. */
export const WRAP_MARK = ">>";
const ROW_GAP = 10;
const RIGHT_MARGIN = 6;
const MIN_WRAPPED_INNER = 200;

/**
 * Split a rung's top-level elements into rows no wider than `limit`, greedily, never splitting an
 * element (a branch moves as a whole). An element wider than the limit gets a row to itself.
 */
function packRows(kids: Measured[], limit: number): Measured[][] {
	const rows: Measured[][] = [];
	let cur: Measured[] = [];
	let w = 0;
	for (const k of kids) {
		if (cur.length > 0 && w + k.w > limit) {
			rows.push(cur);
			cur = [];
			w = 0;
		}
		cur.push(k);
		w += k.w;
	}
	if (cur.length > 0) rows.push(cur);
	return rows;
}

/** Index where the trailing run of output elements starts (kids.length when there is none). */
function outputStart(kids: Measured[]): number {
	let i = kids.length;
	while (i > 0) {
		const k = kids[i - 1];
		if (!k || !isOutput(k)) break;
		i--;
	}
	return i;
}

export function layoutRungs(rungs: Rung[], style: Partial<LayoutStyle> = {}): Geometry {
	const s: LayoutStyle = { ...DEFAULT_STYLE, ...style };
	const out: Prim[] = [];
	const measured = rungs.map((r) => measureSeries(r.body, s));

	// Minimum wire position and height: as if the rung held one contact with a one-line tag.
	const minA = s.lineH + LABEL_GAP + s.symH / 2;
	const minH = minA + s.symH / 2 + 4;

	const maxNum = Math.max(0, ...rungs.map((r) => r.number ?? 0));
	const numW = s.numbers ? String(maxNum).length * s.charW + 14 : 6;
	// Rung types other than N (pending or test edits) get a marker in the left margin.
	const badgeChars = Math.max(0, ...rungs.map((r) => r.type?.length ?? 0));
	const badgeW = badgeChars > 0 ? badgeChars * s.charW + 8 : 0;
	const railL = numW + badgeW;

	// Width between the rails. Without wrapping it fits the widest rung. With wrapping it is capped
	// at the available width, but never narrower than the widest single element (which can't split).
	const markW = WRAP_MARK.length * s.charW + 8;
	const natural = Math.max(s.minInnerW, ...measured.map((m) => m.w + 2 * s.rungPadX));
	let innerW = natural;
	if (s.wrapWidth > 0) {
		const avail = s.wrapWidth - railL - RIGHT_MARGIN;
		if (natural > avail) {
			const tooWide = measured.filter((m) => m.w + 2 * s.rungPadX > avail);
			const widestPiece = Math.max(0, ...tooWide.flatMap((m) => m.kids.map((k) => k.w)));
			innerW = Math.max(avail, widestPiece + 2 * s.rungPadX + 2 * markW, MIN_WRAPPED_INNER);
		}
	}
	const railR = railL + innerW;
	const commentChars = Math.max(10, Math.floor((innerW - 2 * s.rungPadX) / s.charW));

	const top0 = 6;
	let y = top0;
	rungs.forEach((rung, i) => {
		const m = measured[i];
		if (!m) return;

		if (rung.comment) {
			for (const line of wrapText(rung.comment, commentChars)) {
				out.push({ t: "text", cls: "comment", x: railL + s.rungPadX, y: y + s.lineH - 3, text: line, anchor: "start" });
				y += s.lineH;
			}
			y += 2;
		}

		let firstWireY: number;
		if (rung.error) {
			const errLines = wrapText(`Parse error: ${rung.error}`, commentChars);
			const a = Math.max(minA, errLines.length * s.lineH + 6);
			const wireY = y + a;
			const textTop = wireY - 6 - errLines.length * s.lineH;
			errLines.forEach((line, li) => {
				out.push({
					t: "text",
					cls: "err-text",
					x: railL + s.rungPadX,
					y: textTop + li * s.lineH + s.lineH - 3,
					text: line,
					anchor: "start",
				});
			});
			out.push({ t: "line", cls: "err-wire", x1: railL, y1: wireY, x2: railR, y2: wireY });
			firstWireY = wireY;
			y += Math.max(minH, a + 8);
		} else {
			const rows = m.w + 2 * s.rungPadX > innerW ? packRows(m.kids, innerW - 2 * s.rungPadX - 2 * markW) : [m.kids];
			firstWireY = y;
			rows.forEach((row, r) => {
				const first = r === 0;
				const last = r === rows.length - 1;
				const a = Math.max(minA, ...row.map((k) => k.a));
				const h = Math.max(minH, ...row.map((k) => a - k.a + k.h));
				const wireY = y + a;
				if (first) firstWireY = wireY;

				let cx = railL + s.rungPadX;
				if (first) {
					wire(out, railL, cx, wireY);
				} else {
					// Continued from the row above.
					out.push({ t: "text", cls: "wrap", x: cx, y: wireY + 4, text: WRAP_MARK, anchor: "start" });
					cx += markW;
				}
				const split = last && s.align === "right" ? outputStart(row) : row.length;
				const endX = last ? railR - s.rungPadX : railR - s.rungPadX - markW;
				row.forEach((k, idx) => {
					if (idx === split) {
						const outW = row.slice(split).reduce((sum, kk) => sum + kk.w, 0);
						const outX = endX - outW;
						wire(out, cx, outX, wireY);
						cx = Math.max(cx, outX);
					}
					place(k, cx, wireY - k.a, k.w, s, out);
					cx += k.w;
				});
				if (last) {
					wire(out, cx, railR, wireY);
				} else {
					wire(out, cx, endX + 2, wireY);
					out.push({ t: "text", cls: "wrap", x: endX + 4, y: wireY + 4, text: WRAP_MARK, anchor: "start" });
				}
				y += h + (last ? 0 : ROW_GAP);
			});
		}

		if (s.numbers && rung.number !== undefined) {
			out.push({ t: "text", cls: "num", x: railL - 6, y: firstWireY + 4, text: String(rung.number), anchor: "end" });
		}
		if (rung.type) {
			out.push({ t: "text", cls: "badge", x: 4, y: firstWireY + 4, text: rung.type, anchor: "start" });
		}

		y += s.rungGap;
	});

	const bottom = Math.max(y - s.rungGap + 4, top0 + minH);
	out.push({ t: "line", cls: "rail", x1: railL, y1: 2, x2: railL, y2: bottom });
	out.push({ t: "line", cls: "rail", x1: railR, y1: 2, x2: railR, y2: bottom });

	return { width: Math.ceil(railR + 6), height: Math.ceil(bottom + 4), prims: out, symbols: s.symbols };
}

// ---------------------------------------------------------------------------------------------
// Text wrapping

const isMemberBreak = (prev?: string, next?: string) => prev === "." || prev === ":" || next === "[";
const isUnderscoreBreak = (prev?: string) => prev === "_";

/** Largest cut position in (min, max] where `test(prev, next)` holds, if any. */
function lastBreak(s: string, max: number, min: number, test: (p?: string, n?: string) => boolean): number | undefined {
	for (let i = max; i > min; i--) if (test(s[i - 1], s[i])) return i;
	return undefined;
}

/**
 * Wrap a tag name to lines of at most `max` characters. Break preference: a member boundary
 * (after '.' or ':', before '[') in the right half of the line, then '_' in the right half, then
 * the same two anywhere past the third character, then a hard cut.
 */
export function wrapTag(tag: string, max: number): string[] {
	const lines: string[] = [];
	const half = Math.floor(max / 2);
	let rest = tag;
	while (rest.length > max) {
		const cut =
			lastBreak(rest, max, half, isMemberBreak) ??
			lastBreak(rest, max, half, isUnderscoreBreak) ??
			lastBreak(rest, max, 2, isMemberBreak) ??
			lastBreak(rest, max, 2, isUnderscoreBreak) ??
			max;
		lines.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	lines.push(rest);
	return lines;
}

/** Word-wrap free text to lines of at most `max` characters, keeping explicit newlines. */
export function wrapText(text: string, max: number): string[] {
	const lines: string[] = [];
	for (const para of text.split(/\r?\n/)) {
		let line = "";
		for (const word of para.split(/\s+/).filter((w) => w !== "")) {
			let wrd = word;
			while (wrd.length > max) {
				if (line) {
					lines.push(line);
					line = "";
				}
				lines.push(wrd.slice(0, max));
				wrd = wrd.slice(max);
			}
			if (!line) line = wrd;
			else if (line.length + 1 + wrd.length <= max) line += ` ${wrd}`;
			else {
				lines.push(line);
				line = wrd;
			}
		}
		lines.push(line);
	}
	return lines;
}
