import { describe, expect, it } from "vitest";
import type { Instr, Node } from "../src/ir/types";
import { reduceSeriesParallel, type SpEdge } from "../src/parsers/seriesParallel";

const el = (name: string): Instr => ({ kind: "instr", op: name, shape: "contact", operands: [] });
const e = (from: number, to: number, name: string | undefined, order: number, pin?: [string, number]): SpEdge => {
	const edge: SpEdge = { from, to, order };
	if (name) edge.node = el(name);
	if (pin) {
		edge.pin = pin[0];
		edge.pinRank = pin[1];
	}
	return edge;
};

/** Compact text form: series "a b", parallel "[x | y]", pin parallel "[x>CU | y>RESET]". */
function show(nodes: Node[]): string {
	return nodes
		.map((n) => {
			if (n.kind === "instr") return n.op;
			if (n.kind === "series") return show(n.items);
			return `[${n.legs.map((l, i) => show(l.items) + (n.pins ? `>${n.pins[i]}` : "")).join(" | ")}]`;
		})
		.join(" ");
}

const reduce = (edges: SpEdge[], source = 0, sink = 9) => {
	const r = reduceSeriesParallel(edges, source, sink);
	return r.ok ? show(r.body.items) : `FAIL: ${r.reason}`;
};

describe("series-parallel reduction", () => {
	it("joins a chain into a series", () => {
		expect(reduce([e(0, 1, "a", 0), e(1, 2, "b", 1), e(2, 9, "c", 2)])).toBe("a b c");
	});

	it("builds parallels with legs in document order, flattening nested parallels", () => {
		expect(reduce([e(0, 1, "b", 1), e(0, 1, "a", 0), e(0, 1, "c", 2), e(1, 9, "out", 3)])).toBe("[a | b | c] out");
	});

	it("keeps leg order when a later leg sorts between earlier ones", () => {
		// Legs a (0) and c (2) merge first; b (1) must land between them.
		expect(reduce([e(0, 1, "a", 0), e(0, 1, "c", 2), e(0, 2, "b", 1), e(2, 1, undefined, 1), e(1, 9, "out", 3)])).toBe(
			"[a | b | c] out",
		);
	});

	it("handles a branch around a series pair and parallel outputs", () => {
		const r = reduce([e(0, 1, "a", 0), e(1, 2, "b", 1), e(0, 2, "c", 2), e(2, 9, "y1", 3), e(2, 9, "y2", 4)]);
		expect(r).toBe("[a b | c] [y1 | y2]");
	});

	it("bundles legs that feed different pins of a block", () => {
		const r = reduce([
			e(0, 1, "sensor", 0),
			e(1, 2, "R_TRIG", 1),
			e(0, 3, "reset", 2),
			e(2, 4, undefined, 3, ["CU", 0]),
			e(3, 4, undefined, 3, ["RESET", 1]),
			e(4, 5, "CTU", 3),
			e(5, 9, "done", 4),
		]);
		expect(r).toBe("[sensor R_TRIG>CU | reset>RESET] CTU done");
	});

	it("orders pin legs by pin rank, not document order", () => {
		const r = reduce([e(0, 3, "reset", 0), e(0, 2, "main", 5), e(2, 4, undefined, 5, ["CU", 0]), e(3, 4, undefined, 5, ["RESET", 1]), e(4, 9, "CTU", 6)]);
		expect(r).toBe("[main>CU | reset>RESET] CTU");
	});

	it("reports bridge wiring as not series-parallel", () => {
		const r = reduce([e(0, 1, "a", 0), e(0, 2, "b", 1), e(1, 2, "c", 2), e(1, 9, "y1", 3), e(2, 9, "y2", 4)]);
		expect(r).toMatch(/^FAIL: The network is not series-parallel/);
	});

	it("reports a bypassed element", () => {
		expect(reduce([e(0, 0, "a", 0), e(0, 9, "b", 1)])).toMatch(/^FAIL: An element is bypassed/);
	});
});
