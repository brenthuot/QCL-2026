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
export function computeGapWeights(myTotals, targets, roundNum = 1, sensitivity = 1.0, amplifyRateStats = false, myPlayers = null) {
  // Rate stat amplifiers — only used for Recs tab (amplifyRateStats=true)
  // Board uses raw gaps so rankings aren't distorted by OBP/ERA/WHIP inflation
  const RATE_AMP = amplifyRateStats ? { OBP: 10, ERA: 8, WHIP: 12 } : {}

  const weights = {}
  for (const cat of ALL_CATS) {
    const target = targets[cat]?.third
    if (!target) { weights[cat] = 1; continue }

    const current = myTotals[cat] ?? 0
    const isNeg   = NEG_CATS.has(cat)
    const amp     = RATE_AMP[cat] ?? 1  // amplify rate stat gaps

    let gap
    if (isNeg) {
      if (current === 0) { weights[cat] = 1.5; continue }
      gap = current > target ? (current - target) / target : 0
    } else {
      gap = Math.max(0, (target - current) / target)
    }

    // Apply rate amplifier before scaling so OBP/ERA/WHIP reach meaningful weights
    const amplifiedGap = Math.min(1, gap * amp)
    weights[cat] = Math.max(0.2, Math.min(2.5, (0.2 + amplifiedGap * 2.3) * sensitivity))
  }

  // SB: use PROJECTED end-of-season total from drafted players, not accumulated stats.
  // Accumulated stats at mid-draft are a fraction of final projections, which creates
  // a phantom SB gap — e.g. 103 accumulated but 160 projected → model still chases SB.
  // Using projections gives the true picture of where the team will finish.
  const sbRawWeight = weights['SB'] ?? 1
  const sbCap = roundNum <= 3 ? 0.6 : roundNum <= 6 ? 1.0 : 1.4
  const sbTarget = targets.SB?.third ?? 186

  // Prefer projected SB from myPlayers (sum of each player's full-season SB projection)
  // Fall back to accumulated myTotals.SB if myPlayers not passed (backwards compat)
  const sbProjected = myPlayers
    ? myPlayers.filter(p => p.type === 'hitter').reduce((s, p) => s + (p.SB ?? 0), 0)
    : (myTotals.SB ?? 0)
  const sbPct = sbTarget > 0 ? sbProjected / sbTarget : 0

  // Surplus multiplier based on projected (not accumulated) pace
  const sbSurplusMult = sbPct >= 1.0  ? 0.1   // at/over target — almost zero
    : sbPct >= 0.85 ? 0.3                       // 85%+ projected — strongly reduce
    : sbPct >= 0.65 ? 0.7                       // 65%+ projected — moderate
    : 1.0
  weights['SB'] = Math.min(sbCap, sbRawWeight * 1.15 * sbSurplusMult)

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

  // CL/SU pitch ~65 IP vs ~180 for SP — dampen K and W so high-K relievers
  // (like Drew Anderson 147K/131IP) don't inflate to SP-tier scores
  const isCLSU = ['CL','SU'].includes(player.pos)

  for (const cat of cats) {
    const zKey = `z_${cat}`
    let z = player[zKey] ?? 0
    // CL/SU: W is irrelevant; K contribution is ~35% of an SP's (IP ratio)
    if (isCLSU && cat === 'W') z = 0
    if (isCLSU && cat === 'K') z = z * 0.35
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
    // RP merges into SP pool; SU merges into CL pool
    winContributors: pitchers.filter(p => ['SP','RP'].includes(p.pos) && ((p.W ?? 0) >= 5 || (p.IP ?? 0) >= 100)).length,
    closers:  pitchers.filter(p => ['CL','SU'].includes(p.pos) && (p.SV ?? 0) >= 8).length,
    holdSpec: pitchers.filter(p => ['CL','SU'].includes(p.pos) && (p.HLD ?? 0) >= 5).length,
    totalSP:  pitchers.filter(p => ['SP','RP'].includes(p.pos)).length,
    totalCL:  pitchers.filter(p => ['CL','SU'].includes(p.pos)).length,
  }
}

// ── RECOMMENDATION ENGINE ─────────────────────────────────────────────────────
export function buildRecommendations(
  availablePlayers, myPlayers, targets, roundNum, myTotals, gapWeights,
  fullPool, currentPick
) {
  const roles       = rosterRoles(myPlayers)
  const hitterCount = myPlayers.filter(p => p.type === 'hitter').length
  const pitcherCount= myPlayers.filter(p => p.type === 'pitcher').length
  // spCount/clCount defined below with merged pools

  // ── ROSTER SLOT LIMITS ───────────────────────────────────────────────────
  // Derived from strategic analysis of 5 mocks + roto math:
  // • 3 CLs = top 4-5 in S  (~91-100 SV). 4th CL costs R4-5 elite hitter — not worth it.
  // • 3 SU in R14-18 = genuine top 4 in HD at almost zero opportunity cost
  // • Never more than 2 of any non-OF hitter position (SS overload kills OBP)
  // Roster: C+1B+2B+3B+SS+4OF+3UTIL = 12 hitter slots
  //         4SP+3RP+2P-flex+3BN(pitchers only) = 12 pitcher slots → 24 total
  const HITTER_TARGET = 12
  const SP_MAX        = 7   // 4SP + 2P-flex + 1BN overflow
  const CL_MAX        = 4   // 4 closers: 3 RP slots + 1 P-flex, no SU drafted
  const PITCHER_MAX   = 12  // all pitcher slots including 3 BN (pitchers only)

  // RP merges into SP pool, SU merges into CL pool
  const spCount      = myPlayers.filter(p => ['SP','RP'].includes(p.pos)).length
  const clCount      = myPlayers.filter(p => p.pos === 'CL').length  // SU not drafted

  // Position diversity tracking
  const hittersByPos = {}
  for (const pl of myPlayers.filter(p => p.type === 'hitter'))
    hittersByPos[pl.pos] = (hittersByPos[pl.pos] ?? 0) + 1
  const POS_NEED = { C:1, '1B':1, '2B':1, '3B':1, SS:1, OF:4 }
  const POS_SAT  = { C:1, '1B':3, '2B':2, '3B':2, SS:2, OF:6 }  // C:1 — bench is pitchers-only so only 1 C slot matters

  // Category projections
  const projK  = myTotals.K ?? 0
  const projSV = myTotals.S ?? 0
  const projHD = myTotals.HD ?? 0
  const projOBP= myTotals.OBP ?? 0
  const kTarget  = targets.K?.third  ?? 1525
  const svTarget = targets.S?.third  ?? 115
  const hdTarget = targets.HD?.third ?? 61
  const obpTarget= targets.OBP?.third?? 0.345
  const kPct  = kTarget  > 0 ? projK  / kTarget  : 1
  const svPct = svTarget > 0 ? projSV / svTarget  : 1
  const hdPct = hdTarget > 0 ? projHD / hdTarget  : 1

  // Stable rank map (full pool, keepers excluded)
  const poolForRank = fullPool ?? availablePlayers
  const sortedFull  = [...poolForRank].filter(p => !p.isKeeper)
    .sort((a,b) => (b.liveScore ?? -99) - (a.liveScore ?? -99))
  const rankMap = new Map(sortedFull.map((p,i) => [p.id, i+1]))

  return availablePlayers
    .filter(p => !p.drafted)
    .map(p => {
      const { liveScore } = computeLiveScore(p, gapWeights)
      let urgencyBoost = 0
      let reasons = []

      // ── HARD BLOCKS ───────────────────────────────────────────────────────
      // Hitter hard block: bench is pitchers-only. Once all 12 hitter slots
      // are filled, no more hitters should ever be recommended.
      if (p.type === 'hitter' && hitterCount >= HITTER_TARGET) return null
      // Players with no CBS ADP and ADP=999 are deep unknowns — gate to R14+
      if (!p.cbsADP && (p.ADP == null || p.ADP >= 300) && roundNum < 14) return null

      // Hard ADP reality check: don't recommend players the market considers
      // far too early. Lookahead scales with where we are in the draft —
      // early picks demand tighter consensus, late picks allow more reaching.
      // pick 1-30:  +15 (only near-consensus picks)
      // pick 31-60: +25 (small reaches ok)
      // pick 61-100: +35 (position urgency can pull forward a bit)
      // pick 101-150: +45 (mid-late, more flexibility)
      // pick 150+:  +60 (late rounds, speculative picks fine)
      if (currentPick != null && p.cbsADP) {
        const lookahead = currentPick <= 30  ? 15
          : currentPick <= 60  ? 25
          : currentPick <= 100 ? 35
          : currentPick <= 150 ? 45
          : 60
        if (p.cbsADP > currentPick + lookahead) return null
      }

      // SP+RP pool saturated
      if (['SP','RP'].includes(p.pos) && spCount >= SP_MAX) return null
      // CL+SU pool: gate before R7 (saves first), then saturate
      if (['CL','SU'].includes(p.pos)) {
        if (roundNum < 7) return null
        if (clCount >= CL_MAX) return null
      }
      // Pitcher roster full
      if (p.type === 'pitcher' && pitcherCount >= PITCHER_MAX) return null
      // Hitter pace critical — block all pitchers
      const expectedH = Math.round(roundNum * (HITTER_TARGET / 24))
      const hitterDeficit = expectedH - hitterCount
      if (hitterDeficit >= 3 && p.type === 'pitcher') return null
      // Position overloaded
      if (p.type === 'hitter') {
        const myPosCount = hittersByPos[p.pos] ?? 0
        if (myPosCount >= (POS_SAT[p.pos] ?? 3)) return null
      }

      // ── HITTER PACE ───────────────────────────────────────────────────────
      if (hitterDeficit >= 2 && p.type === 'pitcher') {
        urgencyBoost -= 3.0
        reasons.push(`⚠ Behind on hitters (${hitterCount}/${expectedH} by R${roundNum}) — pitchers penalized`)
      }
      if (hitterDeficit >= 2 && p.type === 'hitter') {
        urgencyBoost += hitterDeficit * 1.5
        reasons.push(`Filling hitter gap (${hitterCount}/${expectedH} expected by R${roundNum})`)
      }

      // ── POSITION DIVERSITY ────────────────────────────────────────────────
      if (p.type === 'hitter') {
        const myPosCount = hittersByPos[p.pos] ?? 0
        const needed     = POS_NEED[p.pos] ?? 1

        // Soft penalty for redundant position (1 over)
        if (myPosCount >= needed + 1) {
          urgencyBoost -= 1.5
          reasons.push(`Already ${myPosCount} ${p.pos} — redundancy penalty`)
        }

        // Empty position urgency — scale by how late it is
        if (myPosCount === 0 && roundNum >= 7) {
          const urgency = p.pos === '2B' ? 2.5   // 2B goes undrafted most commonly
            : p.pos === 'C'  ? 2.0               // C scarcity is real
            : 1.2
          urgencyBoost += urgency
          reasons.push(`${p.pos} slot empty — need to fill by R${Math.min(roundNum+3, 18)}`)
        }
      }

      // ── OBP QUALITY GATE ──────────────────────────────────────────────────
      // Team OBP target is 0.345 — low-OBP hitters silently kill this category.
      // Penalty scales with both how low the player's OBP is AND how far team is from target.
      if (p.type === 'hitter' && roundNum < 20) {
        const obp = p.OBP ?? 0
        const teamBehind = projOBP > 0 && obpTarget > 0 ? obpTarget - projOBP : 0

        if (obp < 0.305) {
          urgencyBoost -= 2.5
          reasons.push(`⚠ Very low OBP ${obp.toFixed(3)} — damages team average (target ${obpTarget.toFixed(3)})`)
        } else if (obp < 0.318) {
          urgencyBoost -= 1.2 + (teamBehind > 0.01 ? 0.8 : 0)
          reasons.push(`⚠ Below-avg OBP ${obp.toFixed(3)} — team at ${projOBP > 0 ? projOBP.toFixed(3) : '?'}`)
        }

        // Boost high-OBP players when team is below target
        if (obp >= 0.345 && teamBehind > 0.005 && roundNum >= 4) {
          urgencyBoost += 0.8
          reasons.push(`Elite OBP ${obp.toFixed(3)} — helps team reach ${obpTarget.toFixed(3)} target`)
        }
      }

      // ── CL SAVE URGENCY ───────────────────────────────────────────────────
      // Strategy: 3 CLs gets you top 4-5 in S (~91-100 SV).
      // Prioritize elite-SV closers (Diaz 36, Bednar 33, Miller 32) over mid-tier.
      // Don't chase 4th CL — the opportunity cost in R4-5 isn't worth it.
      if (p.pos === 'CL' && clCount < CL_MAX) {
        // Only activate after round 6 (don't take CL over R1-5 elite hitters)
        const baseUrgency = roundNum >= 7 ? 1.5
          : roundNum >= 5 ? 0.8
          : 0
        // Extra urgency for elite-SV closers (top 4: Diaz/Bednar/Miller/Williams)
        const zS = p.z_S ?? 0
        const eliteBonus = zS > 1.2 ? 0.6     // Diaz/Bednar tier
          : zS > 0.9  ? 0.3     // Miller/Williams tier
          : 0
        urgencyBoost += baseUrgency + eliteBonus
        if (baseUrgency > 0)
          reasons.push(`Need CL ${clCount}/${CL_MAX} — target ${Math.round(svPct*100)}% of SV goal`)
        if (eliteBonus > 0)
          reasons.push(`Elite closer: ${Math.round(p.SV ?? 0)} SV projected`)
      }

      // ── SU HOLD URGENCY ───────────────────────────────────────────────────
      // Strategy: 3 SU in R14-18 = cheap path to top 4 in HD.
      // These rounds have little value anyway. HD target 61 HLD.
      if (false) {  // SU not drafted — stream holds
        const zHD = p.z_HD ?? 0
        const hdUrgency = hdPct < 0.70 ? 1.5 : hdPct < 0.85 ? 1.0 : 0.5
        const qualityBonus = zHD > 0.8 ? 0.5 : 0
        urgencyBoost += hdUrgency + qualityBonus
        reasons.push(`Need hold spec ${suCount}/${SU_MAX} — ${Math.round(p.HLD ?? 0)} HLD (${Math.round(hdPct*100)}% of target)`)
      }

      // ── SP STRIKEOUT URGENCY ──────────────────────────────────────────────
      // K is the hardest pitching cat — cannot be streamed, must be drafted.
      // Multiplier 1.5x makes high-K arms competitive with SB hitters.
      // Gate lowered to R5 so it fires before too many low-K SPs sneak in.
      if (['SP','RP'].includes(p.pos) && spCount < SP_MAX && kPct < 0.85 && roundNum >= 5 && hitterCount >= 2) {
        const zK = p.z_K ?? 0
        if (zK > 0.5) {
          const kUrgency = zK * 1.5 * (1 - kPct)
          urgencyBoost += kUrgency
          reasons.push(`K gap ${Math.round((1-kPct)*100)}% — ${Math.round(p.SO ?? 0)}K projected`)
        }
      }

      // ── SP WIN URGENCY ────────────────────────────────────────────────────
      // Only after R5 with hitter core started.
      if (['SP','RP'].includes(p.pos) && roles.winContributors < 7 && spCount < SP_MAX && roundNum >= 5 && hitterCount >= 3) {
        const spUrgency = Math.max(0, 0.8 - (spCount - 2) * 0.3)
        urgencyBoost += spUrgency
        if (spUrgency > 0) reasons.push(`Win contributors ${roles.winContributors}/7 — W gap`)
      }

      // ── ADP VALUE BOOST / PENALTY ─────────────────────────────────────────
      // Tiebreaker: CBS market signal. Caps at ±15% so category logic dominates.
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

        // For reason text use current pick (more actionable) but keep board rank for penalty calc
        const pickEdge = currentPick != null ? currentPick - p.cbsADP : edge
        if (adpBoostPct > 0)
          reasons.push(`Value: pick #${currentPick ?? myRank} vs CBS ADP ${p.cbsADP.toFixed(0)} (+${Math.round(Math.abs(pickEdge))})`)
        else if (adpBoostPct < 0) {
          const spotsLater = Math.round(Math.abs(pickEdge))
          if (spotsLater > 2)
            reasons.push(`⚠ CBS ADP ${p.cbsADP.toFixed(0)} — ${spotsLater > 0 ? spotsLater + ' spots later than now' : 'near consensus'}`)
        }
      }

      // ── CATEGORY GAP REASONS ──────────────────────────────────────────────
      const cats = PLAYER_CATS[p.type] ?? []
      for (const cat of cats) {
        const w = gapWeights[cat] ?? 1
        const z = p[`z_${cat}`] ?? 0
        if (w >= 1.5 && z >= 1.0) {
          const target = targets[cat]?.third
          const cur    = myTotals[cat] ?? 0
          const isNeg  = NEG_CATS.has(cat)
          if (!isNeg) {
            const gapPct = target ? Math.round((1 - cur/target)*100) : 0
            if (gapPct > 10) reasons.push(`${cat} gap ${gapPct}% — strong contributor`)
          } else {
            reasons.push(`Helps ${cat} (${cur > 0 ? cur.toFixed(2) : 'unset'} → target ${target})`)
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
