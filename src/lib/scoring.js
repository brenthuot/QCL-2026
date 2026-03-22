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

  // Floor at -3 so slightly-below-replacement players don't rank 400th.
  // Players outside the draftable pool naturally fall below -3 and stay low.
  const floored = Math.max(total, -3)
  return { liveScore: round3(floored), liveBreakdown: breakdown }
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
  fullPool
) {
  const roles = rosterRoles(myPlayers)
  const hitterCount  = myPlayers.filter(p => p.type === 'hitter').length
  const pitcherCount = myPlayers.filter(p => p.type === 'pitcher').length
  const spCount      = myPlayers.filter(p => p.pos === 'SP').length
  const clCount      = myPlayers.filter(p => p.pos === 'CL').length
  const suCount      = myPlayers.filter(p => ['SU','RP'].includes(p.pos)).length

  const HITTER_TARGET = 13
  const SP_MAX        = 6
  const CL_MAX        = 3
  const SU_MAX        = 2   // 2 hold specialists, only after round 14
  const PITCHER_MAX   = 9

  // Position counts for diversity tracking
  const hittersByPos = {}
  for (const pl of myPlayers.filter(p => p.type === 'hitter')) {
    hittersByPos[pl.pos] = (hittersByPos[pl.pos] ?? 0) + 1
  }
  // How many of each pos do we need (starter slot) and max before saturation
  const POS_NEED = { C:1, '1B':1, '2B':1, '3B':1, SS:1, OF:4 }
  const POS_SAT  = { C:2, '1B':3, '2B':2, '3B':2, SS:2, OF:6 }

  const poolForRank = fullPool ?? availablePlayers
  const sortedFull = [...poolForRank]
    .filter(p => !p.isKeeper)
    .sort((a, b) => (b.liveScore ?? -99) - (a.liveScore ?? -99))
  const rankMap = new Map(sortedFull.map((p, i) => [p.id, i + 1]))

  // Category gap tracking
  const projK   = myTotals.K ?? 0
  const projSV  = myTotals.S ?? 0
  const kTarget  = targets.K?.third  ?? 1525
  const svTarget = targets.S?.third  ?? 115
  const kPct   = kTarget  > 0 ? projK  / kTarget  : 1
  const svPct  = svTarget > 0 ? projSV / svTarget : 1

  return availablePlayers
    .filter(p => !p.drafted)
    .map(p => {
      const { liveScore } = computeLiveScore(p, gapWeights)
      let urgencyBoost = 0
      let reasons = []

      // ── ROSTER BALANCE GUARDRAILS ─────────────────────────────────────────

      // SU/RP: only after round 14, max 2
      if ((p.pos === 'SU' || p.pos === 'RP')) {
        if (roundNum < 14 || suCount >= SU_MAX) return null
      }
      if (p.pos === 'SP' && spCount >= SP_MAX) return null
      if (p.pos === 'CL' && clCount >= CL_MAX) return null
      if (p.type === 'pitcher' && pitcherCount >= PITCHER_MAX) return null

      // Hitter pace
      const expectedHitters = Math.round(roundNum * (HITTER_TARGET / 24))
      const hitterDeficit = expectedHitters - hitterCount
      if (hitterDeficit >= 3 && p.type === 'pitcher') return null
      if (hitterDeficit >= 2 && p.type === 'pitcher') {
        urgencyBoost -= 3.0
        reasons.push(`⚠ Behind on hitters (${hitterCount}/${expectedHitters} expected by R${roundNum})`)
      }
      if (hitterDeficit >= 2 && p.type === 'hitter') {
        urgencyBoost += hitterDeficit * 1.5
        reasons.push(`Filling hitter gap — ${hitterCount}/${expectedHitters} expected`)
      }

      // ── POSITION DIVERSITY ────────────────────────────────────────────────
      // Prevent SS overload and encourage filling unfilled positions (esp 2B)
      if (p.type === 'hitter') {
        const myPosCount = hittersByPos[p.pos] ?? 0
        const needed     = POS_NEED[p.pos]    ?? 1
        const saturation = POS_SAT[p.pos]     ?? 3

        // Hard block: way over on this position
        if (myPosCount >= saturation) return null

        // Soft penalty: one over on this position — mild discourage
        if (myPosCount >= needed + 1) {
          urgencyBoost -= 1.5
          reasons.push(`Already have ${myPosCount} ${p.pos} — limiting redundancy`)
        }

        // Urgency: position completely unfilled and it's mid-draft
        if (myPosCount === 0 && roundNum >= 7) {
          const urgency = p.pos === '2B' ? 2.0 : p.pos === 'C' ? 1.5 : 1.0
          urgencyBoost += urgency
          reasons.push(`Need ${p.pos} — position empty (R${roundNum})`)
        }
      }

      // ── OBP FLOOR ────────────────────────────────────────────────────────
      // Soft penalty for very low OBP hitters — they hurt the team average.
      // Only applies before round 20 (late round streamers get a pass).
      if (p.type === 'hitter' && roundNum < 20) {
        const obp = p.OBP ?? 0
        if (obp < 0.310) {
          // Severe: 0.280–0.309 range
          urgencyBoost -= 2.0
          reasons.push(`⚠ Low OBP (${obp.toFixed(3)}) — drags team average below target`)
        } else if (obp < 0.320) {
          // Mild: 0.310–0.319 range
          urgencyBoost -= 1.0
          reasons.push(`⚠ Below-avg OBP (${obp.toFixed(3)})`)
        }
      }

      // ── STRIKEOUT URGENCY ─────────────────────────────────────────────────
      // K urgency only fires after round 6 — don't let it override elite hitters early.
      // Also requires having at least 2 hitters already (basic team foundation).
      if (p.pos === 'SP' && spCount < SP_MAX && kPct < 0.80 && roundNum >= 6 && hitterCount >= 2) {
        const zK = p.z_K ?? 0
        if (zK > 0.5) {
          const kUrgency = zK * 0.6 * (1 - kPct)
          urgencyBoost += kUrgency
          reasons.push(`K gap ${Math.round((1-kPct)*100)}% — high strikeout arm`)
        }
      }

      // ── SAVE URGENCY ──────────────────────────────────────────────────────
      // Prefer high-SV closers when save gap is large
      if (p.pos === 'CL' && clCount < CL_MAX) {
        const svUrgency = roundNum >= 7 ? 1.5 + (svPct < 0.7 ? 0.5 : 0) : 0
        urgencyBoost += svUrgency
        if (svUrgency > 0) {
          const zS = p.z_S ?? 0
          const eliteBonus = zS > 1.0 ? 0.5 : 0  // bonus for elite save projections
          urgencyBoost += eliteBonus
          reasons.push(`Need closers (${clCount}/${CL_MAX}) — ${Math.round((1-svPct)*100)}% SV gap`)
        }
      }

      // SP win urgency — only fires after round 5 (build hitter core first)
      if (p.pos === 'SP' && roles.winContributors < 7 && spCount < SP_MAX && roundNum >= 5 && hitterCount >= 3) {
        const spUrgency = Math.max(0, 0.8 - (spCount - 2) * 0.3)
        urgencyBoost += spUrgency
        if (spUrgency > 0) reasons.push(`Need win contributors (${roles.winContributors}/7)`)
      }

      // ── ADP VALUE BOOST / PENALTY ─────────────────────────────────────────
      let adpBoostPct = 0
      if (liveScore > 0 && p.cbsADP) {
        const myRank = rankMap.get(p.id) ?? 999
        const edge   = myRank - p.cbsADP
        if      (edge > 20)   adpBoostPct =  0.15
        else if (edge > 10)   adpBoostPct =  0.08
        else if (edge > 5)    adpBoostPct =  0.03
        else if (edge < -120) adpBoostPct = -0.50
        else if (edge < -80)  adpBoostPct = -0.35
        else if (edge < -50)  adpBoostPct = -0.22
        else if (edge < -30)  adpBoostPct = -0.12
        else if (edge < -15)  adpBoostPct = -0.06

        if (adpBoostPct > 0) {
          reasons.push(`Value pick — our rank #${myRank} vs CBS ADP ${p.cbsADP.toFixed(1)} (+${Math.round(edge)})`)
        } else if (adpBoostPct < 0) {
          reasons.push(`⚠ CBS ranks later (ADP ${p.cbsADP.toFixed(1)}) vs our #${myRank}`)
        }
      }

      // ── CATEGORY NEED REASONS ─────────────────────────────────────────────
      const cats = PLAYER_CATS[p.type] ?? []
      for (const cat of cats) {
        const w = gapWeights[cat] ?? 1
        const z = p[`z_${cat}`] ?? 0
        if (w >= 1.5 && z >= 1.0) {
          const target = targets[cat]?.third
          const cur = myTotals[cat] ?? 0
          const isNeg = NEG_CATS.has(cat)
          if (!isNeg) {
            const gapPct = target ? Math.round((1 - cur / target) * 100) : 0
            if (gapPct > 10) reasons.push(`${cat} gap ${gapPct}% — strong contributor`)
          } else {
            reasons.push(`Helps ${cat} (${cur > 0 ? cur.toFixed(2) : 'unset'} vs target ${target})`)
          }
        }
      }

      if (reasons.length === 0) reasons.push('Balanced contributor across categories')

      const adpBoost   = round2(liveScore * adpBoostPct)
      const finalScore = liveScore + urgencyBoost + adpBoost

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
    .filter(Boolean)
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
