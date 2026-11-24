/**
 * Render fixtures (and optionally the most complex real sample rungs) to .preview/index.html for
 * visual review outside Obsidian.
 *
 *   npm run preview              fixtures only
 *   npm run preview -- --samples also real rungs from reference/samples (local only; .preview is gitignored)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { renderBlock } from "../src/render/block";
import { NEUTRAL } from "../test/fixtures/neutral";
import { L5K, L5X } from "../test/fixtures/rockwell";

const OUT_DIR = ".preview";
const withSamples = process.argv.includes("--samples");

const window = new Window();
const document = window.document as unknown as Document;

function block(title: string, source: string, showSource = true): string {
	const el = document.createElement("div");
	renderBlock(source, el as HTMLElement);
	const src = showSource ? `<pre class="src">${escapeHtml(source)}</pre>` : "";
	return `<section><h3>${escapeHtml(title)}</h3>${src}${el.innerHTML}</section>`;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const sections: string[] = [];
for (const [name, src] of Object.entries(NEUTRAL)) sections.push(block(name, src));
sections.push(
	block(
		"Instruction library: boxes, names, pins, v36 mnemonics",
		[
			"XIC(Run)TON(Motor_Delay,5000,0);",
			"XIC(Count_PE)ONS(Count_Ons)CTU(Part_Count,100,0);",
			"GEQ(Tank_01.Level,80.0)LIM(10,Tank_01.Temp,90)MOVE(0,Valve_02.Pos);",
			"EQ(State,3)[ADD(Total,1,Total),CPT(Rate,Total/Elapsed*60.0)];",
			"XIC(Trigger)MSG(Read_Msg);",
			"XIC(Alarm_In)ALMD(Alarm_01,Ack_PB,Reset_PB,0,0);",
			"JSR(Sub_01,0);",
			"XIC(Enable)MCR();",
		].join("\n"),
	),
);
for (const [name, src] of Object.entries(L5X)) sections.push(block(name, src));
for (const [name, src] of Object.entries(L5K)) sections.push(block(name, src));
sections.push(
	block(
		"Multi-rung block with header and comments",
		[
			"---",
			"start: 10",
			"---",
			"// Motor seal-in",
			"[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)XIO(Motor_Fault)OTE(Motor_Run);",
			"// Run-on delay, then latch the cycle bit",
			"XIC(Motor_Run)[TON(Motor_Delay,5000,0),XIC(Motor_Delay.DN)ONS(Cycle_Ons)OTL(Cycle_Active)];",
			"XIC(Reset_PB)[OTU(Cycle_Active),RES(Motor_Delay)];",
			"XIC(Program:Conveyor.Infeed_Photoeye.Blocked)XIO(Conveyor_01.Fault.Any_Active)OTE(Conveyor_01.Run_Cmd);",
		].join("\n"),
	),
);

if (withSamples) {
	const dir = "reference/samples";
	const walk = (d: string): string[] =>
		readdirSync(d).flatMap((n) => {
			const p = path.join(d, n);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
	if (existsSync(dir)) {
		for (const file of walk(dir).filter((f) => /\.l5x$/i.test(f))) {
			const text = readFileSync(file, "utf8");
			const rungs = [...text.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1] ?? "");
			const score = (t: string) => (t.match(/\[/g)?.length ?? 0) * 100 + t.length;
			const picked = [...rungs].sort((a, b) => score(b) - score(a)).slice(0, 4);
			picked.push(...rungs.filter((r) => r.length < 120).slice(0, 2));
			sections.push(block(`${path.basename(file)} (most complex + short)`, picked.join("\n"), false));
		}
	}
}

const css = readFileSync("styles.css", "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ladder preview</title>
<style>
:root { --text-normal:#1f1f1f; --text-muted:#6b6b6b; --text-error:#c62828; --background-primary:#ffffff;
  --interactive-accent:#6c5ce7; --font-monospace: Consolas, ui-monospace, monospace; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --text-normal:#dcddde; --text-muted:#999; --text-error:#ff6b6b;
  --background-primary:#1e1e1e; } }
body { background: var(--background-primary); color: var(--text-normal); font-family: system-ui, sans-serif; margin: 16px; }
section { margin-bottom: 28px; } h3 { margin: 0 0 4px; font-size: 14px; }
pre.src { font-size: 11px; color: var(--text-muted); margin: 0 0 6px; white-space: pre-wrap; word-break: break-all; }
${css}
</style></head><body>
<h1 style="font-size:18px">Ladder Logic Diagrams: render preview</h1>
${sections.join("\n")}
</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "index.html"), html);
console.log(`wrote ${path.join(OUT_DIR, "index.html")} (${sections.length} sections${withSamples ? ", with samples" : ""})`);
