/**
 * Synthetic PLCopen TC6 fixtures (outline section 7, P1 to P8), shaped like CODESYS 3.5 exports.
 * Generic names only.
 */

const XHTML = 'xmlns="http://www.w3.org/1999/xhtml"';
const pos = '<position x="0" y="0" />';

const conns = (refs: (string | [string, string])[]) =>
	refs.length === 0
		? "<connectionPointIn />"
		: `<connectionPointIn>${refs
				.map((r) => (Array.isArray(r) ? `<connection refLocalId="${r[0]}" formalParameter="${r[1]}" />` : `<connection refLocalId="${r}" />`))
				.join("")}</connectionPointIn>`;

const contact = (id: string, refs: (string | [string, string])[], variable: string, attrs = "") =>
	`<contact localId="${id}"${attrs ? ` ${attrs}` : ""}>${pos}${conns(refs)}<connectionPointOut /><variable>${variable}</variable></contact>`;
const coil = (id: string, refs: (string | [string, string])[], variable: string, attrs = "") =>
	`<coil localId="${id}"${attrs ? ` ${attrs}` : ""}>${pos}${conns(refs)}<connectionPointOut /><variable>${variable}</variable></coil>`;
const left = (id: string) => `<leftPowerRail localId="${id}">${pos}<connectionPointOut formalParameter="none" /></leftPowerRail>`;
const right = (id: string, refs: string[]) => `<rightPowerRail localId="${id}">${pos}${conns(refs)}</rightPowerRail>`;
const inVar = (id: string, expr: string) => `<inVariable localId="${id}">${pos}<connectionPointOut /><expression>${expr}</expression></inVariable>`;
const outVar = (id: string, ref: [string, string], expr: string) =>
	`<outVariable localId="${id}">${pos}${conns([ref])}<expression>${expr}</expression></outVariable>`;

/** CODESYS network start: network comment, then the networktitle vendor element. */
const network = (commentId: string, titleId: string, comment = "", title = "") =>
	[
		`<comment localId="${commentId}" height="0" width="0">${pos}<content>${comment ? `<xhtml ${XHTML}>${comment}</xhtml>` : `<xhtml ${XHTML} />`}</content></comment>`,
		`<vendorElement localId="${titleId}">${pos}<alternativeText>${title ? `<xhtml ${XHTML}>${title}</xhtml>` : `<xhtml ${XHTML} />`}</alternativeText>`,
		'<addData><data name="http://www.3s-software.com/plcopenxml/fbdelementtype" handleUnknown="implementation">',
		'<ElementType xmlns="">networktitle</ElementType></data></addData></vendorElement>',
	].join("\n");

type PinSpec = { name: string; refs?: (string | [string, string])[]; expr?: string };
const block = (id: string, typeName: string, instance: string | undefined, inputs: PinSpec[], outputs: PinSpec[]) =>
	[
		`<block localId="${id}" typeName="${typeName}"${instance ? ` instanceName="${instance}"` : ""}>${pos}`,
		"<inputVariables>",
		...inputs.map((p) => `<variable formalParameter="${p.name}">${conns(p.refs ?? [])}</variable>`),
		"</inputVariables><inOutVariables />",
		"<outputVariables>",
		...outputs.map(
			(p) =>
				`<variable formalParameter="${p.name}">${p.expr ? `<connectionPointOut><expression>${p.expr}</expression></connectionPointOut>` : "<connectionPointOut />"}</variable>`,
		),
		"</outputVariables>",
		'<addData><data name="http://www.3s-software.com/plcopenxml/fbdcalltype" handleUnknown="implementation"><CallType xmlns="">functionblock</CallType></data></addData>',
		"</block>",
	].join("\n");

const ld = (...parts: string[]) => ["<LD>", ...parts, "</LD>"].join("\n");

export const PLCOPEN = {
	/** P1: contact, negated contact, coil; one rail pair (bare <LD> fragment). */
	P1_contact_coil: ld(
		left("1"),
		contact("2", ["1"], "stInputs.xReady", 'negated="false" storage="none" edge="none"'),
		contact("3", ["2"], "stInputs.xFault", 'negated="true" storage="none" edge="none"'),
		coil("4", ["3"], "aSteps[10].xDone", 'negated="false" storage="none"'),
		right("5", ["4"]),
	),

	/** P2: two rungs, each with its own rail pair; the first has parallel contacts. */
	P2_parallel_two_rungs: ld(
		left("1"),
		contact("2", ["1"], "xAuto"),
		contact("3", ["1"], "xManual"),
		contact("4", ["2", "3"], "xFault", 'negated="true"'),
		coil("5", ["4"], "xRun"),
		right("6", ["5"]),
		left("7"),
		contact("8", ["7"], "xRun"),
		coil("9", ["8"], "xLamp"),
		right("10", ["9"]),
	),

	/**
	 * P3: CODESYS shape (one rail per POU, networktitle markers). TON with PT from an inVariable and
	 * ET to an inline expression; R_TRIG into CTU whose RESET is fed by its own contact.
	 */
	P3_blocks: ld(
		left("0"),
		network("1", "2", "Start delay"),
		contact("3", ["0"], "xStart"),
		inVar("4", "T#5S"),
		block("5", "TON", "tonDelay", [{ name: "IN", refs: ["3"] }, { name: "PT", refs: ["4"] }], [{ name: "Q" }, { name: "ET", expr: "tElapsed" }]),
		coil("6", [["5", "Q"]], "xDelayDone"),
		network("7", "8", "", "Part counter"),
		contact("9", ["0"], "xPartSensor"),
		block("10", "R_TRIG", "rtPart", [{ name: "CLK", refs: ["9"] }], [{ name: "Q" }]),
		contact("11", ["0"], "xResetCount"),
		inVar("12", "100"),
		block(
			"13",
			"CTU",
			"ctuParts",
			[{ name: "CU", refs: [["10", "Q"]] }, { name: "RESET", refs: ["11"] }, { name: "PV", refs: ["12"] }],
			[{ name: "Q" }, { name: "CV", expr: "iCount" }],
		),
		coil("14", [["13", "Q"]], "xBatchDone"),
		right("2147483646", []),
	),

	/** P4: network comments and titles; edge contacts; set, reset, and negated coils. */
	P4_variants_comments: ld(
		left("0"),
		network("1", "2", "Latch the run bit\non a rising start edge", "Run latch"),
		contact("3", ["0"], "xStart", 'edge="rising"'),
		contact("4", ["3"], "xStop", 'negated="true"'),
		coil("5", ["4"], "xRun", 'storage="set"'),
		network("6", "7"),
		contact("8", ["0"], "xStop", 'edge="falling"'),
		coil("9", ["8"], "xRun", 'storage="reset"'),
		coil("10", ["8"], "xIdle", 'negated="true"'),
		right("2147483646", []),
	),

	/** P5: whole project: LD program with an LD action, plus an ST function block. */
	P5_project: [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<project xmlns="http://www.plcopen.org/xml/tc6_0201">',
		'<fileHeader companyName="" productName="CODESYS" productVersion="CODESYS V3.5 SP22" creationDateTime="2026-01-01T12:00:00" />',
		'<contentHeader name="Project"><coordinateInfo><fbd><scaling x="1" y="1" /></fbd><ld><scaling x="1" y="1" /></ld><sfc><scaling x="1" y="1" /></sfc></coordinateInfo></contentHeader>',
		"<types><dataTypes /><pous>",
		'<pou name="PRG_Main" pouType="program"><interface><localVars><variable name="xRun"><type><BOOL /></type></variable></localVars></interface>',
		"<body>",
		ld(left("0"), network("1", "2"), contact("3", ["0"], "xStart"), coil("4", ["3"], "xRun"), right("2147483646", [])),
		"</body>",
		'<actions><action name="ACT_Reset"><body>',
		ld(left("0"), network("1", "2"), contact("3", ["0"], "xReset"), coil("4", ["3"], "xRun", 'storage="reset"'), right("2147483646", [])),
		"</body></action></actions>",
		"</pou>",
		`<pou name="FB_Calc" pouType="functionBlock"><body><ST><xhtml ${XHTML}>iOut := iIn * 2;</xhtml></ST></body></pou>`,
		"</pous></types><instances><configurations /></instances>",
		"</project>",
	].join("\n"),

	/** P6: bridge wiring (not series-parallel): drawn as an error rung. */
	P6_bridge: ld(
		left("1"),
		contact("2", ["1"], "xA"),
		contact("3", ["1"], "xB"),
		contact("4", ["2"], "xC"),
		coil("5", ["2"], "xOut1"),
		coil("6", ["3", "4"], "xOut2"),
		right("7", ["5", "6"]),
	),

	/** P7: function box with EN/ENO; IN from an inVariable, OUT to an outVariable. */
	P7_en_eno: ld(
		left("1"),
		contact("2", ["1"], "xEnable"),
		inVar("3", "iSetpoint"),
		block("4", "MOVE", undefined, [{ name: "EN", refs: ["2"] }, { name: "IN", refs: ["3"] }], [{ name: "ENO" }, { name: "OUT" }]),
		outVar("5", ["4", "OUT"], "iTarget"),
		coil("6", [["4", "ENO"]], "xMoved"),
		right("7", ["6"]),
	),

	/** P8: a connection to a localId that does not exist. */
	P8_bad_reference: ld(left("1"), contact("2", ["99"], "xA"), coil("3", ["2"], "xB"), right("4", ["3"])),
} as const;
