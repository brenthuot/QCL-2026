'use client'

// ── CONSTANTS ────────────────────────────────────────────────────────────────
export const HIT_CATS = ['R', 'H', 'HR', 'RBI', 'SB', 'OBP']
export const PIT_CATS = ['W', 'S', 'HD', 'K', 'ERA', 'WHIP']
export const ALL_CATS = [...HIT_CATS, ...PIT_CATS]
export const NEG_CATS = new Set(['ERA', 'WHIP']) // lower = better

// Player type → scoring categories
export const PLAYER_CATS = {
  hitter: HIT_CATS,
  pitcher: PIT_CATS,
}

// Category → data key on player object
export const CAT_KEY = {
  R: 'R', H: 'H', HR: 'HR', RBI: 'RBI', SB: 'SB', OBP: 'OBP',
  W: 'W', S: 'SV', HD: 'HLD', K: 'SO', ERA: 'ERA', WHIP: 'WHIP',
}

// ── GAP WEIGHTS ───────────────────────────────────────────────────────────────
// Given my team's current projected totals and the JRH targets,
// compute a weight per category (higher = more urgent need)
export function computeGapWeights(myTotals, targets, roundNum = 1, sensitivity = 1.0) {
  const weights = {}
  for (const cat of ALL_CATS) {
    const target = targets[cat]?.third
    if (!target) { weights[cat] = 1; continue }

    const current = myTotals[cat] ?? 0
    const isNeg = NEG_CATS.has(cat)

    let gap
    if (isNeg) {
      // For ERA/WHIP: current starts at 0 (no pitchers), builds toward target
      // If current is 0, we treat it as full need
      if (current === 0) { weights[cat] = 1.5; continue }
      // How far above target are we? (bad = above target for ERA/WHIP)
      gap = current > target ? (current - target) / target : 0
    } else {
      gap = Math.max(0, (target - current) / target)
    }

    // Scale: 0 gap = 0.2 weight (still slightly valuable), 1 gap = 2.0 weight
    weights[cat] = Math.max(0.2, Math.min(2.5, (0.2 + gap * 2.3) * sensitivity))
  }

  // SB: always thin, mild boost throughout
  weights['SB'] = Math.min(3.0, (weights['SB'] ?? 1) * 1.15)

  // S (Saves): hard-cap gap weight by round — don't let a 0/115 total
  // create a 2.5 weight that inflates every closer artificially
  // Round 1-4: cap at 0.4 (ignore saves, build hitting core)
  // Round 5-6: cap at 0.8 (slight awareness)
  // Round 7+:  cap at 1.6 (actively target)
  const sCap = roundNum <= 4 ? 0.4 : roundNum <= 6 ? 0.8 : 1.6
  weights['S'] = Math.min(sCap, weights['S'] ?? 1)

  // HD (Holds): hard-cap at 0.3 always — waiver-streamable, never draft for
  weights['HD'] = Math.min(0.3, weights['HD'] ?? 1)

  return weights
}

// ── LIVE SCORE ────────────────────────────────────────────────────────────────
// Combine player's pre-computed z-scores with dynamic gap weights
export function computeLiveScore(player, gapWeights) {
  const cats = PLAYER_CATS[player.type] ?? []
  let total = 0
  const breakdown = {}

  for (const cat of cats) {
    const zKey = `z_${cat}`
    let z = player[zKey] ?? 0
    // Closers: W category is irrelevant — they don't accumulate wins
    if (player.pos === 'CL' && cat === 'W') z = 0
    const w = gapWeights[cat] ?? 1
    const contribution = z * w
    breakdown[cat] = { z: round2(z), w: round2(w), contribution: round2(contribution) }
    total += contribution
  }

  return { liveScore: round3(total), liveBreakdown: breakdown }
}

// ── TIER DETECTION ────────────────────────────────────────────────────────────
export function assignTiers(players, gapField = 'liveScore') {
  const sorted = [...players].sort((a, b) => (b[gapField] ?? -99) - (a[gapField] ?? -99))
  if (sorted.length === 0) return []

  const scores = sorted.map(p => p[gapField] ?? -99)
  const maxScore = scores[0]
  const minScore = scores[scores.length - 1]
  const range = maxScore - minScore || 1

  const gaps = []
  for (let i = 1; i < scores.length; i++) {
    gaps.push({ idx: i, gap: scores[i - 1] - scores[i] })
  }
  gaps.sort((a, b) => b.gap - a.gap)

  // Top 4 gaps become tier breaks (up to 5 tiers)
  const breakIdxs = new Set(gaps.slice(0, 4).map(g => g.idx))

  let tier = 1
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && breakIdxs.has(i)) tier++
    result.push({ ...sorted[i], tier: Math.min(tier, 5), tierBreak: breakIdxs.has(i) })
  }
  return result
}

// ── TEAM TOTALS ───────────────────────────────────────────────────────────────
// Project team totals from drafted players
export function computeTeamTotals(myPlayers) {
  const totals = {}
  for (const cat of ALL_CATS) totals[cat] = 0

  const hitters = myPlayers.filter(p => p.type === 'hitter')
  const pitchers = myPlayers.filter(p => p.type === 'pitcher')

  // Counting stats: sum directly
  for (const p of hitters) {
    totals.R   += p.R   ?? 0
    totals.H   += p.H   ?? 0
    totals.HR  += p.HR  ?? 0
    totals.RBI += p.RBI ?? 0
    totals.SB  += p.SB  ?? 0
  }

  // OBP: PA-weighted average
  const totalPA = hitters.reduce((s, p) => s + (p.PA ?? 500), 0)
  if (hitters.length > 0 && totalPA > 0) {
    totals.OBP = hitters.reduce((s, p) => s + (p.OBP ?? 0.320) * (p.PA ?? 500), 0) / totalPA
  }

  for (const p of pitchers) {
    totals.W  += p.W   ?? 0
    totals.S  += p.SV  ?? 0
    totals.HD += p.HLD ?? 0
    totals.K  += p.SO  ?? 0
  }

  // ERA/WHIP: IP-weighted
  const totalIP = pitchers.reduce((s, p) => s + (p.IP ?? 0), 0)
  if (pitchers.length > 0 && totalIP > 0) {
    totals.ERA  = pitchers.reduce((s, p) => s + (p.ERA  ?? 4.50) * (p.IP ?? 0), 0) / totalIP
    totals.WHIP = pitchers.reduce((s, p) => s + (p.WHIP ?? 1.35) * (p.IP ?? 0), 0) / totalIP
  }

  return totals
}

// ── CATEGORY PROGRESS ─────────────────────────────────────────────────────────
export function catProgress(current, target, isNeg = false) {
  if (!target || target === 0) return { pct: 0, status: 'ok' }
  if (current === 0) return { pct: 0, status: 'danger' }

  let pct
  if (isNeg) {
    // ERA/WHIP: we WANT to be at or below target
    // pct = how close we are (target/current → if current < target we're over 100%)
    pct = target / current
  } else {
    pct = current / target
  }

  pct = Math.min(pct, 1.2) // cap at 120%
  const status = pct >= 1.0 ? 'ok' : pct >= 0.7 ? 'warn' : 'danger'
  return { pct: Math.min(pct, 1), status }
}

// ── ROSTER ROLE TRACKER ───────────────────────────────────────────────────────
export function rosterRoles(myPlayers) {
  const pitchers = myPlayers.filter(p => p.type === 'pitcher')
  return {
    winContributors: pitchers.filter(p => (p.W ?? 0) >= 5 || (p.IP ?? 0) >= 100).length,
    closers: pitchers.filter(p => (p.SV ?? 0) >= 8).length,
    holdSpec: pitchers.filter(p => (p.HLD ?? 0) >= 8 && (p.SV ?? 0) < 8).length,
    totalSP: pitchers.filter(p => p.pos === 'SP').length,
    totalCL: pitchers.filter(p => p.pos === 'CL').length,
    totalRP: pitchers.filter(p => ['RP', 'SU'].includes(p.pos)).length,
  }
}

// ── RECOMMENDATION ENGINE ─────────────────────────────────────────────────────
export function buildRecommendations(
  availablePlayers, myPlayers, targets, roundNum, myTotals, gapWeights,
  boardRankFn
) {
  const roles = rosterRoles(myPlayers)
  const hitterCount = myPlayers.filter(p => p.type === 'hitter').length
  const pitcherCount = myPlayers.filter(p => p.type === 'pitcher').length
  const remaining = 24 - myPlayers.length
  const pitcherSlotsLeft = 9 - pitcherCount
  const hitterSlotsLeft = 15 - hitterCount

  // Pre-compute board rank for all available players (for ADP edge calc)
  const sortedAvail = [...availablePlayers]
    .filter(p => !p.drafted)
    .sort((a, b) => (b.liveScore ?? -99) - (a.liveScore ?? -99))
  const rankMap = new Map(sortedAvail.map((p, i) => [p.id, i + 1]))

  return availablePlayers
    .filter(p => !p.drafted)
    .map(p => {
      const { liveScore } = computeLiveScore(p, gapWeights)
      let urgencyBoost = 0
      let reasons = []

      // ── ADP VALUE BOOST / PENALTY ────────────────────────────────────────
      // Boost when our rank beats CBS ADP (value pick — tiebreaker only).
      // Penalty when CBS ADP is much later than our rank (market red flag).
      // Capped at ±15% so category logic always dominates.
      let adpBoostPct = 0
      if (liveScore > 0 && p.cbsADP) {
        const myRank = rankMap.get(p.id) ?? 999
        const edge   = myRank - p.cbsADP  // positive = we rank higher (value)
                                           // negative = market ranks much later (red flag)
        if (edge > 20)        adpBoostPct =  0.15   // strong value
        else if (edge > 10)   adpBoostPct =  0.08   // mild value
        else if (edge > 5)    adpBoostPct =  0.03   // tiebreaker
        else if (edge < -120) adpBoostPct = -0.50   // severe divergence (Gallen tier)
        else if (edge < -80)  adpBoostPct = -0.35   // major red flag
        else if (edge < -50)  adpBoostPct = -0.22   // significant divergence
        else if (edge < -30)  adpBoostPct = -0.12   // notable divergence
        else if (edge < -15)  adpBoostPct = -0.06   // mild caution

        if (adpBoostPct > 0) {
          reasons.push(`Value pick — ranked #${myRank} vs CBS ADP ${p.cbsADP.toFixed(1)} (+${Math.round(edge)})`)
        } else if (adpBoostPct < 0) {
          reasons.push(`⚠ Market ranks later — CBS ADP ${p.cbsADP.toFixed(1)} vs our #${myRank} (${Math.round(edge)})`)
        }
      }

      // Pitcher role urgency
      // HD/SU deliberately excluded — hold specialists are waiver-streamable
      if (p.type === 'pitcher') {
        if (p.pos === 'CL' && roles.closers < 3) {
          // Only boost closers from round 7+ — gap weights already handle earlier rounds
          const saveUrgency = roundNum >= 7 ? 1.5 : 0
          urgencyBoost += saveUrgency
          if (saveUrgency > 0) reasons.push(`Need closers (${roles.closers}/3) — S gap`)
        }
        if (p.pos === 'SP' && roles.winContributors < 7) {
          urgencyBoost += 0.8
          reasons.push(`Need win contributors (${roles.winContributors}/7) — W gap`)
        }
        // SU/RP: no urgency boost — stream these on waivers
      }

      // Category need reasons
      const cats = PLAYER_CATS[p.type] ?? []
      for (const cat of cats) {
        const w = gapWeights[cat] ?? 1
        const zKey = `z_${cat}`
        const z = p[zKey] ?? 0
        if (w >= 1.5 && z >= 1.0) {
          const target = targets[cat]?.third
          const cur = myTotals[cat] ?? 0
          const isNeg = NEG_CATS.has(cat)
          if (!isNeg) {
            const gapPct = target ? Math.round((1 - cur / target) * 100) : 0
            if (gapPct > 10) reasons.push(`${cat} gap ${gapPct}% — strong contributor`)
          } else {
            reasons.push(`Helps ${cat} (currently ${isNeg && cur > 0 ? cur.toFixed(2) : 'unset'} vs target ${target})`)
          }
        }
      }

      if (reasons.length === 0) reasons.push('Balanced contributor across categories')

      const adpBoost    = round2(liveScore * adpBoostPct)
      const finalScore  = liveScore + urgencyBoost + adpBoost

      return {
        ...p,
        liveScore:    finalScore,
        baseScore:    liveScore,
        urgencyBoost: round2(urgencyBoost),
        adpBoost,
        adpBoostPct:  round2(adpBoostPct),
        reasons:      reasons.slice(0, 3),
      }
    })
    .sort((a, b) => b.liveScore - a.liveScore)
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function round2(n) { return Math.round(n * 100) / 100 }
function round3(n) { return Math.round(n * 1000) / 1000 }

export function fmtStat(val, cat) {
  if (val == null || val === 0) return '—'
  if (cat === 'OBP' || cat === 'ERA' || cat === 'WHIP') return val.toFixed(3)
  return Math.round(val).toString()
}

export function posColor(pos) {
  const map = { C:'#f472b6', '1B':'#fb923c', '2B':'#facc15', '3B':'#4ade80',
                SS:'#60a5fa', OF:'#a78bfa', SP:'#38bdf8', RP:'#34d399',
                CL:'#c084fc', SU:'#6ee7b7', SPRP:'#7dd3fc' }
  return map[pos] ?? '#94a3b8'
}

export function tierColor(tier) {
  return ['#fbbf24','#34d399','#60a5fa','#94a3b8','#64748b'][tier - 1] ?? '#64748b'
}
