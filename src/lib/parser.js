'use client'

// Parse FantasyPros snake draft round paste.
// Each pick block is 6 lines:
//   Team Name
//   Pick# (e.g. 1.10)
//   Player Name (abbreviated: "B. Witt")
//   Position
//   MLB Team
//   Edit
//
// Returns array of { pick, round, pickInRound, teamName, playerName, position, mlbTeam, isMine }

export function parseFantasyProsRound(text, myTeamName = 'numbahs') {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  const picks = []
  let i = 0

  while (i < lines.length - 4) {
    // Try to match pattern: teamName, pickNum (X.XX), playerName, position, mlbTeam, Edit
    const maybePick = lines[i + 1]
    if (/^\d+\.\d+$/.test(maybePick)) {
      const teamName = lines[i]
      const pickStr  = lines[i + 1]
      const player   = lines[i + 2]
      const position = lines[i + 3]
      const mlbTeam  = lines[i + 4]
      // lines[i + 5] might be 'Edit' or next team

      const [roundStr, pickInRoundStr] = pickStr.split('.')
      const round = parseInt(roundStr)
      const pickInRound = parseInt(pickInRoundStr)
      const overallPick = (round - 1) * 10 + pickInRound // assumes 10 teams

      picks.push({
        pick: overallPick,
        round,
        pickInRound,
        teamName: teamName.trim(),
        playerName: player.trim(),
        position: position.trim(),
        mlbTeam: mlbTeam.trim(),
        isMine: teamName.trim().toLowerCase() === myTeamName.toLowerCase(),
      })

      i += 6 // skip past 'Edit'
    } else {
      i++
    }
  }

  return picks
}

// Fuzzy match a FantasyPros abbreviated name (e.g. "B. Witt") to our player list
// Returns matched player or null
export function matchPlayer(fpName, players) {
  const norm = s => s.toLowerCase()
    .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e')
    .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
    .replace(/[ùúûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim()

  const normFP = norm(fpName)

  // Exact match first
  const exact = players.find(p => norm(p.name) === normFP)
  if (exact) return exact

  // Abbreviated first name: "B. Witt Jr." → first initial + last name
  const fpParts = normFP.split(' ')
  const fpLast = fpParts[fpParts.length - 1]
  const fpFirst = fpParts[0].replace('.','')

  // Try last name + first initial
  const lastMatch = players.filter(p => {
    const pn = norm(p.name).split(' ')
    const pLast = pn[pn.length - 1]
    const pFirst = pn[0]?.[0] ?? ''
    return pLast === fpLast && pFirst === fpFirst[0]
  })
  if (lastMatch.length === 1) return lastMatch[0]
  if (lastMatch.length > 1) {
    // Pick by FPTS
    return lastMatch.sort((a,b) => (b.FPTS??0)-(a.FPTS??0))[0]
  }

  // Last name only (fallback)
  const lastOnly = players.filter(p => {
    const pn = norm(p.name).split(' ')
    return pn[pn.length-1] === fpLast
  })
  if (lastOnly.length === 1) return lastOnly[0]

  return null
}
