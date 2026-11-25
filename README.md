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

## Install

The plugin is not in Obsidian's community plugin list. Install it from its [GitHub releases](https://github.com/zh-automation/obsidian-ldd-plugin/releases) with BRAT, which also keeps it updated.

1. In Obsidian, open **Settings → Community plugins**. Turn off Restricted mode if it is on, then choose **Browse**, search for **BRAT**, install it, and enable it.
2. Open the command palette (Ctrl+P, or Cmd+P on macOS) and run **BRAT: Add a beta plugin for testing**.
3. Enter `zh-automation/obsidian-ldd-plugin`, keep the latest version, and add the plugin.
4. If it is not switched on afterwards, enable **Ladder Logic Diagrams** under **Settings → Community plugins**.
5. Check it: put the `ladder` block above in a note. Reading view and Live Preview should both show a diagram.

BRAT checks for new releases when Obsidian starts (an option in BRAT's settings) or when you run its update command.

Without BRAT: download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/zh-automation/obsidian-ldd-plugin/releases/latest), put them in `<your vault>/.obsidian/plugins/ladder-logic-diagrams/`, then reload Obsidian and enable the plugin. Repeat for each update.

## What it renders

**Status: M4.** Neutral text, L5X, and L5K render: contacts, coils, nested branches, empty legs, instruction boxes with operand names and status pins (TON, CTU, MOV, GSV, ALMD, ...; v36 mnemonics such as `EQ` and `MOVE` included), rung comments, rung numbers, and an error panel with line/column carets. Paste a few `<Rung>` elements, an `<RLLContent>`, or a whole L5X/L5K export; each ladder routine draws as its own titled diagram. AOI boxes get parameter names when the AOI definition is in the same block.

**M3:** PLCopen XML (CODESYS 3.5) renders in IEC style: `| |` contacts, edge and negated contacts, set/reset coils, function blocks with pins and values (TON, R_TRIG, CTU, EN/ENO boxes), network titles and comments, one diagram per POU or action. Paste a bare `<LD>`, a `<pou>`, or a whole export. Networks are numbered from 1 and coils sit at the right rail, like CODESYS; `style: rockwell`, `align: inline`, and `start` in the header change that. Networks that are not series-parallel show as an error rung.

**M4:** long rungs wrap to the note's width (breaking between elements, marked `>>`) and re-wrap when the pane is resized. Right-click a diagram to copy it as SVG or PNG, or to copy its source. Settings (Settings, Ladder Logic Diagrams): symbol style, output position, rung numbers, wrapping, cell width, diagram size. A block's header overrides the settings.

Plan and decisions: [reference/outline.md](reference/outline.md).

Optional header (between `---` lines at the top of the block): `start` (first rung number), `numbers: on|off`, `wrap: on|off`, `style: rockwell|iec`, `align: inline|right` (inline puts outputs right after the last input, like Studio 5000; right pushes them to the right rail), `format: neutral|l5x|l5k|plcopen`. Lines starting `//` above a rung become its comment. L5X rungs keep their `Number`; `start` numbers rungs that have none.

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
- Tests run the plugin itself against a small stand-in for the Obsidian API (`test/stubs/obsidian.ts`, aliased in `vitest.config.ts`), since the `obsidian` package ships types only.
- `npm run preview` renders the test fixtures (neutral text, L5X, L5K, PLCopen, and an instruction-library sampler) to `.preview/index.html` for review in any browser. Add `-- --samples` to include the most complex Rockwell rungs and every PLCopen file from `reference/samples/` (stays local; `.preview/` is gitignored).

## Releasing

The Forgejo repo is the source of truth. A Forgejo push mirror copies commits and tags to GitHub, where `.github/workflows/release.yml` turns each version tag into a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached. Testers install and update from those releases with the BRAT plugin.

One-time setup:

1. Create an empty repo on GitHub. Treat it as read-only: the mirror force-pushes over it.
2. Create a GitHub fine-grained token for that repo only, with **Contents** and **Workflows** read and write.
3. In Forgejo: Settings, Repository, Mirror Settings. Add `https://github.com/<owner>/<repo>.git` with your GitHub username and the token as the password, tick "Sync when new commits are pushed", and leave the branch filter blank (a full mirror, so tags go too).

Each release:

```powershell
npm version 0.2.0
```

```powershell
git push origin main --follow-tags
```

`npm version` updates `package.json`, `manifest.json`, and `versions.json`, commits, and tags `0.2.0` (no `v` prefix; see `.npmrc`). The workflow refuses a tag that does not match `manifest.json`. A tag with a suffix, such as `0.2.0-beta.1`, is published as a pre-release.

Testers install and update through BRAT as described under [Install](#install). The GitHub repo is public, so they need no token.

## Sample data

Raw exports go in `reference/samples/` (gitignored; they contain customer identifiers). Test fixtures in `test/fixtures/` must be sanitized copies with generic tag names. `npm test` also runs every sample file through the real L5X/L5K/PLCopen front-ends (`test/samples.test.ts`, skipped when the folder is absent) and prints counts only.

`scripts/validate_samples.py` runs a prototype of the neutral-text grammar and a PLCopen series-parallel check over everything in `reference/samples/` and prints aggregate stats only:

```powershell
python -I scripts/validate_samples.py reference/samples
```
