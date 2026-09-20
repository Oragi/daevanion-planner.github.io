# Daevanion Planner

All credits to Claude..

Static page (no build step, no dependencies) that plans Aion 2 Daevanion boards and reads/writes the
Daevanion plugin's `presets.json`. Open `index.html`, or publish this folder with GitHub Pages
(this repo is served as-is by GitHub Pages).

* **TW + EU**, every class, every tab. Tabs 1-4 share one point pool; points are always an input.
* **Generator** (live, re-plans on every change): tabs, points, level gate, skills to reach on every tab,
  stat preferences per category (Off/Low/Normal/High) or per effect. Weights are by real node value:
  each effect is normalised so its best value-per-point node scores exactly the multiplier per point.
  Passives are never preferred; they only appear when a route crosses them.
* **Presets**: upload a `presets.json` or start a new one, keep the ones you tick, download. The exact
  path to save to is always shown. Press **Reload** in the in-game Daevanion panel before replacing the
  file, otherwise the plugin rewrites it from memory.
* Defaults: `TW Ranger DPS` and `TW Cleric DPS` examples (their settings load into the generator with the gear button).
* **Board**: click a slot to add it (cheapest connection is filled in) or remove it (and whatever it
  disconnects). Clicking pauses auto-generate. Search highlights matching slots and counts hits per tab.
  "Compare with" shows only-in-A / only-in-B slots and Δ tables for stats and skills.

## Files

| file | role |
|---|---|
| `index.html`, `app.js` | UI |
| `solver.js` | board decoding + planner (exact Steiner tree per tab, DP over the shared pool, greedy stat fill); a JS port of `scripts/daevanion/optimize.py` |
| `data.js` | generated, minimal board data for the builds (~55 KB) |
| `tools/build_data.py` | regenerates `data.js` |

## Regenerate the data

Needs the per-build game-data captures (`ncguard/aion2/gamedata-<REGION>-<patch>`, see `scripts/gamedata.py`).

    python tools/build_data.py                       # TW=TW-110, EU=EU-15
    python tools/build_data.py TW=TW-112 EU=EU-16    # new patches

`data.js` keeps only stats that appear on boards, de-duplicated stat payloads, skill names, and the
distinct board layouts (layouts are shared between classes; a class only adds which skill sits where).
Re-run it after each patch; nothing else needs editing unless a new stat category appears.
