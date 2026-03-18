'use client'

// Parse FantasyPros snake draft round paste.
//
// FantasyPros draft room includes a player headshot image when copied,
// which pastes as "Headshot of [Player Name]" — an extra line we must skip.
//
// Actual format per pick (7 lines with headshot, 6 without):
//   Team Name
//   Pick# (e.g. 1.10)  — or "KPR" for keeper
//   Headshot of P. Skenes   ← optional, skip this
//   P. Skenes
//   P
//   PIT
//   Edit
//
// Returns array of { pick, round, pickInRound, teamName, playerName, position, mlbTeam, isMine, isKeeper }

export function parseFantasyProsRound(text, myTeamName = 'numbahs') {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l =>
      l.length > 0 &&
      !l.toLowerCase().startsWith('headshot of') &&
      !l.toLowerCase().startsWith('headshot') &&
      l !== 'Current Pick' &&
      l !== 'Picks' &&
      !/^Rd \d+$/.test(l)
    )

  const picks = []
  let i = 0

  while (i < lines.length - 3) {
    const maybePick = lines[i + 1]

    const isRegularPick = /^\d+\.\d+$/.test(maybePick)
    const isKeeper      = /^KPR$/i.test(maybePick)

    if (isRegularPick || isKeeper) {
      const teamName = lines[i]
      const pickStr  = lines[i + 1]
      const player   = lines[i + 2]
      const position = lines[i + 3]
      const mlbTeam  = lines[i + 4] ?? ''

      let round = 0, pickInRound = 0, overallPick = 0

      if (isRegularPick) {
        const [roundStr, pinStr] = pickStr.split('.')
        round       = parseInt(roundStr)
        pickInRound = parseInt(pinStr)
        overallPick = (round - 1) * 10 + pickInRound
      }

      if (player && player !== 'Edit' && !/^\d/.test(player)) {
        picks.push({
          pick: overallPick,
          round,
          pickInRound,
          teamName:   teamName.trim(),
          playerName: player.trim(),
          position:   position?.trim() ?? '',
          mlbTeam:    mlbTeam?.trim() ?? '',
          isMine:     teamName.trim().toLowerCase() === myTeamName.toLowerCase(),
          isKeeper,
        })
      }

      i += 6
    } else {
      i++
    }
  }

  return picks
}

// ── NAME MATCHING ─────────────────────────────────────────────────────────────
// Suffixes that should be ignored when finding the true last name
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

function normName(s) {
  return String(s).toLowerCase()
    .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e')
    .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
    .replace(/[ùúûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim()
}

// Returns the last non-suffix word from a parts array
// e.g. ["bobby","witt","jr"] → "witt"
function trueLastName(parts) {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!SUFFIXES.has(parts[i])) return parts[i]
  }
  return parts[parts.length - 1]
}

// Fuzzy match a FantasyPros abbreviated name (e.g. "B. Witt", "F. Tatis Jr.")
// to our player list. Returns matched player or null.
export function matchPlayer(fpName, players) {
  const normFP  = normName(fpName)
  const fpParts = normFP.split(' ')
  const fpLast  = trueLastName(fpParts)           // "witt" from "b witt jr"
  const fpFirst = fpParts[0].replace('.', '')      // first initial or full name

  // 1. Exact match
  const exact = players.find(p => normName(p.name) === normFP)
  if (exact) return exact

  // 2. True last name + first initial
  const lastMatch = players.filter(p => {
    const pn     = normName(p.name).split(' ')
    const pLast  = trueLastName(pn)
    const pFirst = pn[0]?.[0] ?? ''
    return pLast === fpLast && pFirst === fpFirst[0]
  })
  if (lastMatch.length === 1) return lastMatch[0]
  if (lastMatch.length > 1) {
    return lastMatch.sort((a, b) => (b.FPTS ?? 0) - (a.FPTS ?? 0))[0]
  }

  // 3. True last name only (fallback — picks highest FPTS if multiple)
  const lastOnly = players.filter(p => {
    const pn = normName(p.name).split(' ')
    return trueLastName(pn) === fpLast
  })
  if (lastOnly.length === 1) return lastOnly[0]
  if (lastOnly.length > 1) {
    return lastOnly.sort((a, b) => (b.FPTS ?? 0) - (a.FPTS ?? 0))[0]
  }

  return null
}
