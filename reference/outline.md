# Obsidian Ladder Logic Plugin: Outline

Status: v0.6 (2026-11-24). Interview complete (section 0), samples validated (section 0.1), M0, M1, and M2 code done (section 6), Q14 answered (outputs inline). Items tagged **[verify]** are claims to confirm against the source before implementation.

---

## 0. Decisions (interview 2026-11-24)

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | v1 is text in, diagram out. No graphical editor, no format conversion. |
| D2 | Visual style | Match the source: neutral text, L5X, L5K render Studio 5000 style; PLCopen renders IEC style. Overridable per block (`style:` header) and in settings. |
| D3 | PLCopen source | CODESYS 3.5 exports are the primary target. Other vendors later. |
| D4 | Rockwell inputs | Neutral text, L5X `<Rung>` snippets, and L5K routine text in v1. BST/NXB/BND (SLC 500 / PLC-5 style) deferred; only matters if the plugin goes public. |
| D5 | Tag descriptions | Not in v1. Tag names only. |
| D6 | Wide rungs | Horizontal scroll in v1; Studio 5000-style wrapping in M4. |
| D7 | Distribution | Internal first (TAS, BRAT or manual install), built to Obsidian community-plugin standards so it can go public later. |
| D8 | Test data | User provides sanitized real exports (neutral text, L5X, L5K, CODESYS PLCopen) in `reference/samples/`. |

Defaults chosen without asking (cheap to change):

- Fence language `ladder`, alias `ldd`.
- Mobile-compatible (`isDesktopOnly: false`); costs nothing if no Node APIs are used.
- Plugin id `ladder-logic-diagrams`, name "Ladder Logic Diagrams".
- (M1) Contacts and coils use uniform 16-character cells; longer tag names wrap at member boundaries. Keeps symbols in stacked branch legs aligned, like the PLC editor.
- (M1) Output alignment defaults to `inline` for Rockwell style: outputs sit right after the last input, then a wire runs to the right rail, as in Studio 5000 (Q14, answered 2026-11-24). Override per block with `align: right` to push trailing outputs against the right rail. The IEC-style default (M3) is still to be decided from the CODESYS samples.
- (M2) XML is read with a small built-in reader (`src/parsers/xml.ts`) instead of `DOMParser`: pasted L5X is often a fragment (several `<Rung>` elements, no root), and errors need line/column positions. M3 reuses it for PLCopen.
- (M2) AOI parameter names are pulled into M2 (Q13): when the pasted L5X or L5K includes the AOI definition, the AOI box labels its rows. Without the definition, AOI operands stay positional.
- (M2) Full exports render every ladder routine as its own titled diagram ("Program / Routine", "AOI / Logic"); ST, FBD, and SFC routines are skipped with a one-line notice.

### 0.1 Sample validation (2026-11-24)

Ran `scripts/validate_samples.py` (prototype of the section 3.2 grammar plus a PLCopen series-parallel check) over `reference/samples/`.

Rockwell (3 L5X, 1 L5K; Logix Designer v33.03, v35.01, v36.05):

| Check | Result |
|---|---|
| Rungs parsed with the 3.2 grammar | 1,050 of 1,050, zero failures (L5X 804, L5K 246) |
| L5K vs L5X of the same project | Same rung count (246) and comment count (200) |
| Rung `Type` values seen | `N` only |
| Max branch depth / max instructions in one rung | 5 / 117 |
| Max operands on one instruction | 21 |
| `?` operands | 201 |
| Empty branch legs | 4 |
| Expression operands (nested parens) | 3 |
| Commas inside array subscripts, quoted operands, multi-line rung text | none in samples (keep synthetic fixtures for them) |
| Rung comments | L5X: plain CDATA directly under `<Comment>`, real newlines. L5K: `RC:` spans lines as concatenated quoted segments; `$N` and `$'` escapes used |
| AOI calls | 20 distinct AOIs, 570 calls. AOIs are a large share of real rungs |
| Mnemonics not in the v1 table | v36 renamed mnemonics (`MOVE`, `EQ`, `NE`, `GE`, `GT`, `LT`, `LE`, `LIMIT`; v36.05 file only), plus `ALMD`, `ALMA`, `AVE`, `SRT`, `PID` |

CODESYS 3.5 (3 PLCopen files, CODESYS V3.5 SP22 Patch 3 header):

| Check | Result |
|---|---|
| Namespace | `http://www.plcopen.org/xml/tc6_0200` (TC6 v2.00), not v2.01 |
| Body | Plain `<LD>` body; no network data in `addData` |
| Rung structure | One `leftPowerRail`/`rightPowerRail` pair per rung; rungs stacked 200 units apart in Y; branch legs offset 40 units |
| Rungs / series-parallel | 68 rungs, all series-parallel (fan-out from one element, fan-in of 2 to 3 connections at the coil) |
| Elements used | `contact` (19 negated), `coil`, rails only. No `block`, `comment`, `vendorElement`, edge contacts, or set/reset coils |

Findings that change the plan:

1. **Instruction library needs v36 mnemonic aliases.** Logix Designer v36 renamed several instructions to IEC 61131-3 / PLCopen names (`EQU`→`EQ`, `NEQ`→`NE`, `LIM`→`LIMIT`, `MOV`→`MOVE`, and the compare family). Both spellings must map to one entry. Source: Rockwell "Updated instruction mnemonics" page (Logix Designer docs v37/v38). Added to 3.4.
2. **PLCopen parser must accept both `tc6_0200` and `tc6_0201`.** Match elements by local name, ignore the namespace version.
3. **CODESYS samples cover only contacts and coils.** P3 (blocks), P4 (comments), edges, and set/reset have no real coverage yet. Need more exports before M3 (Q11).
4. **CODESYS sample provenance is unclear (Q12).** The wrapper matches CODESYS, but the `<LD>` bodies are one-element-per-line while the rest of each file is indented, every timestamp is exactly 12:00:00, and two of three `ObjectId`s are version-5 (name-hashed) UUIDs. That pattern suggests generated files rather than a direct CODESYS export. If they were generated (for example, to import into CODESYS), they are fine as fixtures but do not tell us what CODESYS itself writes.
5. **AOIs matter more than expected.** Consider pulling "AOI pin labels from L5X definitions" forward from section 9 into M2 when a full L5X (with `<AddOnInstructionDefinitions>`) is pasted. (Done in M2. Check against samples: all 345 AOI calls whose definition is in the same file have exactly 1 + (number of `Required="true"` parameters) operands.)
6. **Rung wrapping matters.** A 117-instruction rung is unreadable as a single scrolling line; M4 wrapping stays, but should not slip.
7. **Rockwell samples are not sanitized.** They carry controller names that identify the customer and module IP addresses. They stay local (`reference/samples/` is gitignored); fixtures must be hand-derived with generic names.

---

## 1. Goal

Render ladder logic rungs (contacts, coils, nested branches, instruction/function blocks) as inline diagrams in Obsidian notes, generated from text pasted out of the PLC programming tool.

- Source text stays in the note: searchable, diffable, version-controllable.
- Diagram is generated at view time (Reading view, Live Preview, PDF export).

### Inputs (v1)

| Format | Example | Notes |
|---|---|---|
| Studio 5000 / Logix **neutral text** | `XIC(Start)[XIO(Stop),XIC(Run)]OTE(Run);` | What you get when copying a rung to a text editor. Rockwell calls it "neutral text". |
| **L5X rung snippets** | `<Rung Number="0" Type="N"><Comment>..</Comment><Text>..</Text></Rung>` | Payload is neutral text; adds rung numbers and comments. |
| **L5K routine text** | `RC: "comment";` / `N: XIC(A)OTE(B);` | Payload is neutral text; adds rung comments. |
| **PLCopen TC6 XML** (CODESYS 3.5) | `<LD><leftPowerRail .../><contact .../>...</LD>` | Graph-based (elements + connections), not a tree. |

### Non-goals for v1

- Graphical editing of rungs
- Converting between formats
- Tag descriptions
- Simulation, live tag values, online connection to a controller
- Export back to a PLC project

---

## 2. User experience

### 2.1 Code block

````markdown
```ladder
---
start: 10
---
// Motor seal-in
[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)OTE(Motor_Run);
// Run-on delay
XIC(Motor_Run)TON(Motor_Delay,5000,0);
```
````

- Format auto-detect, in order:
  1. Contains `<Rung` → L5X snippet
  2. Starts with `<` (after optional `<?xml`) → PLCopen XML
  3. Contains a line starting `N:` or `RC:` → L5K
  4. Otherwise → neutral text
- Override with `format:` in the header (`neutral`, `l5x`, `l5k`, `plcopen`).
- Optional header between `---` lines: `format`, `style` (`rockwell` / `iec`), `start` (first rung number), `numbers` (on/off), `align` (`inline` / `right`).
- In neutral text, `//` lines directly above a rung become that rung's comment.
- One code block can hold one rung or a whole routine.

### 2.2 Rendering targets (rough ASCII mock)

Seal-in, Studio 5000 style:

```
        Start_PB             Stop_PB                    Motor_Run
 10  +----] [-----+-----------]/[------------------------( )-------+
     |            |                                                |
     |  Motor_Run |                                                |
     +----] [-----+                                                |
```

Box instruction, Studio 5000 style:

```
        Motor_Run     +-TON----------------------+
 11  +----] [---------+ Timer On Delay           +--(EN)--+
     |                | Timer      Motor_Delay   |        |
     |                | Preset     5000          +--(DN)--+
     |                | Accum      0             |        |
     |                +--------------------------+        |
```

IEC style (PLCopen): `| |`, `|/|`, `|P|`, `|N|`, `( )`, `(/)`, `(S)`, `(R)`, function blocks with named input pins on the left and output pins on the right, EN/ENO when present.

### 2.3 View behavior

- Works in Reading view, Live Preview, and PDF export (SVG in the DOM).
- Theme-aware: colors from Obsidian CSS variables (`--text-normal`, `--background-primary`, `--interactive-accent`); stable CSS class names so users can restyle with snippets.
- Wide rungs: horizontal scroll inside the block (D6). Wrapping in M4.
- Parse errors: inline error panel with line, column, and a caret under the offending character. Rungs that parsed cleanly still render.
- Context menu on the diagram: copy SVG, copy source, (M4) save PNG.
- Hover: tooltip with full operand text when a tag name is truncated.

### 2.4 Settings tab

- Style: match source (default) / always Rockwell / always IEC
- Rung numbers on/off, default start number
- Output alignment: inline (default, like Studio 5000) or right-justified to rail
- Cell width in characters (default 16), font size

---

## 3. Architecture

```
code block text
   -> detect format, strip header
   -> front-end
        neutral text parser
        L5X adapter  -> extracts Number, Comment, Text -> neutral text parser
        L5K adapter  -> extracts RC:/N: lines         -> neutral text parser
        PLCopen parser -> graph -> series/parallel reduction
   -> IR: Rung[]                        <- instruction library (operand names, shapes)
   -> layout engine (pure, no DOM)       <- style config
   -> SVG renderer
   -> el (Obsidian code block container)
```

One IR, one layout engine, one renderer. A later format (BST/NXB/BND, Siemens SimaticML, IEC 61131-10 XML) only needs a new front-end.

### 3.1 Intermediate representation (sketch)

```ts
type Rung = {
  number?: number;
  comment?: string;
  body: Series;
  span: SourceSpan;            // for error reporting and click-to-source
};

type Node = Series | Parallel | Instr;

type Series   = { kind: 'series';   items: Node[] };   // left to right
type Parallel = { kind: 'parallel'; legs: Series[] };  // top to bottom; empty leg = plain wire

type Instr = {
  kind: 'instr';
  op: string;                   // 'XIC', 'OTE', 'TON', 'MyAOI', 'contact', 'coil', ...
  shape: 'contact' | 'coil' | 'box';
  variant?: 'no' | 'nc' | 'pos' | 'neg' | 'set' | 'reset' | 'latch' | 'unlatch';
  operands: Operand[];          // positional (Logix) or named (IEC block pins)
  outPins?: Operand[];          // right-side status/output pins (EN, DN, Q, ET)
  powerIn?: string;             // pin that receives rung power (EN, IN); undefined = implicit
  powerOut?: string;            // pin that continues the rung (ENO, Q); undefined = implicit
};

type Operand = { name?: string; value: string };
```

### 3.2 Neutral text parser

Hand-written recursive descent parser (grammar is small; no parser generator).

```
file        := { rungComment | rung }
rung        := series ";"
series      := { element }
element     := instruction | branch
branch      := "[" series { "," series } "]"
instruction := MNEMONIC "(" [ operand { "," operand } ] ")"
operand     := raw text up to a top-level "," or ")"   (track nested (), [], "")
rungComment := "//" text EOL
```

Parsing gotchas (each needs a test):

- `[`, `]`, and `,` are branch syntax at rung level but array subscripts and argument separators inside an instruction's parentheses: `XIC(Tag[3,1].5)`, `CPT(Out,ABS(A-B)*2)`. The tokenizer must track paren depth.
- Empty legs are legal: `[XIC(A),]` is a leg that is just wire.
- Nested branches (3+ deep), output-side branches `[OTE(A),OTE(B)]`, boxes inside branch legs.
- `?` placeholders for unset operands (render as `?`).
- Whitespace between instructions is optional; tolerate spaces, tabs, CRLF.
- Unknown mnemonics (AOIs, newer instructions) render as a generic box with positional operands.
- Empty rung `;` and `NOP();`.

### 3.3 L5X and L5K adapters

Both are thin wrappers that pull rung numbers and comments, then hand the rung body to the neutral text parser.

L5X:

- Accept one or more `<Rung>` elements, optionally wrapped in `<RLLContent>`, `<Routine>`, or a full L5X document. Parsed with the built-in XML reader (section 0 defaults), which accepts fragments and reports errors by line and column.
- Full documents: each `Type="RLL"` routine becomes a titled section; other routine types are counted in a notice. Empty ladder routines show "No rungs."
- Rung exports: when any rung has `Use="Target"`, only those rungs are drawn and the context routines are ignored. **[verify]** against a real Studio 5000 rung export (samples are all controller exports).
- `<Comment>` may hold `<LocalizedComment Lang="...">` in multi-language projects; the first one is used.
- AOI operand names come from `<AddOnInstructionDefinition>/<Parameters>/<Parameter Required="true">` in definition order, after the instance tag (confirmed against samples).
- `Number` attribute becomes the rung number; `<Comment>` CDATA becomes the rung comment; `<Text>` CDATA is neutral text. (Confirmed in samples: CDATA sits directly under `<Comment>` and `<Text>`.)
- `Type` attribute (`N` normal; edit-state types such as pending/test edits) **[verify]** the full list against the Import/Export manual; v1 renders `N` and shows a badge for others. Samples contain `N` only.
- Ignore any non-RLL routines in a full document (ST, FBD, SFC) with a notice.

L5K:

- `RC: "comment";` attaches to the next `N:` rung. `N: <neutral text>;` is the rung, one line each in the samples.
- Rung comments span multiple lines as concatenated quoted segments, ending at the line that closes with `;` (confirmed in samples). Escapes seen: `$N` (newline), `$'`, `$Q`. **[verify]** the full escape list (`$$`, `$L`, `$R`, `$T`, `$hh`) against the Import/Export manual.
- Tolerate surrounding `ROUTINE ... END_ROUTINE` lines. A whole L5K file works too: `ROUTINE` blocks become titled sections, `ST_ROUTINE`/`FBD_ROUTINE`/`SFC_ROUTINE` blocks are skipped with a notice, and everything else is ignored.
- When the text has `ROUTINE` blocks, `RC:`/`N:` are only read inside them (multi-line tag descriptions can start a line with anything).
- AOI operand names come from `ADD_ON_INSTRUCTION_DEFINITION ... PARAMETERS` (`Required := Yes`), same rule as L5X.
- Confirmed in samples: the L5K and L5X exports of the same project give identical rungs, comments, and routine titles (246 rungs, 200 comments).
- Inside a routine, a one- or two-letter prefix other than `N` is taken as a rung in an edit state and shown as a margin marker. **[verify]** the L5K prefixes for pending and test edits; samples have `N` only.

### 3.4 Logix instruction library

Data table: mnemonic, shape, box title, operand names, right-side status bits, input vs output instruction. Operand names sourced from the Logix 5000 General Instructions Reference Manual **[verify]** each entry.

| Group | v1 set |
|---|---|
| Bit | XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF |
| Timer/counter | TON, TOF, RTO, CTU, CTD, RES |
| Compare | EQU, NEQ, LES, LEQ, GRT, GEQ, LIM, MEQ, CMP |
| Math | ADD, SUB, MUL, DIV, MOD, CPT, NEG, ABS, SQR |
| Move/logical | MOV, MVM, CLR, COP, CPS, FLL, BTD, AND, OR, XOR, NOT, SWPB |
| Program control | JSR, SBR, RET, JMP, LBL, AFI, NOP, TND, MCR |
| System/comms | GSV, SSV, MSG |
| Alarms (seen in samples) | ALMD, ALMA |

v36+ mnemonic aliases (same entry, display the mnemonic as written). Complete list from Rockwell's "Updated instruction mnemonics" page (checked 2026-11-24): `ACOS`=ACS, `ASIN`=ASN, `ATAN`=ATN, `TO_BCD`=TOD, `BCD_TO`=FRD, `EQ`=EQU, `GT`=GRT, `GE`=GEQ, `LE`=LEQ, `LT`=LES, `LIMIT`=LIM, `MOVE`=MOV, `NE`=NEQ, `SQRT`=SQR, `TRUNC`=TRN, `EXPT`=XPY.

M2 implementation (`src/instructions/logix.ts`):

- Also in the table: AVE, SRT, PID (seen in samples), the trig/log math set (SIN, COS, TAN, LN, LOG), and the targets of every v36 alias. Anything else draws as a generic box.
- Each entry has a role (input/output). Compare boxes are inputs, so `align: right` leaves them in place.
- Status pins drawn on the right: TON/TOF/RTO `EN DN`, CTU `CU DN`, CTD `CD DN`, MSG/AVE/SRT `EN DN ER`. The rung continues from the first pin.
- JSR: the second operand (input count, `0` in every sample) is not drawn; it splits the rest into Input Par and Return Par.
- ALMD in ladder has 5 operands (ALMD, ProgAck, ProgReset, ProgDisable, ProgEnable): its `In` input is the rung condition. Confirmed by all 70 sample calls and Rockwell's ALMD page. ALMA has 5 (ALMA, In, ProgAckAll, ProgDisable, ProgEnable), confirmed by 15 sample calls.
- Operand counts for every table entry that appears in the samples match the operand names.

Still **[verify]** against Studio 5000 on screen (the user can screenshot a few rungs):

- Box description wording (ours: "Timer On Delay", "Greater Than or Equal (A>=B)", ...).
- Shapes: ONS and LBL as contacts; RES, JMP, MCR as coils; AFI, NOP, TND as boxes.
- Status pins for ALMD/ALMA and visible BOOL outputs on AOIs (not drawn yet).
- Whether Studio 5000 shows the JSR input count.

### 3.5 PLCopen XML front-end (CODESYS 3.5 first)

- Parse with the M2 XML reader (`src/parsers/xml.ts`; positions for errors, fragments allowed, zero dependencies). Match elements with `localName`.
- Accept TC6 XML v2.00 (`http://www.plcopen.org/xml/tc6_0200`, what the CODESYS samples use) and v2.01 (`tc6_0201`) by matching local element names. Path `project/types/pous/pou/body/LD` confirmed in samples. Also accept a bare `<LD>...</LD>` fragment pasted on its own.
- LD elements to handle: `leftPowerRail`, `rightPowerRail`, `contact` (negated, edge), `coil` (negated, storage set/reset, edge), `block` (typeName, instanceName, inputVariables, outputVariables, inOutVariables), `inVariable`, `outVariable`, `inOutVariable`, `comment`, `connector`/`continuation`, `jump`, `label`, `return`.
- Wiring: every element has `localId`; edges come from `connectionPointIn/connection@refLocalId` (plus `formalParameter` for block pins).

CODESYS 3.5 specifics (top risk):

- Samples show a plain `<LD>` body with one rail pair per rung and no `addData` network data. Provenance is unclear (Q12), so still **[verify]** against a file exported directly from CODESYS, which may add network titles/comments via `vendorElement` or `addData`.
- **[verify]** How CODESYS represents EN/ENO, box inputs fed by constants, edge contacts, set/reset coils, network comments, and multiple POUs per export file. No sample covers these yet (Q11).
- Keep CODESYS quirks in a separate adapter (`parsers/codesys.ts`) so the core stays spec-based for other vendors later.

Conversion algorithm:

1. Build a directed graph from left rail to right rail.
2. Split into rungs: use CODESYS network boundaries if present, otherwise connected components between the rails, ordered by min Y position. (Samples: one rail pair per rung, so components split cleanly.) Order branch legs by Y position.
3. Separate power flow from data flow: `inVariable` to a block pin becomes a box operand, not a rung element.
4. Series/parallel reduction to the IR tree.
5. Non-series-parallel networks (bridge wiring) cannot reduce to a tree: fall back to a position-based renderer that uses the XML `<position>` coordinates directly.

If a POU contains several POUs, render each with a heading (POU name).

### 3.6 Layout engine

Pure function: `layout(rungs: Rung[], style: StyleConfig) => Geometry`. No DOM access, so it is unit-testable and deterministic.

- Grid model like the PLC editors: contact/coil = one uniform cell (`cellChars`, default 16); box width from content, height from operand count.
- Tag wrapping preference: member boundary (after `.`/`:`, before `[`) in the right half of the cell, then `_`, then either anywhere past the third character, then a hard cut.
- All rungs in a block share one width, so the right rail is one continuous line.
- Rungs that failed to parse keep their slot and number and draw a dashed red wire with the wrapped error message.
- Series: width = sum of children, height = max.
- Parallel: width = max leg width, height = sum of legs; shorter legs padded with wire; vertical branch rails at start and end x.
- Labels: tag name above contact/coil.
- Output alignment: `inline` (default) places outputs right after the last input and wires the remainder to the right rail; `right` right-justifies trailing outputs against the rail.
- Text measurement: monospace font with fixed char width (no DOM measuring).
- Rung wrapping (M4): break the top-level series at element boundaries when width exceeds max, draw continuation markers like Studio 5000.

### 3.7 Renderer

- Geometry to SVG using Obsidian's `createSvg` helpers / plain DOM.
- Two symbol sets: Rockwell (`] [`, `]/[`, `( )`, `(L)`, `(U)`, `(RES)`, Studio 5000 boxes) and IEC.
- All note-derived text set via `textContent`, never `innerHTML` (community review requirement and XSS safety).

### 3.8 Obsidian integration

- `this.registerMarkdownCodeBlockProcessor('ladder', handler)` plus `ldd` alias.
- `manifest.json`: `isDesktopOnly: false`.
- Performance target: parse + layout + render under 10 ms for a 50-rung block (Live Preview re-renders on edit). Cache by source hash.

### 3.9 Community-plugin readiness (D7)

Follow the Obsidian plugin guidelines from the start so going public is a packaging step, not a rewrite:

- Use `register*` helpers so everything unloads cleanly; no global listeners left behind.
- No default hotkeys, no `innerHTML` with user content, no console noise in release builds.
- Sentence case in UI text; settings headings per guideline.
- `manifest.json` complete (id, name, minAppVersion, author, description).
- Pick a license before the first public release (MIT is typical for Obsidian plugins).
- Keep customer data out of git history from day one (see section 7).

---

## 4. Proposed repo layout

```
tool-obsidian-ldd-plugin/
  reference/                 planning docs and format notes
    outline.md
    samples/                 raw exports from the user (gitignored, see section 7)
  scripts/
    validate_samples.py      grammar/topology check over samples; aggregate output only
  test-vault/                dev vault; build is copied into .obsidian/plugins/ (gitignored)
    Ladder samples.md        synthetic examples of every input format
  src/
    main.ts                  plugin entry, code block registration
    settings.ts              settings tab
    detect.ts                format detection, header parsing
    ir/types.ts
    parsers/
      common.ts              sections, front-end result, line index
      xml.ts                 tolerant XML reader with source positions (L5X, PLCopen)
      neutralText.ts
      l5x.ts                 <Rung> extraction -> neutralText, AOI definitions
      l5k.ts                 RC:/N: extraction -> neutralText, AOI definitions
      plcopenXml.ts          spec-based TC6 parsing
      codesys.ts             CODESYS 3.5 quirks (networks, addData)
      plcopenGraph.ts        graph -> series/parallel reduction
    instructions/
      logix.ts               Rockwell instruction table
      iec.ts                 IEC standard FBs (TON, TOF, TP, CTU, CTD, R_TRIG, F_TRIG, SR, RS)
    layout/layout.ts
    render/svg.ts
    render/symbols.ts
  test/
    fixtures/                sanitized copies derived from samples/
    neutralText.test.ts
    l5x.test.ts
    l5k.test.ts
    plcopenXml.test.ts
    layout.test.ts
  styles.css
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
```

## 5. Tooling

- TypeScript 7 + esbuild, following the official Obsidian sample plugin template layout. Dev dependencies pinned exact, installed with `npm install --before=<two weeks ago>`.
- vitest for parser and layout unit tests (happy-dom for DOM tests); SVG snapshot tests for the renderer.
- Rendering uses plain DOM APIs (`createElementNS`), not Obsidian's `createSvg` globals, so render code runs under happy-dom in tests.
- Dev loop: `npm run dev` rebuilds on change and copies `main.js`, `manifest.json`, `styles.css` into `test-vault/.obsidian/plugins/ladder-logic-diagrams/` (or `OBSIDIAN_PLUGIN_DIR`). Hot-Reload plugin optional.
- Git repo initialized on `main` (M0).
- `npm run preview` renders fixtures to `.preview/index.html`; `npm run preview -- --samples` adds the most complex real rungs (local only, `.preview/` is gitignored). `.claude/launch.json` serves it on port 8731 for the Claude browser pane.
- `test/samples.test.ts` runs the real parser and layout over every rung in `reference/samples/` and skips when the folder is absent.
- Internal distribution: private GitHub repo + GitHub releases, installed with BRAT.

---

## 6. Milestones

| # | Scope | Done when |
|---|---|---|
| M0 | Scaffold: template, build, test runner, `.gitignore` for samples, code block registered, renders a placeholder SVG | **Code done 2026-11-24**: 16 tests pass, build passes, bundle smoke-tested against a stubbed `Plugin`. Still needs a real load in Obsidian. |
| M1 | Neutral text core: contacts, coils, series, nested branches, empty legs, error panel | **Code done 2026-11-24**: all N1 to N12 fixtures pass (66 tests); all 1,050 real sample rungs parse and lay out; 377-rung routine parses in ~4 ms and lays out in ~5 ms; checked visually in light and dark. Still needs a look in Obsidian Live Preview. |
| M2 | Boxes + Logix instruction library, rung comments, rung numbers, multi-rung blocks, header options, L5X and L5K adapters | **Code done 2026-11-24**: fixtures N6 to N9, X1 to X7, K1 to K6 pass (111 tests). All 4 sample files (1,050 rungs) go through the real L5X/L5K front-ends with zero errors; 1,767 of 1,778 boxes get operand names (the rest are AOIs whose definition is not in the file). Paired L5K/L5X exports agree rung for rung. A 3 MB L5X parses in ~70 ms. Checked visually in light and dark. Still needs a look in Obsidian and the Studio 5000 [verify] items in 3.4. |
| M3 | PLCopen XML for CODESYS 3.5: graph build, rung split, SP reduction, IEC symbols, block pins, position-based fallback | Fixtures P1 to P6 pass on real CODESYS exports |
| M4 | Polish: settings tab, style toggle, copy SVG/PNG, hover tooltips, rung wrapping, mobile check | Used on real notes for a week without issues |
| M5 | Internal release: README with examples, release workflow, BRAT install instructions for the team | A teammate installs it without help |

Before M3 starts: CODESYS exports covering blocks (TON etc.), set/reset coils, edge contacts, and network comments, made with CODESYS's own PLCopenXML export (Q11, Q12).

## 7. Test corpus and sample handling

Sample handling (org rule: no customer names, IPs, or PII in code, tests, or repos; also protects a later public release):

- Raw exports go in `reference/samples/`, which is gitignored.
- Fixtures in `test/fixtures/` are sanitized copies: tag names generic (`Motor_01_Run`), rung comments rewritten, controller/project names replaced with `Client` / `Project`.
- Review fixtures before each commit; history is hard to scrub later.

Neutral text:

- N1. Single contact and coil
- N2. Seal-in circuit (branch from left rail)
- N3. Nested branches 3 deep
- N4. Output-side branch
- N5. Empty branch leg
- N6. Box inside a branch leg
- N7. Array subscripts with commas, bit-of-word (`Tag.5`), UDT members, `Tag[Idx].Member`
- N8. CPT/CMP expressions with nested parens
- N9. Unknown mnemonic (AOI call)
- N10. `?` operands
- N11. Very long rung (wider than 2000 px)
- N12. Malformed: unbalanced bracket, missing `;`, unclosed paren

L5X:

- X1. Single `<Rung>` with comment
- X2. Full `<RLLContent>` block with many rungs
- X3. Full L5X document with mixed routine types (RLL rendered, others skipped with notice)
- X4. Rung with non-`N` type (edit state badge)
- X5. Rung export: only `Use="Target"` rungs drawn
- X6. Malformed XML: error position, complete rungs still drawn
- X7. Neutral-text error inside CDATA mapped to block line/column

L5K:

- K1. `N:` lines only
- K2. `RC:` multi-line comment with escape sequences
- K3. Wrapped in `ROUTINE ... END_ROUTINE`
- K4. Rung text over several lines, with an error mapped to block line/column
- K5. Non-`N` prefix inside a routine (edit state badge)
- K6. AOI `PARAMETERS` naming an AOI call; a description line starting `N:` outside a routine is ignored

PLCopen XML (CODESYS 3.5):

- P1. Contact and coil
- P2. Parallel contacts
- P3. TON block, IN from power flow, PT from a constant, Q continuing the rung
- P4. Multiple networks in one POU, with network comments
- P5. Multiple POUs in one export
- P6. Bridge (non series-parallel) network, triggers fallback

## 8. Risks

| Risk | Mitigation |
|---|---|
| CODESYS export structure differs from the TC6 spec | Get real exports before M3; isolate quirks in `codesys.ts` |
| Non-series-parallel PLCopen networks | Position-based fallback renderer |
| Bracket/comma ambiguity in neutral text | Paren-depth-aware tokenizer; dedicated fixtures |
| Wide rungs unreadable on narrow panes and mobile | Horizontal scroll first, wrapping in M4 |
| Instruction operand names wrong or incomplete | Source each table entry from the Rockwell manual; generic box fallback |
| Live Preview re-render lag on large routines | Pure, fast layout; cache by source hash |
| Customer data leaking into git history | Gitignored samples, sanitized fixtures, review before commit |

## 9. Future ideas (not committed)

- BST/NXB/BND input with SLC 500 / PLC-5 instruction table and file-based addressing (mainly relevant if the plugin goes public)
- Tag descriptions: inline table, shared vault file, or read from an L5X tag export
- Visual rung editor writing back to the code block
- Convert neutral text to/from IEC ST or PLCopen XML
- Other PLCopen vendors (TwinCAT, Schneider, B&R, PLCnext)
- Siemens SimaticML / IEC 61131-10 XML front-ends
- AOI definitions from a separate note or vault file, so AOI boxes get labels without pasting the definition into every block
- Click a tag to search the vault; cross-reference every rung in the vault that touches a tag
- Scale-to-fit option for wide rungs

---

## 10. Open questions

| # | Question | Answer |
|---|---|---|
| Q1 | What does "build" mean for v1? | Text in, diagram out (D1) |
| Q2 | Visual style? | Match the source (D2) |
| Q3 | PLCopen XML source tool? | CODESYS 3.5 (D3) |
| Q4 | Rockwell inputs beyond neutral text? | L5X and L5K in v1; BST/NXB/BND deferred (D4) |
| Q5 | Tag descriptions? | Not in v1 (D5) |
| Q6 | Wide rungs? | Scroll now, wrap in M4 (D6) |
| Q7 | Distribution? | Internal first, community-ready standards (D7) |
| Q8 | Sample data? | User provides sanitized exports (D8) |
| Q9 | License for eventual public release? | Open; decide before going public |
| Q10 | CODESYS LD export structure (plain `<LD>`, `<FBD>`, or `addData` networks)? | Samples: plain `<LD>`, `tc6_0200`, rail pair per rung. Pending Q12 |
| Q11 | Can you export CODESYS LD POUs that use blocks (TON, CTU, R_TRIG), set/reset coils, edge contacts, and network comments? | Open; needed before M3 |
| Q12 | Were the three CODESYS files exported by CODESYS, or generated (e.g. for import into CODESYS)? | Open |
| Q13 | Pull AOI pin labels (from pasted L5X definitions) into M2? | Done in M2 (cheap, and only used when the definition is in the block); say if it should come out |
| Q14 | Does Studio 5000 draw trailing outputs against the right rail or right after the last input? | Right after the last input; `inline` is now the default (2026-11-24) |

---

## 11. References

- Obsidian developer docs: Markdown post processing, `registerMarkdownCodeBlockProcessor`; plugin guidelines (docs.obsidian.md)
- Obsidian sample plugin template (github.com/obsidianmd/obsidian-sample-plugin)
- BRAT (Beta Reviewers Auto-update Tester) plugin for internal installs
- Rockwell, Logix 5000 Controllers Import/Export Reference Manual (neutral text, L5K/L5X rung format) **[verify]** current publication number and revision
- Rockwell, Logix 5000 Controllers General Instructions Reference Manual (instruction operands) **[verify]** current publication number and revision
- Rockwell, Logix Designer "Updated instruction mnemonics" (v36+ IEC/PLCopen-aligned names): https://www.rockwellautomation.com/en-be/docs/studio-5000-logix-designer/38-02/contents-ditamap/instruction-set/updated-instruction-mnemonics.html
- PLCopen TC6 XML Schema v2.01 (plcopen.org)
- CODESYS 3.5 online help: PLCopenXML import/export
- IEC 61131-3 (LD graphical elements), IEC 61131-10 (XML exchange format)
