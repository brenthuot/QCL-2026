# QCL-2026[README.md](https://github.com/user-attachments/files/26074893/README.md)
# ⚾ QCL 2026 — Fantasy Baseball Draft Assistant

10-team Rotisserie draft assistant for the QCL 2026 league.

## Features
- **Draft Board** — Live-scored player rankings with tier detection, CBS ADP edges, position filters
- **My Team** — Roster slots, category progress bars vs JRH thresholds, pitcher role tracker
- **Category Dashboard** — 12-category gap analysis with urgency weights
- **Recommendations** — Best pick right now with plain-English reasoning
- **Full Pool** — Searchable/sortable full player database
- **FantasyPros Import** — Paste round text to sync all picks in real time

## Methodology
Hybrid z-score + dynamic gap weighting. Players scored by z-score across their relevant categories (6 hitting, 6 pitching), then multiplied by category gap weights that update after every pick based on your distance to JRH 3rd-place targets.

## Setup

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Vercel auto-detects Next.js — just click Deploy
4. Done. No environment variables needed.

## League Settings
- 10-team Rotisserie, snake draft, pick #10
- **Hitting (6):** R, H, HR, RBI, SB, OBP
- **Pitching (6):** W, S, HD, K, ERA, WHIP
- **Roster:** C, 1B, 2B, 3B, SS, 4×OF, 3×UTIL, 4×SP, 3×RP, 2×SP/RP, 3×BN

## Data Sources
- Player projections: Fangraphs-style CSVs (ADP, WAR, percentile bands)
- Category targets: JRH historical thresholds (QCL_2026.xlsx)
- ADP comparison: CBS Sports

## Updating Data
Re-run `scripts/process_data.py` with updated CSVs and it will regenerate `public/data/*.json`.

## Tech Stack
- Next.js 14 (App Router)
- Pure client-side — no backend, no database
- localStorage for draft state persistence
- Vercel for hosting
