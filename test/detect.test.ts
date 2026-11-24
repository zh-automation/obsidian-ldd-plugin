import { describe, expect, it } from "vitest";
import { detectFormat, splitHeader } from "../src/detect";

describe("detectFormat", () => {
	it("treats plain rung text as neutral text", () => {
		expect(detectFormat("XIC(Start)[XIO(Stop),XIC(Run)]OTE(Run);")).toBe("neutral");
	});

	it("ignores // rung comments when detecting neutral text", () => {
		expect(detectFormat("// seal-in\nXIC(A)OTE(B);")).toBe("neutral");
	});

	it("detects L5K from N: and RC: lines", () => {
		expect(detectFormat('RC: "Pump start";\nN: XIC(A)OTE(B);')).toBe("l5k");
		expect(detectFormat("\t\tN: XIC(A)OTE(B);")).toBe("l5k");
	});

	it("detects L5X from rung elements, with or without an XML declaration", () => {
		expect(detectFormat('<Rung Number="0" Type="N"><Text><![CDATA[XIC(A)OTE(B);]]></Text></Rung>')).toBe("l5x");
		expect(detectFormat('<?xml version="1.0"?>\n<RSLogix5000Content SchemaRevision="1.0">')).toBe("l5x");
		expect(detectFormat("<RLLContent>\n<Rung Number=\"3\">")).toBe("l5x");
	});

	it("treats other XML as PLCopen", () => {
		expect(detectFormat('<?xml version="1.0"?>\n<project xmlns="http://www.plcopen.org/xml/tc6_0200">')).toBe(
			"plcopen",
		);
		expect(detectFormat("<LD><leftPowerRail localId=\"1\"/></LD>")).toBe("plcopen");
	});

	it("strips a byte-order mark before detecting", () => {
		expect(detectFormat("﻿<?xml version=\"1.0\"?><project/>")).toBe("plcopen");
	});
});

describe("splitHeader", () => {
	it("returns the whole source as body when there is no header", () => {
		const r = splitHeader("XIC(A)OTE(B);");
		expect(r.header).toEqual({});
		expect(r.body).toBe("XIC(A)OTE(B);");
		expect(r.bodyLineOffset).toBe(0);
		expect(r.errors).toEqual([]);
	});

	it("parses every supported key", () => {
		const r = splitHeader("---\nformat: L5K\nstyle: iec\nstart: 12\nnumbers: off\nalign: right\n---\nN: XIC(A)OTE(B);");
		expect(r.header).toEqual({ format: "l5k", style: "iec", start: 12, numbers: false, align: "right" });
		expect(r.body).toBe("N: XIC(A)OTE(B);");
		expect(r.bodyLineOffset).toBe(7);
		expect(r.errors).toEqual([]);
	});

	it("handles CRLF line endings and blank or # lines in the header", () => {
		const r = splitHeader("---\r\n# comment\r\n\r\nstart: 5\r\n---\r\nXIC(A)OTE(B);");
		expect(r.header).toEqual({ start: 5 });
		expect(r.body).toBe("XIC(A)OTE(B);");
	});

	it("reports bad keys and values with their block line numbers", () => {
		const r = splitHeader("---\ncolour: red\nstart: -1\nnumbers: maybe\nstyle\n---\nXIC(A);");
		expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
		expect(r.errors[0]?.message).toContain("colour");
		expect(r.header).toEqual({});
	});

	it("reports an unclosed header and keeps the full source as body", () => {
		const r = splitHeader("---\nstart: 1\nXIC(A)OTE(B);");
		expect(r.errors).toHaveLength(1);
		expect(r.body).toBe("---\nstart: 1\nXIC(A)OTE(B);");
	});
});
