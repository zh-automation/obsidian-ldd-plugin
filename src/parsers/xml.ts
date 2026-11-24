/**
 * Minimal, tolerant XML reader for pasted L5X (and later PLCopen) text.
 *
 * Why not DOMParser: pasted snippets are often fragments (several <Rung> elements with no root),
 * and DOMParser reports errors without usable positions. This reader accepts any number of top-level
 * elements, keeps source offsets for every node, and on malformed input returns what it read so far
 * plus one error with its offset.
 *
 * Supported: elements, attributes (single or double quotes), text, CDATA, comments, processing
 * instructions and DOCTYPE (skipped), the five predefined entities and numeric character references.
 * Not supported (not needed for Logix or PLCopen exports): DTD-defined entities, namespaces as such
 * (names keep their prefix; see localName).
 */

export interface XmlElement {
	kind: "element";
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	/** Offset of '<'. */
	start: number;
}

export interface XmlText {
	kind: "text";
	text: string;
	/** Offset of the first content character. */
	start: number;
	/** True for CDATA (content is verbatim, so offsets inside it map 1:1 to the source). */
	cdata: boolean;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlResult {
	children: XmlNode[];
	error?: { pos: number; message: string };
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_.:]*/y;
const ATTR = /([A-Za-z_:][-A-Za-z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const CLOSE = /<\/\s*([A-Za-z_:][-A-Za-z0-9_.:]*)\s*>/y;
const WS = /\s*/y;

export function parseXml(src: string): XmlResult {
	const doc: XmlElement = { kind: "element", name: "#document", attrs: {}, children: [], start: 0 };
	const stack: XmlElement[] = [doc];
	const n = src.length;
	let pos = 0;
	const fail = (at: number, message: string): XmlResult => ({ children: doc.children, error: { pos: at, message } });
	const top = () => stack[stack.length - 1] ?? doc;

	while (pos < n) {
		const lt = src.indexOf("<", pos);
		const textEnd = lt === -1 ? n : lt;
		if (textEnd > pos && stack.length > 1) {
			const raw = src.slice(pos, textEnd);
			if (/\S/.test(raw)) top().children.push({ kind: "text", text: decodeEntities(raw), start: pos, cdata: false });
		}
		if (lt === -1) break;
		pos = lt;

		if (src.startsWith("<!--", pos)) {
			const e = src.indexOf("-->", pos + 4);
			if (e < 0) return fail(pos, "XML comment is not closed with '-->'.");
			pos = e + 3;
			continue;
		}
		if (src.startsWith("<![CDATA[", pos)) {
			const e = src.indexOf("]]>", pos + 9);
			if (e < 0) return fail(pos, "CDATA section is not closed with ']]>'.");
			if (stack.length > 1) top().children.push({ kind: "text", text: src.slice(pos + 9, e), start: pos + 9, cdata: true });
			pos = e + 3;
			continue;
		}
		if (src.startsWith("<?", pos)) {
			const e = src.indexOf("?>", pos + 2);
			if (e < 0) return fail(pos, "'<?' is not closed with '?>'.");
			pos = e + 2;
			continue;
		}
		if (src.startsWith("<!", pos)) {
			const e = src.indexOf(">", pos + 2);
			if (e < 0) return fail(pos, "'<!' is not closed with '>'.");
			pos = e + 1;
			continue;
		}

		if (src[pos + 1] === "/") {
			CLOSE.lastIndex = pos;
			const m = CLOSE.exec(src);
			if (!m) return fail(pos, "Malformed closing tag.");
			const name = m[1] ?? "";
			const cur = top();
			if (stack.length === 1) return fail(pos, `Closing tag </${name}> has no matching opening tag.`);
			if (cur.name !== name) return fail(pos, `Expected </${cur.name}> but found </${name}>.`);
			stack.pop();
			pos = CLOSE.lastIndex;
			continue;
		}

		NAME.lastIndex = pos + 1;
		const nm = NAME.exec(src);
		if (!nm) return fail(pos, "Expected a tag name after '<'.");
		const el: XmlElement = { kind: "element", name: nm[0], attrs: {}, children: [], start: pos };
		top().children.push(el);
		pos = NAME.lastIndex;
		for (;;) {
			WS.lastIndex = pos;
			WS.exec(src);
			pos = WS.lastIndex;
			if (src.startsWith("/>", pos)) {
				pos += 2;
				break;
			}
			if (src[pos] === ">") {
				pos += 1;
				stack.push(el);
				break;
			}
			ATTR.lastIndex = pos;
			const am = ATTR.exec(src);
			if (!am) return fail(pos, pos >= n ? `Tag <${el.name}> is not closed with '>'.` : `Malformed attribute in <${el.name}>.`);
			el.attrs[am[1] ?? ""] = decodeEntities(am[2] ?? am[3] ?? "");
			pos = ATTR.lastIndex;
		}
	}

	if (stack.length > 1) {
		const open = top();
		return fail(open.start, `<${open.name}> is not closed.`);
	}
	return { children: doc.children };
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (whole, ref: string) => {
		if (ref.startsWith("#x")) return safeChar(parseInt(ref.slice(2), 16)) ?? whole;
		if (ref.startsWith("#")) return safeChar(parseInt(ref.slice(1), 10)) ?? whole;
		return NAMED[ref] ?? whole;
	});
}

function safeChar(code: number): string | undefined {
	return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** Element name without a namespace prefix. */
export function localName(name: string): string {
	const i = name.indexOf(":");
	return i < 0 ? name : name.slice(i + 1);
}

export function elements(nodes: readonly XmlNode[], name?: string): XmlElement[] {
	return nodes.filter((c): c is XmlElement => c.kind === "element" && (name === undefined || localName(c.name) === name));
}

export function firstElement(el: XmlElement, name: string): XmlElement | undefined {
	return elements(el.children, name)[0];
}

/** All text under an element, nested markup included (XHTML comments use <p>, <br>, ...). */
export function deepText(el: XmlElement): string {
	return el.children.map((c) => (c.kind === "text" ? c.text : deepText(c))).join("");
}

/** Concatenated direct text of an element, with the offset of its first text node. */
export function textContent(el: XmlElement): { text: string; start: number; cdata: boolean } {
	const texts = el.children.filter((c): c is XmlText => c.kind === "text");
	const first = texts[0];
	return { text: texts.map((t) => t.text).join(""), start: first?.start ?? el.start, cdata: first?.cdata ?? false };
}
