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

**Status: M1.** Neutral text renders: contacts, coils, nested branches, empty legs, boxes (operands listed positionally), rung comments, rung numbers, and an error panel with line/column carets. L5X and L5K arrive in M2, PLCopen in M3. Plan and decisions: [reference/outline.md](reference/outline.md).

Optional header (between `---` lines at the top of the block): `start` (first rung number), `numbers: on|off`, `align: right|inline`, `format: neutral|l5x|l5k|plcopen`. Lines starting `//` above a rung become its comment.

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
- `npm run preview` renders the test fixtures to `.preview/index.html` for review in any browser. Add `-- --samples` to include the most complex rungs from `reference/samples/` (stays local; `.preview/` is gitignored).

## Sample data

Raw exports go in `reference/samples/` (gitignored; they contain customer identifiers). Test fixtures in `test/fixtures/` must be sanitized copies with generic tag names.

`scripts/validate_samples.py` runs a prototype of the neutral-text grammar and a PLCopen series-parallel check over everything in `reference/samples/` and prints aggregate stats only:

```powershell
python -I scripts/validate_samples.py reference/samples
```
