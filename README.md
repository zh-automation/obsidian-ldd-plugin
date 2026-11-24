# Ladder Logic Diagrams (Obsidian plugin)

Renders ladder logic rungs inline in Obsidian notes from:

- Studio 5000 / Logix neutral text (`XIC(Start)[XIO(Stop),XIC(Run)]OTE(Run);`)
- L5X `<Rung>` snippets and L5K routine text (`RC:` / `N:` lines)
- PLCopen TC6 XML `<LD>` bodies (CODESYS 3.5 first)

````markdown
```ladder
// Motor seal-in
[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)OTE(Motor_Run);
```
````

**Status: M2.** Neutral text, L5X, and L5K render: contacts, coils, nested branches, empty legs, instruction boxes with operand names and status pins (TON, CTU, MOV, GSV, ALMD, ...; v36 mnemonics such as `EQ` and `MOVE` included), rung comments, rung numbers, and an error panel with line/column carets. Paste a few `<Rung>` elements, an `<RLLContent>`, or a whole L5X/L5K export; each ladder routine draws as its own titled diagram. AOI boxes get parameter names when the AOI definition is in the same block. PLCopen arrives in M3. Plan and decisions: [reference/outline.md](reference/outline.md).

Optional header (between `---` lines at the top of the block): `start` (first rung number), `numbers: on|off`, `align: inline|right` (inline puts outputs right after the last input, like Studio 5000; right pushes them to the right rail), `format: neutral|l5x|l5k|plcopen`. Lines starting `//` above a rung become its comment. L5X rungs keep their `Number`; `start` numbers rungs that have none.

## Development

```powershell
npm install
npm test
npm run dev
```

- `npm run dev` watches `src/`, rebuilds `main.js`, and copies `main.js`, `manifest.json`, `styles.css` into `test-vault/.obsidian/plugins/ladder-logic-diagrams/`.
- Set `OBSIDIAN_PLUGIN_DIR` to copy into a different vault instead.
- Open `test-vault/` as a vault in Obsidian, turn off Restricted mode, and enable **Ladder Logic Diagrams**. Reload the plugin (or use the Hot-Reload plugin) after rebuilds.
- `npm run build` type-checks and produces a minified release build.
- `npm run preview` renders the test fixtures (neutral text, L5X, L5K, and an instruction-library sampler) to `.preview/index.html` for review in any browser. Add `-- --samples` to include the most complex rungs from `reference/samples/` (stays local; `.preview/` is gitignored).

## Sample data

Raw exports go in `reference/samples/` (gitignored; they contain customer identifiers). Test fixtures in `test/fixtures/` must be sanitized copies with generic tag names. `npm test` also runs every sample file through the real L5X/L5K front-ends (`test/samples.test.ts`, skipped when the folder is absent) and prints counts only.

`scripts/validate_samples.py` runs a prototype of the neutral-text grammar and a PLCopen series-parallel check over everything in `reference/samples/` and prints aggregate stats only:

```powershell
python -I scripts/validate_samples.py reference/samples
```
