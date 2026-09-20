"""Generate ../data.js: the smallest slice of Daevanion board data the planner needs.

Reads each build's parsed tables through scripts/daevanion/board_model.py and writes
one JS file. Per build it keeps only:
  stats   [key, label, role] for stats that occur on a board
  sets    de-duplicated stat payloads [[statIndex, value], ...]
  skills  [name, isPassive]
  tabs    per tab: title, level gate, point pool, centre, and the distinct layouts
          (flat [row, col, cost, set, ...]; set -1 = skill node, -2 = centre)
  classes per class and tab: layout index + [row, col, skillIndex, ...]

Layouts are shared between classes (they only differ in which skill sits on a skill
node), so every class costs a few hundred bytes.

    python tools/build_data.py                 # TW-110 + EU-15
    python tools/build_data.py TW=TW-110 EU=EU-16 --out data.js
"""
import argparse
import json
from datetime import date
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'scripts' / 'daevanion'))
import board_model as bm  # noqa: E402


def encode_build(name: str, gamedata_name: str) -> dict:
    data = bm.load(None, gamedata_name)
    stats, stat_ix, sets, set_ix, skills, skill_ix = [], {}, [], {}, [], {}
    tabs: dict[int, dict] = {}
    classes = {}
    for class_id, class_name in sorted(data.classes().items()):
        entry = {'n': class_name, 't': {}}
        for tab, board in data.boards(class_id).items():
            flat, skill_flat = [], []
            for (row, col), node in sorted(board.nodes.items()):
                if (row, col) == board.centre:
                    ref = -2
                elif node.is_skill:
                    ref = -1
                    key = (node.title, node.kind == 'PassiveSkill')
                    if key not in skill_ix:
                        skill_ix[key] = len(skills)
                        skills.append(list(key))
                    skill_flat += [row, col, skill_ix[key]]
                else:
                    payload = []
                    for s in node.stats:
                        if s.key not in stat_ix:
                            stat_ix[s.key] = len(stats)
                            stats.append([s.key, s.label, s.role])
                        payload.append([stat_ix[s.key], s.value])
                    sig = json.dumps(payload)
                    if sig not in set_ix:
                        set_ix[sig] = len(sets)
                        sets.append(payload)
                    ref = set_ix[sig]
                flat += [row, col, node.cost, ref]
            info = tabs.setdefault(tab, {'t': board.title, 'lv': board.need_level,
                                         'pool': board.point_type, 'c': list(board.centre), 'L': []})
            if flat not in info['L']:
                info['L'].append(flat)
            entry['t'][tab] = [info['L'].index(flat), skill_flat]
        classes[class_id] = entry
    return {'patch': gamedata_name, 'cap': data.point_capacity(), 'stats': stats, 'sets': sets,
            'skills': skills, 'tabs': tabs, 'classes': classes}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('builds', nargs='*', default=['TW=TW-110', 'EU=EU-15'],
                    help='LABEL=gamedata folder suffix (gamedata-<suffix>)')
    ap.add_argument('--out', type=Path, default=HERE.parent / 'data.js')
    args = ap.parse_args()
    out = {'generated': date.today().isoformat(), 'builds': {}}
    for item in args.builds:
        label, _, folder = item.partition('=')
        out['builds'][label] = encode_build(label, folder)
        print(label, folder, 'tabs', sorted(out['builds'][label]['tabs']),
              'layouts', {t: len(v['L']) for t, v in out['builds'][label]['tabs'].items()})
    args.out.write_text('window.DV=' + json.dumps(out, separators=(',', ':')) + ';\n', 'utf-8')
    print(f'wrote {args.out} ({args.out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
