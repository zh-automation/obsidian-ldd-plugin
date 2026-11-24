import { describe, expect, it } from "vitest";
import { decodeEntities, elements, parseXml, textContent, type XmlElement } from "../src/parsers/xml";

const el = (n: unknown) => n as XmlElement;

describe("parseXml", () => {
	it("accepts fragments with several top-level elements", () => {
		const r = parseXml('<Rung Number="0"/>\n<Rung Number="1"></Rung>');
		expect(r.error).toBeUndefined();
		expect(elements(r.children).map((e) => e.attrs.Number)).toEqual(["0", "1"]);
	});

	it("keeps CDATA verbatim with the source offset of its first character", () => {
		const src = "<Text>\n<![CDATA[XIC(A) & <B>]]>\n</Text>";
		const t = textContent(el(parseXml(src).children[0]));
		expect(t.text).toBe("XIC(A) & <B>");
		expect(t.cdata).toBe(true);
		expect(src.slice(t.start, t.start + 6)).toBe("XIC(A)");
	});

	it("decodes entities in text and attributes", () => {
		const r = parseXml(`<a b='x &amp; "y"'>1 &lt; 2 &#x41;&#66;</a>`);
		const a = el(r.children[0]);
		expect(a.attrs.b).toBe('x & "y"');
		expect(textContent(a).text).toBe("1 < 2 AB");
		expect(decodeEntities("&unknown; &amp;")).toBe("&unknown; &");
	});

	it("skips declarations, comments, and DOCTYPE", () => {
		const r = parseXml('<?xml version="1.0"?>\n<!DOCTYPE x>\n<!-- note -->\n<root><!-- inner --><x/></root>');
		expect(r.error).toBeUndefined();
		expect(elements(el(r.children[0]).children).map((e) => e.name)).toEqual(["x"]);
	});

	it("reports a mismatched closing tag with its offset and keeps what it read", () => {
		const src = "<a><b>text</a>";
		const r = parseXml(src);
		expect(r.error?.message).toBe("Expected </b> but found </a>.");
		expect(r.error?.pos).toBe(src.indexOf("</a>"));
		expect(elements(r.children)).toHaveLength(1);
	});

	it("reports unclosed elements and sections", () => {
		expect(parseXml("<a><b/>").error?.message).toBe("<a> is not closed.");
		expect(parseXml("<a><![CDATA[x</a>").error?.message).toBe("CDATA section is not closed with ']]>'.");
		expect(parseXml('<a b="1"').error?.message).toBe("Tag <a> is not closed with '>'.");
		expect(parseXml("</a>").error?.message).toBe("Closing tag </a> has no matching opening tag.");
	});
});
