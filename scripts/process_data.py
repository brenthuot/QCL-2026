#!/usr/bin/env python3
"""
QCL 2026 — Data Processing Script
Run this to regenerate public/data/*.json from source CSVs and Excel file.

Usage:
  python scripts/process_data.py

Inputs (place in scripts/input/):
  - QCL_2026.xlsx
  - Catcher.csv, First.csv, Second.csv, Third.csv, Short.csv, Outfield.csv
  - Pitchers.csv
  - cbs_fantasy_baseball_adp_processed.xlsx

Outputs (written to public/data/):
  - hitters.json
  - pitchers.json
  - config.json
  - targets.json
"""

import pandas as pd
import numpy as np
import json, os, re, sys

INPUT_DIR = os.path.join(os.path.dirname(__file__), 'input')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
os.makedirs(OUTPUT_DIR, exist_ok=True)

def norm_name(n):
    n = str(n).strip().lower()
    for a, b in [('àáâãäå','a'),('èéêë','e'),('ìíîï','i'),('òóôõö','o'),('ùúûü','u'),('ñ','n')]:
        for c in a: n = n.replace(c, b)
    n = re.sub(r'[^a-z0-9 ]', '', n)
    return re.sub(r'\s+', ' ', n).strip()

def s(v, d=0.0):
    try:
        f = float(v)
        return d if np.isnan(f) else f
    except:
        return d

print("Loading JRH targets...")
xl = pd.ExcelFile(os.path.join(INPUT_DIR, 'QCL_2026.xlsx'))
jrh_raw = xl.parse('JRH', header=None)
cat_rows = jrh_raw.iloc[5:17].reset_index(drop=True)
targets_raw = {}
for _, row in cat_rows.iterrows():
    stat = str(row[0]).strip()
    if stat != 'nan':
        try:
            targets_raw[stat] = {
                'first': float(row[1]),
                'second': float(row[2]),
                'third': float(row[3]),
            }
        except:
            pass

print("Loading CBS ADP...")
cbs_df = pd.read_excel(os.path.join(INPUT_DIR, 'cbs_fantasy_baseball_adp_processed.xlsx'))
cbs_lookup = {}
for _, row in cbs_df.iterrows():
    key = norm_name(row['Player Name'])
    cbs_lookup[key] = {
        'cbsRank': int(row['Rank']) if pd.notna(row['Rank']) else None,
        'cbsADP': float(row['ADP']) if pd.notna(row['ADP']) else None,
    }

def get_cbs(name):
    key = norm_name(name)
    if key in cbs_lookup:
        return cbs_lookup[key]
    parts = key.split()
    if len(parts) >= 2:
        for k, v in cbs_lookup.items():
            kp = k.split()
            if kp and kp[-1] == parts[-1] and kp[0][:2] == parts[0][:2]:
                return v
    return {'cbsRank': None, 'cbsADP': None}

print("Loading hitters...")
hit_files = [
    ('C',  'Catcher.csv'),
    ('1B', 'First.csv'),
    ('2B', 'Second.csv'),
    ('3B', 'Third.csv'),
    ('SS', 'Short.csv'),
    ('OF', 'Outfield.csv'),
]

all_hitters = []
seen = set()
for pos, fname in hit_files:
    fpath = os.path.join(INPUT_DIR, fname)
    if not os.path.exists(fpath):
        print(f"  WARNING: {fname} not found, skipping")
        continue
    df = pd.read_csv(fpath)
    for _, row in df.iterrows():
        pid = str(row.get('PlayerId', '')).strip()
        name = str(row['Name']).strip()
        key = pid or norm_name(name)
        if key in seen:
            continue
        seen.add(key)
        all_hitters.append({
            'id': key, 'name': name,
            'team': str(row.get('Team', '')).strip(),
            'pos': pos, 'type': 'hitter',
            'R': s(row.get('R')), 'H': s(row.get('H')),
            'HR': s(row.get('HR')), 'RBI': s(row.get('RBI')),
            'SB': s(row.get('SB')), 'OBP': s(row.get('OBP'), 0.310),
            'PA': s(row.get('PA'), 500), 'SO_hit': s(row.get('SO')),
            'AVG': s(row.get('AVG'), 0.250), 'WAR': s(row.get('WAR')),
            'ADP': s(row.get('ADP'), 999), 'FPTS': s(row.get('FPTS')),
            **get_cbs(name),
        })

print("Loading pitchers...")
pit_path = os.path.join(INPUT_DIR, 'Pitchers.csv')
all_pitchers = []
seen_p = set()
if os.path.exists(pit_path):
    pit_df = pd.read_csv(pit_path)
    for _, row in pit_df.iterrows():
        pid = str(row.get('PlayerId', '')).strip()
        name = str(row['Name']).strip()
        key = pid or norm_name(name)
        if key in seen_p:
            continue
        seen_p.add(key)
        sv = s(row.get('SV'))
        hld = s(row.get('HLD'))
        w = s(row.get('W'))
        ip = s(row.get('IP'), 60)
        if sv >= 5:
            role = 'CL'
        elif hld >= 5:
            role = 'SU'
        elif w >= 5 or ip >= 120:
            role = 'SP'
        else:
            role = 'RP'
        all_pitchers.append({
            'id': key, 'name': name,
            'team': str(row.get('Team', '')).strip(),
            'pos': role, 'type': 'pitcher',
            'W': w, 'SV': sv, 'HLD': hld,
            'SO': s(row.get('SO')), 'ERA': s(row.get('ERA'), 4.50),
            'WHIP': s(row.get('WHIP'), 1.35), 'IP': ip,
            'WAR': s(row.get('WAR')), 'ADP': s(row.get('ADP'), 999),
            'FPTS': s(row.get('FPTS')),
            **get_cbs(name),
        })

print("Computing z-scores...")
def compute_z(players, cats):
    vals = {cat: [p.get(key, 0) for p in players] for cat, (key, _) in cats.items()}
    means = {cat: np.mean(v) for cat, v in vals.items()}
    stds  = {cat: max(np.std(v), 0.01) for cat, v in vals.items()}
    for p in players:
        total = 0
        for cat, (key, direction) in cats.items():
            z = direction * (p.get(key, 0) - means[cat]) / stds[cat]
            p[f'z_{cat}'] = round(float(z), 3)
            total += z
        p['zTotal'] = round(float(total), 3)
        p['zBreakdown'] = {cat: p[f'z_{cat}'] for cat in cats}

hit_sorted = sorted(all_hitters, key=lambda x: x['FPTS'], reverse=True)
pit_sorted = sorted(all_pitchers, key=lambda x: x['FPTS'], reverse=True)

hit_cats = {
    'R':('R',1), 'H':('H',1), 'HR':('HR',1),
    'RBI':('RBI',1), 'SB':('SB',1), 'OBP':('OBP',1),
}
pit_cats = {
    'W':('W',1), 'S':('SV',1), 'HD':('HLD',1),
    'K':('SO',1), 'ERA':('ERA',-1), 'WHIP':('WHIP',-1),
}
compute_z(hit_sorted[:200], hit_cats)
compute_z(pit_sorted[:150], pit_cats)
for p in all_hitters:
    if 'zTotal' not in p: p['zTotal'] = -99; p['zBreakdown'] = {}
for p in all_pitchers:
    if 'zTotal' not in p: p['zTotal'] = -99; p['zBreakdown'] = {}

final_hitters  = hit_sorted[:250]
final_pitchers = pit_sorted[:200]

config = {
    'leagueName': 'QCL 2026',
    'myTeamName': 'numbahs',
    'totalTeams': 10,
    'myPick': 10,
    'totalRounds': 24,
    'categories': {
        'hitting': ['R','H','HR','RBI','SB','OBP'],
        'pitching': ['W','S','HD','K','ERA','WHIP'],
        'negative': ['ERA','WHIP'],
    },
    'roster': {
        'C':1,'1B':1,'2B':1,'3B':1,'SS':1,
        'OF':4,'UTIL':3,'SP':4,'RP':3,'SPRP':2,'BN':3,
    },
    'targets': targets_raw,
    'pitcherTargets': {'winContributors':7,'closers':3,'holdSpec':2},
}

print("Writing JSON files...")
with open(os.path.join(OUTPUT_DIR, 'hitters.json'), 'w') as f:
    json.dump(final_hitters, f, separators=(',',':'), default=str)
with open(os.path.join(OUTPUT_DIR, 'pitchers.json'), 'w') as f:
    json.dump(final_pitchers, f, separators=(',',':'), default=str)
with open(os.path.join(OUTPUT_DIR, 'config.json'), 'w') as f:
    json.dump(config, f, indent=2)
with open(os.path.join(OUTPUT_DIR, 'targets.json'), 'w') as f:
    json.dump(targets_raw, f, indent=2)

print(f"\n✅ Done.")
print(f"   {len(final_hitters)} hitters, {len(final_pitchers)} pitchers")
cbs_h = sum(1 for p in final_hitters if p.get('cbsADP'))
cbs_p = sum(1 for p in final_pitchers if p.get('cbsADP'))
print(f"   CBS ADP: {cbs_h} hitters, {cbs_p} pitchers matched")
