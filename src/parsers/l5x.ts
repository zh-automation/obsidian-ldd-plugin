/**
 * L5X front-end. Accepts any of:
 *   - one or more bare <Rung> elements (a fragment, no root needed)
 *   - an <RLLContent> or <Routine> element
 *   - a full L5X document (controller, program, routine, or rung export)
 *
 * Each <Rung>'s <Text> is neutral text and goes through the neutral text parser. Number and Type
 * attributes and the <Comment> are carried over. Ladder routines become sections titled
 * "Program / Routine" (or "AOI / Logic"); ST, FBD, and SFC routines are skipped with a notice.
 *
 * Rung exports from Studio 5000 carry the surrounding program and routine as context. When any rung
 * is marked Use="Target", only those rungs are drawn.
 *
 * When the document includes <AddOnInstructionDefinition>s, AOI calls get their parameter names:
 * operands are the instance tag followed by the Required parameters in definition order.
 */
import type { Rung } from "../ir/types";
import type { AoiDef } from "../instructions/logix";
import { bump, describeCounts, LineIndex, type FrontEndResult, type Section } from "./common";
import { parseNeutralText, type ParseMessage } from "./neutralText";
import { elements, firstElement, localName, parseXml, textContent, type XmlElement, type XmlNode } from "./xml";

/** Elements whose Name prefixes the titles of the routines inside them. */
const OWNERS = new Set(["Program", "AddOnInstructionDefinition", "Phase", "EquipmentPhase", "EquipmentSequence"]);

export function parseL5X(src: string): FrontEndResult {
	const xml = parseXml(src);
	const idx = new LineIndex(src);
	const errors: ParseMessage[] = [];
	const notices: string[] = [];
	if (xml.error) errors.push({ ...idx.loc(xml.error.pos), message: `XML: ${xml.error.message}` });

	const aoi = collectAoiDefs(xml.children);
	const targetOnly = hasTargetRung(xml.children);
	const sections: Section[] = [];
	const loose: Rung[] = [];
	const skipped = new Map<string, number>();

	const rungOf = (el: XmlElement): Rung | undefined => {
		if (targetOnly && el.attrs.Use !== "Target") return undefined;
		return readRung(el, idx, errors, aoi);
	};

	const walk = (nodes: readonly XmlNode[], owner: string | undefined): void => {
		for (const el of elements(nodes)) {
			const name = localName(el.name);
			if (name === "Routine") {
				const type = el.attrs.Type ?? "RLL";
				if (type !== "RLL") {
					bump(skipped, type);
					continue;
				}
				const rungs = collectRungs(el).flatMap((r) => rungOf(r) ?? []);
				if (targetOnly && rungs.length === 0) continue;
				const title = [owner, el.attrs.Name].filter(Boolean).join(" / ");
				sections.push(title ? { title, rungs } : { rungs });
			} else if (name === "Rung") {
				const r = rungOf(el);
				if (r) loose.push(r);
			} else {
				walk(el.children, OWNERS.has(name) && el.attrs.Name ? el.attrs.Name : owner);
			}
		}
	};
	walk(xml.children, undefined);

	if (loose.length > 0) sections.unshift({ rungs: loose });
	if (skipped.size > 0 && !targetOnly) {
		const total = [...skipped.values()].reduce((a, b) => a + b, 0);
		notices.push(`Skipped ${total} non-ladder routine${total === 1 ? "" : "s"} (${describeCounts(skipped)}).`);
	}
	if (sections.length === 0 && errors.length === 0) notices.push("No <Rung> elements found.");
	return { sections, errors, notices };
}

/** <Rung> elements under a routine, normally inside <RLLContent>. */
function collectRungs(el: XmlElement): XmlElement[] {
	const out: XmlElement[] = [];
	const visit = (nodes: readonly XmlNode[]) => {
		for (const c of elements(nodes)) {
			if (localName(c.name) === "Rung") out.push(c);
			else visit(c.children);
		}
	};
	visit(el.children);
	return out;
}

function readRung(el: XmlElement, idx: LineIndex, errors: ParseMessage[], aoi: ReadonlyMap<string, AoiDef>): Rung {
	const number = /^\d+$/.test(el.attrs.Number ?? "") ? Number(el.attrs.Number) : undefined;
	const type = el.attrs.Type;
	const comment = readComment(el);
	const textEl = firstElement(el, "Text");

	let rung: Rung;
	if (!textEl) {
		const message = "Rung has no <Text> element.";
		errors.push({ ...idx.loc(el.start), message });
		rung = { body: { kind: "series", items: [] }, error: message };
	} else {
		const { text, start } = textContent(textEl);
		const parsed = parseNeutralText(text, { aoi, origin: idx.loc(start) });
		errors.push(...parsed.errors);
		const [first, second] = parsed.rungs;
		if (second?.span) {
			const { line, col } = second.span;
			errors.push({ line, col, message: "More than one rung in one <Text>; only the first is drawn." });
		}
		rung = first ?? { body: { kind: "series", items: [] } };
		delete rung.comment;
	}
	if (number !== undefined) rung.number = number;
	if (type && type !== "N") rung.type = type;
	if (comment) rung.comment = comment;
	return rung;
}

/** Plain <Comment> text, or the first <LocalizedComment> in multi-language projects. */
function readComment(rung: XmlElement): string | undefined {
	const c = firstElement(rung, "Comment");
	if (!c) return undefined;
	const localized = firstElement(c, "LocalizedComment");
	const text = textContent(localized ?? c).text.replace(/\r\n?/g, "\n").trim();
	return text === "" ? undefined : text;
}

function hasTargetRung(nodes: readonly XmlNode[]): boolean {
	for (const el of elements(nodes)) {
		if (localName(el.name) === "Rung" && el.attrs.Use === "Target") return true;
		if (hasTargetRung(el.children)) return true;
	}
	return false;
}

/** AOI definitions in the document, keyed by upper-case name. */
export function collectAoiDefs(nodes: readonly XmlNode[]): Map<string, AoiDef> {
	const out = new Map<string, AoiDef>();
	const visit = (ns: readonly XmlNode[]) => {
		for (const el of elements(ns)) {
			if (localName(el.name) === "AddOnInstructionDefinition" && el.attrs.Name) {
				const params = firstElement(el, "Parameters");
				const required = params
					? elements(params.children, "Parameter")
							.filter((p) => p.attrs.Required === "true" && p.attrs.Name)
							.map((p) => p.attrs.Name ?? "")
					: [];
				out.set(el.attrs.Name.toUpperCase(), { name: el.attrs.Name, params: required });
			} else {
				visit(el.children);
			}
		}
	};
	visit(nodes);
	return out;
}
