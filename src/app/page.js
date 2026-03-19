'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ALL_CATS, NEG_CATS,
  computeGapWeights, computeLiveScore, assignTiers,
  computeTeamTotals, catProgress, rosterRoles,
  buildRecommendations, posColor, tierColor,
} from '../lib/scoring'
import { parseFantasyProsRound, matchPlayer } from '../lib/parser'

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const MY_TEAM = 'numbahs'
const LS_KEY  = 'qcl2026_draft_v3'
const TOTAL_TEAMS = 10

const KEEPERS = [
  { team:"Jim Dog's Heroes",     name:"Kyle Schwarber",        round:6  },
  { team:"Jim Dog's Heroes",     name:"Vladimir Guerrero Jr.", round:5  },
  { team:"Boys of Summer",       name:"Andrew Abbott",         round:17 },
  { team:"Boys of Summer",       name:"Juan Soto",             round:3  },
  { team:"Roady",                name:"Corbin Carroll",        round:8  },
  { team:"Roady",                name:"Teoscar Hernandez",     round:13 },
  { team:"Purple and Gold",      name:"Aaron Judge",           round:2  },
  { team:"Purple and Gold",      name:"Ronald Acuna Jr.",      round:8  },
  { team:"Big League CHOO",      name:"Francisco Lindor",      round:4  },
  { team:"Big League CHOO",      name:"Jose Ramirez",          round:5  },
  { team:"The Cahills & Carole", name:"Bryce Harper",          round:21 },
  { team:"The Cahills & Carole", name:"Eugenio Suarez",        round:16 },
  { team:"Hendu",                name:"Chris Sale",            round:10 },
  { team:"Hendu",                name:"Tarik Skubal",          round:1  },
  { team:"The Milkmen",          name:"Shohei Ohtani",         round:15 },
  { team:"The Milkmen",          name:"Yoshinobu Yamamoto",    round:5  },
  { team:"numbahs",              name:"Cristopher Sanchez",    round:19 },
  { team:"numbahs",              name:"Junior Caminero",       round:14 },
]

// Watchlist — calibrated from 5 mock drafts
// stars: ⭐=target, ⭐⭐=priority, ⭐⭐⭐=must-have
const WATCHLIST = [
  { name:"Jarren Duran",      abbr:"Duran",       pos:"OF",    rdLo:4,  rdHi:6,  stars:1, note:"R4-6 in mocks; realistic 5.10 target" },
  { name:"Brice Turang",      abbr:"Turang",       pos:"2B",    rdLo:3,  rdHi:4,  stars:2, note:"R3-4 in ALL mocks; steal at 4.01" },
  { name:"Geraldo Perdomo",   abbr:"Perdomo",      pos:"SS",    rdLo:6,  rdHi:7,  stars:3, note:"R7 EVERY mock; SB machine — 6.01/7.10" },
  { name:"Maikel Garcia",     abbr:"M.Garcia",     pos:"2B",    rdLo:7,  rdHi:7,  stars:3, note:"R7 EVERY mock; plan for 7.10" },
  { name:"Kyle Stowers",      abbr:"Stowers",      pos:"OF",    rdLo:11, rdHi:13, stars:1, note:"R11-13; consistent value" },
  { name:"Trey Yesavage",     abbr:"Yesavage",     pos:"SP",    rdLo:10, rdHi:13, stars:1, note:"Upside arm; don't sleep at 10-11" },
  { name:"Jacob Misiorowski", abbr:"Misiorowski",  pos:"SP",    rdLo:10, rdHi:11, stars:2, note:"Goes R10-11 every mock; earlier than expected" },
  { name:"Agustin Ramirez",   abbr:"A.Ramirez",    pos:"C",     rdLo:10, rdHi:11, stars:1, note:"Best backup C value; R10-11 consistent" },
  { name:"Emmet Sheehan",     abbr:"Sheehan",      pos:"SP",    rdLo:12, rdHi:14, stars:1, note:"Upside arm; reliable R12-14 window" },
  { name:"Cam Schlittler",    abbr:"Schlittler",   pos:"SP",    rdLo:12, rdHi:13, stars:1, note:"R12-13 consistent" },
  { name:"Konnor Griffin",    abbr:"Griffin",      pos:"SS",    rdLo:13, rdHi:22, stars:1, note:"Wildly inconsistent R13-22; let him fall" },
  { name:"Trevor Rogers",     abbr:"T.Rogers",     pos:"SP",    rdLo:13, rdHi:14, stars:1, note:"R13-14 consistent" },
  { name:"Kevin McGonigle",   abbr:"McGonigle",    pos:"SS",    rdLo:14, rdHi:20, stars:2, note:"Only 1/5 mocks; sleeper" },
  { name:"Bubba Chandler",    abbr:"Chandler",     pos:"SP",    rdLo:15, rdHi:18, stars:3, note:"High upside; R15-18 window every mock" },
  { name:"Jac Caglianone",    abbr:"Caglianone",   pos:"1B",    rdLo:17, rdHi:24, stars:1, note:"4/5 mocks; emerging bat" },
  { name:"Alejandro Kirk",    abbr:"Kirk",         pos:"C",     rdLo:19, rdHi:20, stars:1, note:"Reliable late C; R19-20 every mock" },
  { name:"Addison Barger",    abbr:"Barger",       pos:"3B",    rdLo:21, rdHi:23, stars:1, note:"R21-23 consistent" },
  { name:"Jonathan Aranda",   abbr:"Aranda",       pos:"1B",    rdLo:18, rdHi:22, stars:1, note:"Inconsistent range but late value" },
  { name:"Sal Stewart",       abbr:"Sal Stewart",  pos:"1B",    rdLo:21, rdHi:24, stars:1, note:"Only 1/5 mocks; near-undrafted" },
  { name:"Brendan Donovan",   abbr:"Donovan",      pos:"2B",    rdLo:23, rdHi:23, stars:1, note:"R23 EVERY mock; free" },
  { name:"Max Muncy",         abbr:"Muncy",        pos:"3B",    rdLo:23, rdHi:24, stars:1, note:"R23-24; near undrafted value" },
  { name:"JJ Wetherholt",     abbr:"Wetherholt",   pos:"SS",    rdLo:24, rdHi:24, stars:2, note:"R24 EVERY mock; always available" },
  // Additional targets — watchlist only (speculative/late)
  { name:"Andrew Vaughn",     abbr:"A.Vaughn",     pos:"1B",    rdLo:16, rdHi:22, stars:1, note:"0/5 mocks drafted; pure late value 1B" },
  { name:"Thomas White",      abbr:"T.White",      pos:"SP",    rdLo:18, rdHi:24, stars:1, note:"0/5 mocks; MIA upside arm — pure spec" },
  { name:"Kevin McGonigle",   abbr:"McGonigle",    pos:"SS",    rdLo:14, rdHi:20, stars:2, note:"1/5 mocks at R18; sleeper SS prospect" },
]

const MY_KEEPERS = KEEPERS.filter(k => k.team === MY_TEAM)

// Roster slots
const SLOTS = [
  {id:'C',    label:'C',    elig:['C']                              },
  {id:'1B',   label:'1B',   elig:['1B']                            },
  {id:'2B',   label:'2B',   elig:['2B']                            },
  {id:'3B',   label:'3B',   elig:['3B']                            },
  {id:'SS',   label:'SS',   elig:['SS']                            },
  {id:'OF1',  label:'OF',   elig:['OF']                            },
  {id:'OF2',  label:'OF',   elig:['OF']                            },
  {id:'OF3',  label:'OF',   elig:['OF']                            },
  {id:'OF4',  label:'OF',   elig:['OF']                            },
  {id:'UT1',  label:'UTIL', elig:['C','1B','2B','3B','SS','OF']    },
  {id:'UT2',  label:'UTIL', elig:['C','1B','2B','3B','SS','OF']    },
  {id:'UT3',  label:'UTIL', elig:['C','1B','2B','3B','SS','OF']    },
  {id:'SP1',  label:'SP',   elig:['SP']                            },
  {id:'SP2',  label:'SP',   elig:['SP']                            },
  {id:'SP3',  label:'SP',   elig:['SP']                            },
  {id:'SP4',  label:'SP',   elig:['SP']                            },
  {id:'RP1',  label:'RP',   elig:['RP','CL','SU']                  },
  {id:'RP2',  label:'RP',   elig:['RP','CL','SU']                  },
  {id:'RP3',  label:'RP',   elig:['RP','CL','SU']                  },
  {id:'P1',   label:'P',    elig:['SP','RP','CL','SU']             },
  {id:'P2',   label:'P',    elig:['SP','RP','CL','SU']             },
  {id:'BN1',  label:'BN',   elig:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'] },
  {id:'BN2',  label:'BN',   elig:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'] },
  {id:'BN3',  label:'BN',   elig:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'] },
]

// ── HELPERS ───────────────────────────────────────────────────────────────────
function normName(n) {
  return String(n).toLowerCase()
    .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e')
    .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
    .replace(/[ùúûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim()
}

function matchKeeperToPlayer(name, players) {
  const kn = normName(name)
  let m = players.find(p => normName(p.name) === kn)
  if (m) return m
  const kp = kn.split(' ')
  const kl = kp[kp.length-1], kf = kp[0]?.[0] ?? ''
  return players.filter(p => {
    const pp = normName(p.name).split(' ')
    return pp[pp.length-1] === kl && pp[0]?.[0] === kf
  }).sort((a,b) => (b.FPTS??0)-(a.FPTS??0))[0] ?? null
}

function getMyPickSlots() {
  // Snake draft, pick 10, 24 rounds
  const slots = []
  for (let rd = 1; rd <= 24; rd++) {
    const pk = rd % 2 === 1 ? 10 : 1
    const overall = (rd-1)*10 + pk
    slots.push({ round: rd, pick: pk, overall })
  }
  return slots
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [hitters,  setHitters]  = useState([])
  const [pitchers, setPitchers] = useState([])
  const [config,   setConfig]   = useState(null)
  const [loading,  setLoading]  = useState(true)

  // Board UI state
  const [tab,         setTab]         = useState('board')
  const [boardFilter, setBoardFilter] = useState('ALL')   // ALL H P ⭐ pos
  const [search,      setSearch]      = useState('')
  const [showDrafted, setShowDrafted] = useState(false)
  const [showKept,    setShowKept]    = useState(true)
  const [boardLimit,  setBoardLimit]  = useState(200)

  // Pool tab
  const [poolSearch, setPoolSearch] = useState('')
  const [poolPos,    setPoolPos]    = useState('ALL')
  const [poolSort,   setPoolSort]   = useState('liveScore')

  // Sidebar
  const [sidebarOpen,    setSidebarOpen]    = useState(true)
  const [hitWeight,      setHitWeight]      = useState(50)
  const [pitCompress,    setPitCompress]    = useState(0.85)
  const [gapSensitivity, setGapSensitivity] = useState(1.0)

  // Draft state
  const [draftedIds,  setDraftedIds]  = useState(new Set())
  const [myPlayerIds, setMyPlayerIds] = useState([])
  const [keeperIds,   setKeeperIds]   = useState(new Set())
  const [myKeeperIds, setMyKeeperIds] = useState([])
  const [round,       setRound]       = useState(1)

  // Selected player panel
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  // Modals
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg,  setImportMsg]  = useState('')
  const [showReset,  setShowReset]  = useState(false)

  // Watchlist player ids
  const watchlistIds = useMemo(() => new Set(
    WATCHLIST.map(w => w.name.toLowerCase())
  ), [])

  // Load data
  useEffect(() => {
    Promise.all([
      fetch('/hitters.json').then(r => r.json()),
      fetch('/pitchers.json').then(r => r.json()),
      fetch('/config.json').then(r => r.json()),
    ]).then(([h, p, c]) => {
      setHitters(h); setPitchers(p); setConfig(c)
      const all = [...h, ...p]
      const kIds = new Set(), kDrafted = new Set(), myKIds = []
      for (const k of KEEPERS) {
        const player = matchKeeperToPlayer(k.name, all)
        if (!player) { console.warn('Keeper not matched:', k.name); continue }
        kIds.add(player.id); kDrafted.add(player.id)
        if (k.team === MY_TEAM) myKIds.push(player.id)
      }
      setKeeperIds(kIds)
      let restored = false
      try {
        const saved = localStorage.getItem(LS_KEY)
        if (saved) {
          const { drafted, mine, roundNum } = JSON.parse(saved)
          setDraftedIds(new Set([...kDrafted, ...(drafted||[])]))
          setMyPlayerIds([...new Set([...myKIds, ...(mine||[])])])
          setMyKeeperIds(myKIds)
          setRound(roundNum || 1)
          restored = true
        }
      } catch {}
      if (!restored) {
        setDraftedIds(kDrafted); setMyPlayerIds(myKIds); setMyKeeperIds(myKIds)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (loading) return
    localStorage.setItem(LS_KEY, JSON.stringify({
      drafted: [...draftedIds], mine: myPlayerIds, roundNum: round
    }))
  }, [draftedIds, myPlayerIds, round, loading])

  const allPlayers = useMemo(() => [...hitters, ...pitchers], [hitters, pitchers])
  const playerById = useMemo(() => Object.fromEntries(allPlayers.map(p => [p.id, p])), [allPlayers])
  const myPlayers  = useMemo(() => myPlayerIds.map(id => playerById[id]).filter(Boolean), [myPlayerIds, playerById])
  const myTotals   = useMemo(() => computeTeamTotals(myPlayers), [myPlayers])
  const targets    = config?.targets ?? {}
  const gapWeights = useMemo(() => computeGapWeights(myTotals, targets, round, gapSensitivity), [myTotals, targets, round, gapSensitivity])

  // Watchlist lookup by player id
  const watchlistByPlayerId = useMemo(() => {
    const m = {}
    for (const w of WATCHLIST) {
      const p = matchKeeperToPlayer(w.name, allPlayers)
      if (p) m[p.id] = w
    }
    return m
  }, [allPlayers])

  // Score all players
  const scoredPlayers = useMemo(() => {
    const pitW = (100 - hitWeight) / 100
    const hitW = hitWeight / 100
    const all = allPlayers.map(p => {
      const { liveScore, liveBreakdown } = computeLiveScore(p, gapWeights)
      const rpDampener = p.pos==='CL' ? 0.68 : p.pos==='SU' ? 0.18 : p.pos==='RP' ? 0.18 : 1.0
      const typeScale  = p.type==='hitter' ? hitW*2 : pitW*2*(p.pos==='SP' ? pitCompress : pitCompress*rpDampener)
      const kInfo = watchlistByPlayerId[p.id]
      return {
        ...p,
        drafted:    draftedIds.has(p.id),
        isKeeper:   keeperIds.has(p.id),
        isMine:     myPlayerIds.includes(p.id),
        isMyKeeper: myKeeperIds.includes(p.id),
        isWatchlist: !!watchlistByPlayerId[p.id],
        watchlistInfo: watchlistByPlayerId[p.id] ?? null,
        keeperInfo: KEEPERS.find(k => matchKeeperToPlayer(k.name, [p])?.id === p.id) ?? null,
        liveScore:  liveScore * typeScale,
        liveBreakdown,
      }
    })
    return assignTiers(all, 'liveScore')
  }, [allPlayers, draftedIds, keeperIds, myPlayerIds, myKeeperIds, gapWeights, hitWeight, pitCompress, watchlistByPlayerId])

  // Full-pool stable rank map
  const fullRankMap = useMemo(() => {
    const sorted = [...scoredPlayers].filter(p => !p.isKeeper).sort((a,b) => (b.liveScore??-99)-(a.liveScore??-99))
    return new Map(sorted.map((p,i) => [p.id, i+1]))
  }, [scoredPlayers])

  const roles = useMemo(() => rosterRoles(myPlayers), [myPlayers])

  const recommendations = useMemo(() =>
    buildRecommendations(
      scoredPlayers.filter(p => !p.drafted && !p.isKeeper),
      myPlayers, targets, round, myTotals, gapWeights, scoredPlayers
    ).slice(0, 8),
  [scoredPlayers, myPlayers, targets, round, myTotals, gapWeights])

  const diagnostics = useMemo(() => {
    const avail  = scoredPlayers.filter(p => !p.drafted && !p.isKeeper)
    const sorted = [...avail].sort((a,b) => b.liveScore-a.liveScore)
    return {
      spIn20:  sorted.slice(0,20).filter(p=>p.pos==='SP').length,
      spIn50:  sorted.slice(0,50).filter(p=>p.pos==='SP').length,
      spIn100: sorted.slice(0,100).filter(p=>p.pos==='SP').length,
      clIn20:  sorted.slice(0,20).filter(p=>p.pos==='CL').length,
      clIn50:  sorted.slice(0,50).filter(p=>p.pos==='CL').length,
      rpIn50:  sorted.slice(0,50).filter(p=>['CL','SU','RP'].includes(p.pos)).length,
    }
  }, [scoredPlayers])

  // Next pick info
  const myPickSlots = useMemo(() => getMyPickSlots(), [])
  const nonKeeperDrafted = useMemo(() => [...draftedIds].filter(id => !keeperIds.has(id)).length, [draftedIds, keeperIds])
  const nextPick = useMemo(() => {
    const draftedCount = nonKeeperDrafted + keeperIds.size
    const currentOverall = draftedCount + 1
    // Find which of my slots is next undrafted
    const mySlot = myPickSlots.find(s => {
      const k14 = s.round === 14, k19 = s.round === 19
      if (k14 || k19) return false
      return s.overall >= currentOverall
    })
    return mySlot
  }, [myPickSlots, nonKeeperDrafted, keeperIds])

  // Actions
  const markDrafted = useCallback((player, isMine) => {
    setDraftedIds(prev => new Set([...prev, player.id]))
    if (isMine && !myPlayerIds.includes(player.id)) setMyPlayerIds(prev => [...prev, player.id])
    setRound(() => {
      const nd = [...draftedIds].filter(id => !keeperIds.has(id)).length + 1
      return Math.max(1, Math.floor(nd/TOTAL_TEAMS) + 1)
    })
  }, [draftedIds, myPlayerIds, keeperIds])

  const undraftPlayer = useCallback((id) => {
    if (keeperIds.has(id)) return
    setDraftedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    setMyPlayerIds(prev => prev.filter(pid => pid !== id))
  }, [keeperIds])

  const handleImport = useCallback(() => {
    const picks = parseFantasyProsRound(importText, MY_TEAM)
    if (!picks.length) { setImportMsg('⚠ No picks found.'); return }
    let matched=0, mine=0, unmatched=[]
    const newD = new Set(draftedIds), newM = [...myPlayerIds]
    for (const pick of picks) {
      const p = matchPlayer(pick.playerName, allPlayers)
      if (!p) { unmatched.push(pick.playerName); continue }
      if (!newD.has(p.id)) {
        newD.add(p.id); matched++
        if (pick.isMine && !newM.includes(p.id)) { newM.push(p.id); mine++ }
      }
    }
    setDraftedIds(newD); setMyPlayerIds(newM)
    setRound(picks.length ? Math.max(...picks.map(p=>p.round))+1 : round)
    setImportMsg(`✅ Imported ${matched} picks (${mine} yours).${unmatched.length ? ` Unmatched: ${unmatched.slice(0,4).join(', ')}` : ''}`)
    setImportText('')
  }, [importText, draftedIds, myPlayerIds, allPlayers, round])

  const resetDraft = useCallback(() => {
    const kD = new Set(), myKIds = []
    for (const k of KEEPERS) {
      const p = matchKeeperToPlayer(k.name, allPlayers)
      if (!p) continue
      kD.add(p.id)
      if (k.team === MY_TEAM) myKIds.push(p.id)
    }
    setDraftedIds(kD); setMyPlayerIds(myKIds); setRound(1)
    setShowReset(false); localStorage.removeItem(LS_KEY)
  }, [allPlayers])

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--text2)',fontSize:14,gap:10}}>
      <span style={{fontSize:20}}>⚾</span> Loading QCL 2026...
    </div>
  )

  const tabs = [
    {id:'board',    label:'🎯 Draft Board'},
    {id:'team',     label:`⚾ My Team${myPlayers.length > 0 ? ` ${myPlayers.length}` : ''}`},
    {id:'cats',     label:'📊 Categories'},
    {id:'rec',      label:'⚡ Recs'},
    {id:'strategy', label:'📋 Strategy'},
    {id:'pool',     label:'🔍 Full Pool'},
  ]

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>

      {/* HEADER */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border2)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <span style={{fontSize:15,fontWeight:700,color:'var(--blue2)',letterSpacing:'0.06em'}}>⚾ QCL 2026</span>
            <span style={{fontSize:11,color:'var(--text3)'}}>Roto · 10-Team · Pick&nbsp;10</span>
            {nextPick && (
              <span style={{fontSize:11,fontWeight:700,color:'var(--tier1)',background:'rgba(251,191,36,0.1)',padding:'2px 8px',borderRadius:3,border:'1px solid rgba(251,191,36,0.3)'}}>
                ▲ Pick {nextPick.round}.{String(nextPick.pick).padStart(2,'0')}
              </span>
            )}
            <span style={{fontSize:11,color:'var(--text3)'}}>
              Rd <b style={{color:'var(--text2)'}}>{round}</b>
              {' · '}<b style={{color:'var(--text2)'}}>{nonKeeperDrafted}</b> drafted
              {' · '}<b style={{color:'var(--blue2)'}}>{myPlayers.length}</b>/24 mine
            </span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowImport(true)}>📥 Import Round</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowReset(true)}>↺ Reset</button>
          </div>
        </div>
        <div className="tab-nav" style={{padding:'0 14px'}}>
          {tabs.map(t => (
            <div key={t.id} className={`tab-item ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>{t.label}</div>
          ))}
        </div>
        {/* Active tab description */}
        <div style={{padding:'2px 14px 3px',fontSize:10,color:'var(--text3)',borderTop:'1px solid var(--border)',background:'var(--bg)'}}>
          {tab==='board' && 'Live-ranked board · M = mine · D = other team drafted · click any row for details'}
          {tab==='team'  && 'Your roster + 12-cat progress bars vs JRH targets'}
          {tab==='cats'  && 'Category gap analysis sorted by urgency · updates after every pick'}
          {tab==='rec'   && 'Best pick right now · weighted by your category gaps and role needs'}
          {tab==='pool'     && 'All players · sortable by any stat · use to look up anyone'}
          {tab==='strategy' && 'Your pick slots + mock-calibrated targets at each window'}
        </div>
      </div>

      {/* BODY */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* SIDEBAR */}
        {sidebarOpen ? (
          <Sidebar
            diagnostics={diagnostics}
            hitWeight={hitWeight} setHitWeight={setHitWeight}
            pitCompress={pitCompress} setPitCompress={setPitCompress}
            gapSensitivity={gapSensitivity} setGapSensitivity={setGapSensitivity}
            roles={roles} round={round}
            scoredPlayers={scoredPlayers}
            onClose={() => setSidebarOpen(false)}
          />
        ) : (
          <button onClick={() => setSidebarOpen(true)}
            style={{writingMode:'vertical-rl',padding:'12px 6px',background:'var(--bg2)',
              border:'none',borderRight:'1px solid var(--border)',
              color:'var(--text3)',fontSize:11,cursor:'pointer',letterSpacing:'0.1em'}}>
            ▶ CONTROLS
          </button>
        )}

        {/* MAIN */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {tab==='board' && (
            <DraftBoard
              players={scoredPlayers}
              fullRankMap={fullRankMap}
              boardFilter={boardFilter} setBoardFilter={setBoardFilter}
              search={search} setSearch={setSearch}
              showDrafted={showDrafted} setShowDrafted={setShowDrafted}
              showKept={showKept} setShowKept={setShowKept}
              boardLimit={boardLimit} setBoardLimit={setBoardLimit}
              onDraftMe={p => { markDrafted(p,true); setSelectedPlayer(null) }}
              onDraftOther={p => { markDrafted(p,false); setSelectedPlayer(null) }}
              onUndraft={undraftPlayer}
              selectedPlayer={selectedPlayer}
              onSelectPlayer={setSelectedPlayer}
              nextPick={nextPick}
              round={round}
            />
          )}
          {tab==='team' && (
            <MyTeam myPlayers={myPlayers} myTotals={myTotals}
              targets={targets} roles={roles} onUndraft={undraftPlayer}
              keeperIds={keeperIds} onSelectPlayer={setSelectedPlayer}
            />
          )}
          {tab==='cats' && (
            <CategoryDashboard myTotals={myTotals} targets={targets} gapWeights={gapWeights} />
          )}
          {tab==='rec' && (
            <Recommendations recommendations={recommendations} round={round} roles={roles}
              onDraftMe={p => markDrafted(p,true)} onSelectPlayer={setSelectedPlayer}
            />
          )}
          {tab==='strategy' && (
            <StrategySheet round={round} myPlayers={myPlayers} draftedIds={draftedIds} scoredPlayers={scoredPlayers} />
          )}
          {tab==='pool' && (
            <FullPool players={scoredPlayers} fullRankMap={fullRankMap}
              search={poolSearch} setSearch={setPoolSearch}
              pos={poolPos} setPos={setPoolPos}
              sortKey={poolSort} setSort={setPoolSort}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
        </div>
      </div>

      {/* PLAYER PANEL */}
      {selectedPlayer && (
        <PlayerPanel
          player={selectedPlayer}
          fullRankMap={fullRankMap}
          onClose={() => setSelectedPlayer(null)}
          onDraftMe={p => { markDrafted(p,true); setSelectedPlayer(null) }}
          onDraftOther={p => { markDrafted(p,false); setSelectedPlayer(null) }}
          onUndraft={id => { undraftPlayer(id); setSelectedPlayer(null) }}
          gapWeights={gapWeights} targets={targets}
          scoredPlayers={scoredPlayers}
        />
      )}

      {/* IMPORT MODAL */}
      {showImport && (
        <ImportModal text={importText} setText={setImportText}
          msg={importMsg} setMsg={setImportMsg}
          onParse={handleImport}
          onClose={() => { setShowImport(false); setImportMsg('') }}
          myCount={myPlayers.length - myKeeperIds.length}
        />
      )}

      {/* RESET MODAL */}
      {showReset && (
        <div className="modal-overlay">
          <div className="modal-box" style={{maxWidth:360}}>
            <p style={{marginBottom:4,fontWeight:700}}>Reset Draft?</p>
            <p style={{color:'var(--text3)',fontSize:12,marginBottom:16}}>
              All picks cleared. Your keepers (Sanchez R19, Caminero R14) will be restored.
            </p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={() => setShowReset(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={resetDraft}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function Sidebar({ diagnostics, hitWeight, setHitWeight, pitCompress, setPitCompress,
                   gapSensitivity, setGapSensitivity, roles, round, scoredPlayers, onClose }) {

  const watchlistAvail = useMemo(() => {
    return WATCHLIST.map(w => {
      const p = scoredPlayers.find(sp => normName(sp.name).includes(normName(w.name).split(' ')[0]) &&
        normName(sp.name).includes(normName(w.name).split(' ').slice(-1)[0].slice(0,4)))
      return { ...w, drafted: p?.drafted ?? false, isKeeper: p?.isKeeper ?? false }
    })
  }, [scoredPlayers])

  return (
    <div style={{width:234,minWidth:234,background:'var(--bg2)',borderRight:'1px solid var(--border)',overflowY:'auto',display:'flex',flexDirection:'column',fontSize:12}}>

      <div style={{padding:'10px 12px 6px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontWeight:700,fontSize:11,letterSpacing:'0.1em',color:'var(--text2)',textTransform:'uppercase'}}>Model Controls</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:14}}>◀</button>
      </div>
      <div style={{padding:'4px 12px 6px',fontSize:10,color:'var(--text3)',borderBottom:'1px solid var(--border)'}}>
        All rankings update instantly as you adjust settings.
      </div>

      {/* Live Diagnostics */}
      <SidebarSection title="Live Diagnostics" hint="Are SPs & closers ranked high enough?">
        <DiagRow label="SP in Top 20"  val={diagnostics.spIn20}  lo={3} hi={5} />
        <DiagRow label="SP in Top 50"  val={diagnostics.spIn50}  lo={10} hi={16} />
        <DiagRow label="SP in Top 100" val={diagnostics.spIn100} lo={22} hi={30} />
        <DiagRow label="CL in Top 20"  val={diagnostics.clIn20}  lo={1} hi={3} />
        <DiagRow label="CL in Top 50"  val={diagnostics.clIn50}  lo={3} hi={6} />
        <DiagRow label="RP in Top 50"  val={diagnostics.rpIn50}  lo={5} hi={10} />
      </SidebarSection>

      {/* At Risk — targets whose window opens this round or next */}
      {(() => {
        const atRisk = watchlistAvail.filter(w => !w.drafted && w.rdLo <= round + 1 && w.rdLo >= round - 1)
        if (!atRisk.length) return null
        return (
          <div style={{background:'rgba(251,191,36,0.07)',borderBottom:'2px solid rgba(251,191,36,0.3)',padding:'6px 12px'}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--yellow)',letterSpacing:'0.1em',marginBottom:4}}>⚡ TARGET NOW</div>
            {atRisk.map(w => (
              <div key={w.name} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',fontSize:11}}>
                <span style={{color:'var(--yellow)',fontWeight:700}}>{'⭐'.repeat(w.stars)} {w.abbr}</span>
                <span style={{color:'var(--yellow)',fontSize:10}}>R{w.rdLo}{w.rdLo!==w.rdHi?`–${w.rdHi}`:''}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Watchlist */}
      <SidebarSection title="🎯 Watchlist" hint="Mock-calibrated targets with expected round windows">
        {watchlistAvail.map(w => {
          const inWindow = !w.drafted && round >= w.rdLo - 1 && round <= w.rdHi + 1
          const stars = '⭐'.repeat(w.stars)
          const color = w.drafted&&!w.isKeeper ? 'var(--text3)' : inWindow ? 'var(--yellow)' : 'var(--text2)'
          return (
            <div key={w.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'2px 0',borderBottom:'1px solid var(--border)',
              opacity:w.drafted&&!w.isKeeper?0.4:1,
              background:inWindow?'rgba(251,191,36,0.04)':undefined}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:8}}>{stars}</span>
                <span style={{color,fontSize:11,fontWeight:inWindow?700:400}}>{w.abbr}</span>
                <span style={{color:'var(--text3)',fontSize:9}}>{w.pos}</span>
              </div>
              <span style={{fontSize:10,color:w.drafted&&!w.isKeeper?'var(--text3)':color,fontWeight:inWindow?700:400}}>
                {w.drafted && !w.isKeeper ? 'GONE' : `R${w.rdLo}${w.rdLo!==w.rdHi?`–${w.rdHi}`:''}`}
              </span>
            </div>
          )
        })}
      </SidebarSection>

      {/* My Keepers */}
      <SidebarSection title="My Keepers">
        {MY_KEEPERS.map(k => (
          <div key={k.name} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:'1px solid var(--border)'}}>
            <span style={{color:'var(--text)',fontSize:11}}>{k.name}</span>
            <span style={{color:'var(--yellow)',fontSize:10,fontWeight:700}}>R{k.round}</span>
          </div>
        ))}
      </SidebarSection>

      {/* Weights */}
      <SidebarSection title="Weights" hint="Adjust scoring model. Defaults work well.">
        <SliderRow label="Hitter weight" value={hitWeight} min={30} max={75} step={1}
          display={`${hitWeight}%`} onChange={setHitWeight} />
        <div style={{fontSize:10,color:'var(--text3)',marginBottom:8}}>Pitcher weight (auto): {100-hitWeight}%</div>
        <SliderRow label="Pitcher compression" value={pitCompress} min={0.60} max={1.10} step={0.05}
          display={pitCompress.toFixed(2)} onChange={setPitCompress}
          hint="SP scale. CL ×0.68, SU/RP ×0.18" />
        <SliderRow label="Gap sensitivity" value={gapSensitivity} min={0.5} max={2.0} step={0.1}
          display={gapSensitivity.toFixed(1)} onChange={setGapSensitivity}
          hint="How strongly gaps shift rankings" />
        <button className="btn btn-ghost btn-sm" style={{width:'100%',marginTop:4,fontSize:10}}
          onClick={() => { setHitWeight(50); setPitCompress(0.85); setGapSensitivity(1.0) }}>
          Reset to defaults
        </button>
      </SidebarSection>

      {/* Pitcher Roles */}
      <SidebarSection title="Pitcher Roles" hint="Stream hold specialists on waivers">
        {[
          {label:'Win Contributors',cur:roles.winContributors,target:7},
          {label:'Closers (S)',      cur:roles.closers,        target:3},
          {label:'Hold Spec (HD)',   cur:roles.holdSpec,       target:2},
        ].map(r => {
          const color = r.cur>=r.target?'var(--green)':r.cur>=r.target-1?'var(--yellow)':'var(--red)'
          return (
            <div key={r.label} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:'1px solid var(--border)'}}>
              <span style={{color:'var(--text2)'}}>{r.label}</span>
              <span style={{color,fontWeight:700}}>{r.cur}/{r.target}</span>
            </div>
          )
        })}
      </SidebarSection>

      <div style={{padding:'8px 12px',fontSize:10,color:'var(--text3)',marginTop:'auto',borderTop:'1px solid var(--border)'}}>
        z-score → H/P weights → gap weights → ADP penalty → tier detection
      </div>
    </div>
  )
}

function SidebarSection({ title, hint, children }) {
  return (
    <div style={{borderBottom:'1px solid var(--border)'}}>
      <div style={{padding:'7px 12px 2px',fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)'}}>{title}</div>
      {hint && <div style={{padding:'0 12px 3px',fontSize:9,color:'var(--text3)',fontStyle:'italic'}}>{hint}</div>}
      <div style={{padding:'2px 12px 8px'}}>{children}</div>
    </div>
  )
}

function DiagRow({ label, val, lo, hi }) {
  const ok = val>=lo && val<=hi
  const color = ok ? 'var(--green)' : 'var(--yellow)'
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'2px 0',borderBottom:'1px solid var(--border)'}}>
      <span style={{color:'var(--text2)',fontSize:11}}>{label}</span>
      <div style={{display:'flex',alignItems:'center',gap:5}}>
        <span style={{color,fontWeight:700,fontSize:12}}>{val}</span>
        <span style={{color:'var(--text3)',fontSize:10}}>/{hi}</span>
        <span style={{color,fontSize:11}}>{ok?'✓':'~'}</span>
      </div>
    </div>
  )
}

function SliderRow({ label, value, min, max, step, display, onChange, hint }) {
  return (
    <div style={{marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <span style={{color:'var(--text2)',fontSize:11}}>{label}</span>
        <span style={{color:'var(--blue2)',fontWeight:700,fontSize:11}}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step<1?parseFloat(e.target.value):parseInt(e.target.value))}
        style={{width:'100%',accentColor:'var(--blue)',cursor:'pointer'}} />
      <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--text3)'}}>
        <span>{min}</span><span>{max}</span>
      </div>
      {hint && <div style={{fontSize:10,color:'var(--text3)',marginTop:1}}>{hint}</div>}
    </div>
  )
}

// ── DRAFT BOARD ───────────────────────────────────────────────────────────────
const POS_FILTERS = ['ALL','⭐','H','P','C','1B','2B','3B','SS','OF','SP','RP','CL']

function DraftBoard({ players, fullRankMap, boardFilter, setBoardFilter, search, setSearch,
  showDrafted, setShowDrafted, showKept, setShowKept, boardLimit, setBoardLimit,
  onDraftMe, onDraftOther, onUndraft, selectedPlayer, onSelectPlayer, nextPick, round }) {

  const filtered = useMemo(() => {
    let p = [...players]
    if (!showKept)    p = p.filter(x => !x.isKeeper)
    if (!showDrafted) p = p.filter(x => !x.drafted || x.isKeeper)
    if (boardFilter === '⭐') p = p.filter(x => x.isWatchlist)
    else if (boardFilter === 'H') p = p.filter(x => x.type==='hitter')
    else if (boardFilter === 'P') p = p.filter(x => x.type==='pitcher')
    else if (boardFilter !== 'ALL') p = p.filter(x => x.pos===boardFilter)
    if (search) { const q=search.toLowerCase(); p = p.filter(x => x.name.toLowerCase().includes(q)||x.team.toLowerCase().includes(q)) }
    p.sort((a,b) => {
      if (a.isKeeper!==b.isKeeper) return a.isKeeper?1:-1
      return (b.liveScore??-99)-(a.liveScore??-99)
    })
    return p.slice(0, boardLimit)
  }, [players, showKept, showDrafted, boardFilter, search, boardLimit])

  const topScore = players.find(p => !p.drafted&&!p.isKeeper)?.liveScore ?? 1

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      {/* Legend bar */}
      <div style={{padding:'3px 12px',background:'var(--bg)',borderBottom:'1px solid var(--border)',fontSize:10,color:'var(--text3)',display:'flex',gap:16,flexWrap:'wrap'}}>
        <span><b style={{color:'var(--text2)'}}>Score</b> = z-score × gap weight</span>
        <span><b style={{color:'var(--green)'}}>M</b> = mine &nbsp;·&nbsp; <b style={{color:'var(--text2)'}}>D</b> = other team</span>
        <span><b style={{color:'var(--yellow)'}}>K·R#</b> = keeper round</span>
        <span><b style={{color:'var(--blue2)'}}>⭐</b> = watchlist target</span>
        <span>Edge = our rank vs CBS ADP</span>
      </div>

      {/* Filter bar */}
      <div style={{padding:'6px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search player or team…" style={{width:160}} />
        <div style={{display:'flex',gap:2,flexWrap:'wrap'}}>
          {POS_FILTERS.map(f => (
            <button key={f}
              className={`btn btn-sm ${boardFilter===f?'btn-primary':'btn-ghost'}`}
              style={{minWidth:f==='⭐'?28:32,padding:'3px 5px',fontSize:f==='⭐'?13:11}}
              onClick={() => setBoardFilter(f)}>{f}</button>
          ))}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center',fontSize:11,color:'var(--text2)'}}>
          <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
            <input type="checkbox" checked={showKept} onChange={e=>setShowKept(e.target.checked)} /> Keepers
          </label>
          <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
            <input type="checkbox" checked={showDrafted} onChange={e=>setShowDrafted(e.target.checked)} /> Drafted
          </label>
          <span style={{color:'var(--text3)'}}>{filtered.length} shown</span>
        </div>
      </div>

      <div style={{flex:1,overflow:'auto'}}>
        <table>
          <thead>
            <tr>
              <th style={{width:38}}>#</th>
              <th style={{width:24}}>T</th>
              <th style={{minWidth:160}}>Player</th>
              <th>Pos</th><th>Team</th>
              <th>Score</th>
              <th style={{width:36}}>Tier</th>
              <th style={{width:50}}>CBS</th>
              <th style={{width:46}}>Edge</th>
              <th>R</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th><th>OBP</th>
              <th>W</th><th>S</th><th>HD</th><th>K</th><th>ERA</th><th>WHIP</th>
              <th style={{width:68}}>M / D</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const isH   = p.type==='hitter'
              const myRnk = fullRankMap.get(p.id)
              const edge  = p.cbsADP && myRnk ? Math.round(myRnk - p.cbsADP) : null
              const barW  = p.isKeeper ? 0 : Math.max(0,Math.min(100,(p.liveScore/topScore)*100))
              const isSelected = selectedPlayer?.id === p.id
              const wInfo = p.watchlistInfo

              return (
                <tr key={p.id}
                  onClick={() => onSelectPlayer(p)}
                  style={{
                    ...(p.isKeeper?{opacity:0.42}:p.drafted?{opacity:0.35}:{}),
                    cursor:'pointer',
                    background: isSelected ? 'rgba(59,130,246,0.1)' : undefined,
                    outline: isSelected ? '1px solid var(--blue)' : 'none',
                  }}
                  className={`${p.isMine&&!p.isKeeper?'mine':''} ${p.tierBreak&&!p.isKeeper?'tier-break':''}`}
                >
                  <td style={{color:'var(--text3)',fontSize:11}}>
                    {p.isKeeper
                      ? <span style={{fontSize:9,color:'var(--yellow)',fontWeight:700}}>K·R{p.keeperInfo?.round}</span>
                      : myRnk}
                  </td>

                  <td>
                    <span style={{fontSize:10,fontWeight:700,
                      color:isH?'var(--green)':p.pos==='CL'?'var(--purple)':'var(--blue2)'}}>
                      {isH?'H':p.pos==='CL'?'CL':'P'}
                    </span>
                  </td>

                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      {wInfo && <span style={{fontSize:9,color:'var(--tier1)'}} title={wInfo.note}>{'⭐'.repeat(wInfo.stars)}</span>}
                      <span style={{fontWeight:p.isMine?700:400}}>{p.name}</span>
                      {p.isMyKeeper && <span style={{fontSize:9,color:'var(--yellow)',fontWeight:700,background:'rgba(251,191,36,0.12)',padding:'1px 4px',borderRadius:2}}>KEPT R{p.keeperInfo?.round}</span>}
                      {p.isKeeper&&!p.isMyKeeper && <span style={{fontSize:9,color:'var(--text3)',background:'rgba(255,255,255,0.05)',padding:'1px 4px',borderRadius:2}}>KEPT</span>}
                      {p.isMine&&!p.isKeeper && <span style={{fontSize:9,color:'var(--blue)',background:'rgba(59,130,246,0.12)',padding:'1px 4px',borderRadius:2}}>MINE</span>}
                    </div>
                  </td>

                  <td><span style={{color:posColor(p.pos),fontWeight:600,fontSize:12}}>{p.pos}</span></td>
                  <td style={{color:'var(--text3)'}}>{p.team}</td>

                  <td>
                    {!p.isKeeper && (
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <div style={{width:40,height:4,background:'var(--bg3)',borderRadius:2}}>
                          <div style={{height:'100%',borderRadius:2,background:tierColor(p.tier),width:`${barW}%`}} />
                        </div>
                        <span style={{fontSize:11,color:'var(--text2)',minWidth:26}}>{p.liveScore?.toFixed(1)}</span>
                      </div>
                    )}
                  </td>

                  <td>{!p.isKeeper && <span style={{color:tierColor(p.tier),fontSize:11,fontWeight:700}}>T{p.tier}</span>}</td>

                  <td style={{color:'var(--text3)',fontSize:11}}>{p.cbsADP?p.cbsADP.toFixed(1):'—'}</td>

                  <td style={{fontSize:11,fontWeight:edge!=null&&Math.abs(edge)>5?700:400,
                    color:edge==null?'var(--text3)':edge>5?'var(--green)':edge<-5?'var(--red)':'var(--text3)'}}>
                    {edge!=null?(edge>0?`+${edge}`:edge):'—'}
                  </td>

                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?Math.round(p.R||0):'—'}</td>
                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?Math.round(p.H||0):'—'}</td>
                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?Math.round(p.HR||0):'—'}</td>
                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?Math.round(p.RBI||0):'—'}</td>
                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?Math.round(p.SB||0):'—'}</td>
                  <td style={{color:isH?'var(--text)':'var(--text3)'}}>{isH?(p.OBP||0).toFixed(3):'—'}</td>
                  <td style={{color:!isH?'var(--text)'  :'var(--text3)'}}>{!isH?Math.round(p.W||0)  :'—'}</td>
                  <td style={{color:!isH?'var(--purple)':'var(--text3)'}}>{!isH?Math.round(p.SV||0) :'—'}</td>
                  <td style={{color:!isH?'var(--blue2)' :'var(--text3)'}}>{!isH?Math.round(p.HLD||0):'—'}</td>
                  <td style={{color:!isH?'var(--text)'  :'var(--text3)'}}>{!isH?Math.round(p.SO||0) :'—'}</td>
                  <td style={{color:!isH?'var(--text)'  :'var(--text3)'}}>{!isH?(p.ERA||0).toFixed(2) :'—'}</td>
                  <td style={{color:!isH?'var(--text)'  :'var(--text3)'}}>{!isH?(p.WHIP||0).toFixed(3):'—'}</td>

                  <td onClick={e => e.stopPropagation()}>
                    {p.isKeeper ? (
                      <span style={{fontSize:10,color:'var(--yellow)'}}>KEPT</span>
                    ) : p.drafted ? (
                      <button className="btn btn-sm btn-ghost" style={{fontSize:10,padding:'2px 6px'}}
                        onClick={() => onUndraft(p.id)}>Undo</button>
                    ) : (
                      <div style={{display:'flex',gap:3}}>
                        <button className="btn btn-sm btn-primary" style={{padding:'2px 8px'}}
                          onClick={() => onDraftMe(p)} title="Draft to my team">M</button>
                        <button className="btn btn-sm btn-ghost" style={{padding:'2px 8px',color:'var(--text3)'}}
                          onClick={() => onDraftOther(p)} title="Drafted by other team">D</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {boardLimit < players.length && (
          <div style={{padding:12,textAlign:'center'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => setBoardLimit(b=>b+100)}>Show more</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MY TEAM ───────────────────────────────────────────────────────────────────
function MyTeam({ myPlayers, myTotals, targets, roles, onUndraft, keeperIds, onSelectPlayer }) {
  const slotted = useMemo(() => {
    const unassigned = [...myPlayers]
    const assigned = {}
    for (const slot of SLOTS.filter(s => !['UTIL','P','BN'].includes(s.label))) {
      const idx = unassigned.findIndex(p => slot.elig.includes(p.pos))
      if (idx>=0) assigned[slot.id] = unassigned.splice(idx,1)[0]
    }
    for (const slot of SLOTS.filter(s => s.label==='UTIL')) {
      const idx = unassigned.findIndex(p => slot.elig.includes(p.pos))
      if (idx>=0) assigned[slot.id] = unassigned.splice(idx,1)[0]
    }
    for (const slot of SLOTS.filter(s => s.label==='P')) {
      const idx = unassigned.findIndex(p => slot.elig.includes(p.pos))
      if (idx>=0) assigned[slot.id] = unassigned.splice(idx,1)[0]
    }
    for (const slot of SLOTS.filter(s => s.label==='BN')) {
      if (unassigned.length) assigned[slot.id] = unassigned.shift()
    }
    return assigned
  }, [myPlayers])

  let lastGroup = null
  const GROUPS = {hitters:'Hitters (C/1B/2B/3B/SS/OF/UTIL)',pitchers:'Pitchers (SP/RP/P)',bench:'Bench'}
  const slotGroups = {C:'hitters','1B':'hitters','2B':'hitters','3B':'hitters',SS:'hitters',OF1:'hitters',OF2:'hitters',OF3:'hitters',OF4:'hitters',UT1:'hitters',UT2:'hitters',UT3:'hitters',SP1:'pitchers',SP2:'pitchers',SP3:'pitchers',SP4:'pitchers',RP1:'pitchers',RP2:'pitchers',RP3:'pitchers',P1:'pitchers',P2:'pitchers',BN1:'bench',BN2:'bench',BN3:'bench'}

  return (
    <div style={{padding:12,display:'grid',gap:12,gridTemplateColumns:'1fr 1fr',overflow:'auto'}}>
      <div>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>My Roster — {myPlayers.length}/24</div>
        {SLOTS.map(slot => {
          const player = slotted[slot.id]
          const isK = player ? keeperIds.has(player.id) : false
          const group = slotGroups[slot.id]
          const showHeader = group !== lastGroup
          lastGroup = group
          return (
            <div key={slot.id}>
              {showHeader && (
                <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',
                  color:'var(--text3)',padding:'8px 0 3px',marginTop:group==='hitters'?0:4,
                  borderTop:group==='hitters'?'none':'1px solid var(--border)'}}>
                  {GROUPS[group]}
                </div>
              )}
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'3px 0',borderBottom:'1px solid var(--border)',minHeight:28,
                background:isK?'rgba(251,191,36,0.03)':'transparent',
                cursor:player?'pointer':'default'}}
                onClick={() => player && onSelectPlayer(player)}>
                <span style={{fontSize:10,fontWeight:700,color:'var(--text3)',minWidth:32,textAlign:'right',paddingRight:4,borderRight:'1px solid var(--border)',marginRight:4}}>{slot.label}</span>
                {player ? (
                  <>
                    <span style={{color:posColor(player.pos),fontWeight:700,fontSize:11,minWidth:26}}>{player.pos}</span>
                    <span style={{flex:1,fontSize:12,fontWeight:isK?600:400}}>{player.name}</span>
                    {isK && <span style={{fontSize:9,color:'var(--yellow)',fontWeight:700,background:'rgba(251,191,36,0.12)',padding:'1px 4px',borderRadius:2}}>KEPT</span>}
                    <span style={{fontSize:10,color:'var(--text3)',minWidth:28,textAlign:'right'}}>{player.team}</span>
                    {!isK && <button className="btn btn-sm btn-ghost" style={{fontSize:9,padding:'1px 4px'}} onClick={e=>{e.stopPropagation();onUndraft(player.id)}}>✕</button>}
                  </>
                ) : (
                  <span style={{color:'var(--text3)',fontSize:11,fontStyle:'italic'}}>— empty —</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:11,marginBottom:10,color:'var(--text2)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Category Progress</div>
          {ALL_CATS.map(cat => {
            const t=targets[cat]?.third; const cur=myTotals[cat]??0; const isNeg=NEG_CATS.has(cat)
            const {pct,status}=catProgress(cur,t,isNeg)
            const bc=status==='ok'?'var(--green)':status==='warn'?'var(--yellow)':'var(--red)'
            const fmt=v=>v==null?'—':isNeg?v.toFixed(2):cat==='OBP'?v.toFixed(3):Math.round(v)
            return (
              <div key={cat} style={{marginBottom:7}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}>
                  <span style={{color:'var(--text2)',fontWeight:600}}>{cat}</span>
                  <span style={{color:bc}}>{fmt(cur)}<span style={{color:'var(--text3)'}}> / {fmt(t)}</span></span>
                </div>
                <div className="progress-bar">
                  <div className={`progress-fill progress-${status==='ok'?'green':status==='warn'?'yellow':'red'}`} style={{width:`${Math.round(pct*100)}%`}} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="card">
          <div style={{fontWeight:700,fontSize:11,marginBottom:10,color:'var(--text2)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Pitcher Roles</div>
          {[
            {label:'Win Contributors',cur:roles.winContributors,target:7,hint:'W≥5 or IP≥100'},
            {label:'Closers (S)',      cur:roles.closers,        target:3,hint:'SV≥8'},
            {label:'Hold Spec (HD)',   cur:roles.holdSpec,       target:2,hint:'Stream on waivers'},
          ].map(r => {
            const color=r.cur>=r.target?'var(--green)':r.cur>=r.target-1?'var(--yellow)':'var(--red)'
            return (
              <div key={r.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div>
                  <div style={{fontSize:12}}>{r.label}</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{r.hint}</div>
                </div>
                <span style={{color,fontWeight:700,fontSize:15}}>{r.cur}/{r.target}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── CATEGORY DASHBOARD ────────────────────────────────────────────────────────
function CategoryDashboard({ myTotals, targets, gapWeights }) {
  const sorted = [...ALL_CATS].sort((a,b)=>(gapWeights[b]??1)-(gapWeights[a]??1))
  return (
    <div style={{padding:12,overflow:'auto'}}>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>📊 Category Dashboard
          <span style={{fontSize:11,fontWeight:400,color:'var(--text3)',marginLeft:8}}>sorted by urgency · updates live</span>
        </div>
        <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:16,flexWrap:'wrap'}}>
          <span><b style={{color:'var(--red)'}}>HIGH</b> = biggest gap · weighted most in rankings</span>
          <span><b style={{color:'var(--yellow)'}}>MED</b> = approaching target</span>
          <span><b style={{color:'var(--green)'}}>OK</b> = on pace for 3rd or better</span>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(255px,1fr))',gap:10}}>
        {sorted.map(cat => {
          const t=targets[cat]; const cur=myTotals[cat]??0; const isNeg=NEG_CATS.has(cat)
          const {pct,status}=catProgress(cur,t?.third,isNeg)
          const w=gapWeights[cat]??1
          const urgency=w>=1.8?'HIGH':w>=1.2?'MED':'OK'
          const uc=urgency==='HIGH'?'var(--red)':urgency==='MED'?'var(--yellow)':'var(--green)'
          const bc=status==='ok'?'var(--green)':status==='warn'?'var(--yellow)':'var(--red)'
          const fmt=v=>v==null?'—':isNeg?v.toFixed(2):cat==='OBP'?v.toFixed(3):Math.round(v)
          return (
            <div key={cat} className="card" style={{borderLeft:`3px solid ${bc}`}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontWeight:700,fontSize:14}}>{cat}</span>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:10,color:uc,fontWeight:700,background:`${uc}22`,padding:'1px 5px',borderRadius:3}}>{urgency}</span>
                  <span style={{fontSize:10,color:'var(--text3)'}}>wt {w.toFixed(2)}</span>
                </div>
              </div>
              <div className="progress-bar" style={{height:8,marginBottom:8}}>
                <div style={{height:'100%',borderRadius:3,background:bc,width:`${Math.round(pct*100)}%`,transition:'width 0.4s'}} />
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,fontSize:11}}>
                {[['Current',fmt(cur),bc],['3rd',fmt(t?.third),'var(--text2)'],['2nd',fmt(t?.second),'var(--text2)'],['1st',fmt(t?.first),'var(--text2)']].map(([lbl,val,clr])=>(
                  <div key={lbl}>
                    <div style={{color:'var(--text3)',fontSize:10,marginBottom:2}}>{lbl}</div>
                    <div style={{color:clr,fontWeight:lbl==='Current'?700:400}}>{val}</div>
                  </div>
                ))}
              </div>
              {t?.third && (
                <div style={{marginTop:6,fontSize:10,color:'var(--text3)'}}>
                  {isNeg ? cur===0?'No pitchers yet':cur>t.third?`↓ Need -${(cur-t.third).toFixed(2)}`:'✓ On track'
                         : cur>=t.third?'✓ Target reached':`Need +${fmt(t.third-cur)} more`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── RECOMMENDATIONS ───────────────────────────────────────────────────────────
function Recommendations({ recommendations, round, roles, onDraftMe, onSelectPlayer }) {
  return (
    <div style={{padding:12,overflow:'auto'}}>
      <div style={{marginBottom:12}}>
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
          <span style={{fontSize:13,fontWeight:700}}>⚡ Best Picks Right Now</span>
          <span style={{fontSize:11,color:'var(--text3)'}}>Next: Round {round} · Weighted by category gaps</span>
        </div>
        <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:16,flexWrap:'wrap'}}>
          <span>Rankings = z-score × gap weight. Players filling biggest needs rise to the top.</span>
          <span><b style={{color:'var(--orange)'}}>Role bonus</b> = pitcher role urgency boost.</span>
          <span><b style={{color:'var(--green)'}}>+% value</b> = our rank beats CBS ADP.</span>
        </div>
      </div>
      {roles.closers < 3 && round > 6 && (
        <div className="alert alert-warn" style={{marginBottom:8}}>⚠ Only {roles.closers}/3 closers drafted — Saves are scarce past round 9.</div>
      )}
      {roles.winContributors < 4 && round > 8 && (
        <div className="alert alert-warn" style={{marginBottom:8}}>⚠ Only {roles.winContributors}/7 win contributors — Wins (W) category at risk.</div>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {recommendations.map((p,i) => (
          <div key={p.id} className={`rec-card ${i===0?'top':''}`}
            style={{display:'flex',gap:12,alignItems:'flex-start',cursor:'pointer'}}
            onClick={() => onSelectPlayer(p)}>
            <div style={{minWidth:24,fontSize:18,fontWeight:700,color:i===0?'var(--tier1)':'var(--text3)',paddingTop:2}}>{i+1}</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                <span style={{fontWeight:700,fontSize:14}}>{p.name}</span>
                <span style={{color:posColor(p.pos),fontWeight:700,fontSize:12}}>{p.pos}</span>
                <span style={{color:'var(--text3)',fontSize:11}}>{p.team}</span>
                {p.urgencyBoost>0 && <span style={{fontSize:10,color:'var(--orange)',background:'rgba(249,115,22,0.15)',padding:'1px 5px',borderRadius:3}}>+{p.urgencyBoost.toFixed(1)} role</span>}
                {p.adpBoost>0 && <span style={{fontSize:10,color:'var(--green)',background:'rgba(34,197,94,0.12)',padding:'1px 5px',borderRadius:3,border:'1px solid rgba(34,197,94,0.25)'}}>+{(p.adpBoostPct*100).toFixed(0)}% value</span>}
                {p.isWatchlist && <span style={{fontSize:10,color:'var(--tier1)'}}>⭐</span>}
              </div>
              <div style={{display:'flex',gap:10,fontSize:11,color:'var(--text2)',marginBottom:4,flexWrap:'wrap'}}>
                <span>Score: <b style={{color:'var(--blue2)'}}>{p.liveScore.toFixed(2)}</b></span>
                {p.type==='hitter'
                  ? <><span>R:{Math.round(p.R||0)}</span><span>HR:{Math.round(p.HR||0)}</span><span>RBI:{Math.round(p.RBI||0)}</span><span>SB:{Math.round(p.SB||0)}</span><span>OBP:{(p.OBP||0).toFixed(3)}</span></>
                  : <><span>W:{Math.round(p.W||0)}</span><span>SV:{Math.round(p.SV||0)}</span><span>HLD:{Math.round(p.HLD||0)}</span><span>K:{Math.round(p.SO||0)}</span><span>ERA:{(p.ERA||0).toFixed(2)}</span><span>WHIP:{(p.WHIP||0).toFixed(3)}</span></>
                }
              </div>
              {p.reasons?.map((r,ri) => (
                <div key={ri} style={{fontSize:11,color:ri===0?'var(--text)':'var(--text3)'}}>{ri===0?'→':'·'} {r}</div>
              ))}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end',flexShrink:0}}
              onClick={e=>e.stopPropagation()}>
              <button className="btn btn-primary btn-sm" onClick={() => onDraftMe(p)}>Draft</button>
              {p.cbsADP && <span style={{fontSize:10,color:'var(--text3)'}}>CBS {p.cbsADP.toFixed(1)}</span>}
            </div>
          </div>
        ))}
        {recommendations.length===0 && <div style={{color:'var(--text3)',padding:20,textAlign:'center'}}>No available players.</div>}
      </div>
    </div>
  )
}

// ── FULL POOL ─────────────────────────────────────────────────────────────────
function FullPool({ players, fullRankMap, search, setSearch, pos, setPos, sortKey, setSort, onSelectPlayer }) {
  const positions = ['ALL','C','1B','2B','3B','SS','OF','SP','RP','CL','SU']
  const sortOpts = [{v:'liveScore',label:'Score'},{v:'FPTS',label:'FPTS'},{v:'cbsADP',label:'CBS ADP'},{v:'WAR',label:'WAR'},{v:'HR',label:'HR'},{v:'SB',label:'SB'},{v:'W',label:'W'},{v:'SV',label:'SV'}]
  const filtered = useMemo(() => {
    let p=players
    if (pos!=='ALL') p=p.filter(x=>x.pos===pos)
    if (search) { const q=search.toLowerCase(); p=p.filter(x=>x.name.toLowerCase().includes(q)||x.team.toLowerCase().includes(q)) }
    const neg=['cbsADP','ERA','WHIP'].includes(sortKey)
    return [...p].sort((a,b)=>{const av=a[sortKey]??(neg?999:-999),bv=b[sortKey]??(neg?999:-999);return neg?av-bv:bv-av})
  }, [players,pos,search,sortKey])

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div style={{padding:'7px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{width:160}} />
        <select value={pos} onChange={e=>setPos(e.target.value)}>{positions.map(p=><option key={p} value={p}>{p}</option>)}</select>
        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
          {sortOpts.map(s=><button key={s.v} className={`btn btn-sm ${sortKey===s.v?'btn-primary':'btn-ghost'}`} onClick={()=>setSort(s.v)}>{s.label}</button>)}
        </div>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--text3)'}}>{filtered.length} players</span>
      </div>
      <div style={{flex:1,overflow:'auto'}}>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Pos</th><th>Team</th><th>Score</th><th>FPTS</th>
              <th>CBS</th><th>Edge</th><th>WAR</th><th>R</th><th>H</th><th>HR</th><th>RBI</th>
              <th>SB</th><th>OBP</th><th>W</th><th>SV</th><th>HLD</th><th>K</th><th>ERA</th><th>WHIP</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const myRnk = fullRankMap.get(p.id)
              const edge  = p.cbsADP && myRnk ? Math.round(myRnk-p.cbsADP) : null
              return (
                <tr key={p.id} className={p.isMine?'mine':''}
                  style={{...(p.isKeeper?{opacity:0.5}:p.drafted?{opacity:0.38}:{}),cursor:'pointer',
                    background:p.isWatchlist&&!p.drafted?'rgba(251,191,36,0.03)':undefined}}
                  onClick={()=>onSelectPlayer(p)}>
                  <td style={{color:'var(--text3)',fontSize:11}}>{myRnk??'—'}</td>
                  <td style={{fontWeight:p.isMine?700:400}}>
                    {p.isWatchlist && <span style={{marginRight:4,fontSize:9}}>⭐</span>}
                    {p.name}
                    {p.isMyKeeper && <span style={{marginLeft:4,fontSize:9,color:'var(--yellow)',fontWeight:700}}>KEPT</span>}
                  </td>
                  <td><span style={{color:posColor(p.pos),fontWeight:600}}>{p.pos}</span></td>
                  <td style={{color:'var(--text3)'}}>{p.team}</td>
                  <td style={{color:'var(--blue2)'}}>{p.isKeeper?'—':p.liveScore?.toFixed(1)}</td>
                  <td>{p.FPTS?Math.round(p.FPTS):'—'}</td>
                  <td>{p.cbsADP?.toFixed(1)??'—'}</td>
                  <td style={{fontSize:11,color:edge==null?'var(--text3)':edge>5?'var(--green)':edge<-5?'var(--red)':'var(--text3)'}}>{edge!=null?(edge>0?`+${edge}`:edge):'—'}</td>
                  <td style={{color:'var(--text2)'}}>{p.WAR?.toFixed(1)??'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.R||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.H||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.HR||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.RBI||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.SB||0):'—'}</td>
                  <td>{p.type==='hitter'?(p.OBP||0).toFixed(3):'—'}</td>
                  <td style={{color:p.type==='pitcher'?'var(--text)':'var(--text3)'}}>{p.type==='pitcher'?Math.round(p.W||0):'—'}</td>
                  <td style={{color:p.type==='pitcher'?'var(--purple)':'var(--text3)'}}>{p.type==='pitcher'?Math.round(p.SV||0):'—'}</td>
                  <td style={{color:p.type==='pitcher'?'var(--blue2)':'var(--text3)'}}>{p.type==='pitcher'?Math.round(p.HLD||0):'—'}</td>
                  <td>{p.type==='pitcher'?Math.round(p.SO||0):'—'}</td>
                  <td>{p.type==='pitcher'?(p.ERA||0).toFixed(2):'—'}</td>
                  <td>{p.type==='pitcher'?(p.WHIP||0).toFixed(3):'—'}</td>
                  <td>
                    {p.isKeeper?<span style={{color:'var(--yellow)',fontSize:10}}>{p.isMyKeeper?'MY KEEP':'KEPT'}</span>
                      :p.drafted?<span style={{color:p.isMine?'var(--blue2)':'var(--text3)',fontSize:10}}>{p.isMine?'MINE':'GONE'}</span>
                      :<span style={{color:'var(--green)',fontSize:10}}>AVAIL</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── PLAYER PANEL ──────────────────────────────────────────────────────────────
function PlayerPanel({ player, fullRankMap, onClose, onDraftMe, onDraftOther, onUndraft, gapWeights, targets, scoredPlayers }) {
  const isH   = player.type==='hitter'
  const kInfo = KEEPERS.find(k => matchKeeperToPlayer(k.name,[player])?.id===player.id)
  const wInfo = player.watchlistInfo
  const myRnk = fullRankMap.get(player.id)
  const edge  = player.cbsADP && myRnk ? Math.round(myRnk-player.cbsADP) : null
  const cats  = isH ? ['R','H','HR','RBI','SB','OBP'] : ['W','S','HD','K','ERA','WHIP']
  const bd    = player.liveBreakdown ?? {}

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:40}} />
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:320,background:'var(--bg2)',
        borderLeft:'1px solid var(--border2)',zIndex:50,display:'flex',flexDirection:'column',
        boxShadow:'-8px 0 32px rgba(0,0,0,0.4)'}}>

        {/* Header */}
        <div style={{padding:'14px 16px 10px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:3,
                  background:isH?'rgba(34,197,94,0.15)':'rgba(59,130,246,0.15)',
                  color:isH?'var(--green)':'var(--blue2)',
                  border:`1px solid ${isH?'rgba(34,197,94,0.3)':'rgba(59,130,246,0.3)'}`}}>
                  {isH?'HITTER':player.pos==='CL'?'CLOSER':player.pos==='SP'?'STARTER':'RELIEVER'}
                </span>
                {kInfo && <span style={{fontSize:10,fontWeight:700,color:'var(--yellow)',background:'rgba(251,191,36,0.12)',padding:'2px 6px',borderRadius:3}}>KEPT R{kInfo.round} · {kInfo.team}</span>}
                {wInfo && <span style={{fontSize:10,color:'var(--tier1)'}} title={wInfo.note}>{'⭐'.repeat(wInfo.stars)} R{wInfo.rdLo}{wInfo.rdLo!==wInfo.rdHi?`–${wInfo.rdHi}`:''}</span>}
              </div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--text)',lineHeight:1.2}}>{player.name}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
                <span style={{color:posColor(player.pos),fontWeight:700}}>{player.pos}</span>{' · '}{player.team}
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text3)',fontSize:18,cursor:'pointer',padding:'0 4px'}}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:14}}>

          {/* Rank / Score / Tier */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <StatBox label="Board Rank" value={myRnk?`#${myRnk}`:kInfo?'KEPT':'—'} color={myRnk&&myRnk<=20?'var(--tier1)':myRnk&&myRnk<=50?'var(--tier2)':'var(--text)'} />
            <StatBox label="Score" value={player.liveScore?.toFixed(2)??'—'} color="var(--blue2)" />
            <StatBox label="Tier" value={player.tier?`T${player.tier}`:'—'} color={tierColor(player.tier??5)} />
          </div>

          {/* CBS ADP + Edge */}
          {(player.cbsADP || edge!=null) && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <StatBox label="CBS ADP" value={player.cbsADP?.toFixed(1)??'—'} color="var(--text2)" />
              <StatBox label="Edge vs CBS"
                value={edge!=null?(edge>0?`+${edge}`:String(edge)):'—'}
                color={edge==null?'var(--text3)':edge>5?'var(--green)':edge<-5?'var(--red)':'var(--text2)'}
                hint={edge>5?'Value pick':edge<-5?'Market ranks later':'Near consensus'} />
            </div>
          )}

          {/* Watchlist note */}
          {wInfo && (
            <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:4,padding:'8px 10px',fontSize:11,color:'var(--text2)'}}>
              <div style={{fontWeight:700,color:'var(--tier1)',marginBottom:2}}>{'⭐'.repeat(wInfo.stars)} Watchlist Target — R{wInfo.rdLo}{wInfo.rdLo!==wInfo.rdHi?`–${wInfo.rdHi}`:''}</div>
              {wInfo.note}
            </div>
          )}

          {/* Score Breakdown */}
          <div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:8}}>Score Breakdown</div>
            {cats.map(cat => {
              const b=bd[cat]??{}; const z=b.z??0; const w=b.w??(gapWeights[cat]??1); const contrib=b.contribution??(z*w)
              const barMax=4; const barW=Math.min(100,Math.abs(contrib)/barMax*100); const isPos=contrib>=0
              return (
                <div key={cat} style={{marginBottom:7}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}>
                    <span style={{color:'var(--text2)',fontWeight:600}}>{cat}</span>
                    <div style={{display:'flex',gap:10,color:'var(--text3)',fontSize:10}}>
                      <span>z={z.toFixed(2)}</span><span>wt={w.toFixed(2)}</span>
                      <span style={{color:isPos?'var(--green)':'var(--red)',fontWeight:700}}>{isPos?'+':''}{contrib.toFixed(2)}</span>
                    </div>
                  </div>
                  <div style={{height:4,background:'var(--bg3)',borderRadius:2}}>
                    <div style={{height:'100%',borderRadius:2,width:`${barW}%`,background:isPos?'var(--green)':'var(--red)',marginLeft:isPos?0:`${100-barW}%`}} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Projected Stats */}
          <div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text3)',marginBottom:8}}>Projected Stats</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              {(isH ? [['Runs (R)',Math.round(player.R??0)],['Hits (H)',Math.round(player.H??0)],['Home Runs',Math.round(player.HR??0)],['RBI',Math.round(player.RBI??0)],['Steals (SB)',Math.round(player.SB??0)],['OBP',(player.OBP??0).toFixed(3)],['PA',Math.round(player.PA??0)],['WAR',(player.WAR??0).toFixed(1)]]
                     : [['Wins (W)',Math.round(player.W??0)],['Saves (SV)',Math.round(player.SV??0)],['Holds (HLD)',Math.round(player.HLD??0)],['Strikeouts',Math.round(player.SO??0)],['ERA',(player.ERA??0).toFixed(2)],['WHIP',(player.WHIP??0).toFixed(3)],['IP',Math.round(player.IP??0)],['WAR',(player.WAR??0).toFixed(1)]])
              .map(([lbl,val]) => (
                <div key={lbl} style={{background:'var(--bg3)',borderRadius:4,padding:'6px 10px'}}>
                  <div style={{fontSize:10,color:'var(--text3)',marginBottom:2}}>{lbl}</div>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',flexDirection:'column',gap:8}}>
          {player.isKeeper ? (
            <div style={{textAlign:'center',color:'var(--yellow)',fontSize:12,fontWeight:700,padding:'8px 0'}}>🔒 Keeper — already on roster</div>
          ) : player.drafted ? (
            <>
              <div style={{textAlign:'center',fontSize:12,color:'var(--text3)',marginBottom:4}}>{player.isMine?'On your roster':'Drafted by another team'}</div>
              <button className="btn btn-ghost" style={{width:'100%',justifyContent:'center'}} onClick={() => onUndraft(player.id)}>↩ Undo Draft</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:'9px 0',fontSize:13}} onClick={() => onDraftMe(player)}>+ Add to my team</button>
              <button className="btn btn-ghost" style={{width:'100%',justifyContent:'center'}} onClick={() => onDraftOther(player)}>Mark drafted by others (off board)</button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function StatBox({ label, value, color, hint }) {
  return (
    <div style={{background:'var(--bg3)',borderRadius:4,padding:'8px 10px',textAlign:'center'}}>
      <div style={{fontSize:10,color:'var(--text3)',marginBottom:4}}>{label}</div>
      <div style={{fontSize:17,fontWeight:700,color:color??'var(--text)'}}>{value}</div>
      {hint && <div style={{fontSize:9,color:'var(--text3)',marginTop:2}}>{hint}</div>}
    </div>
  )
}

// ── IMPORT MODAL ──────────────────────────────────────────────────────────────
function ImportModal({ text, setText, msg, setMsg, onParse, onClose, myCount }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div>
            <div style={{fontWeight:700,fontSize:14}}>Import Round</div>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{myCount} picks imported · Your team: <span style={{color:'var(--blue2)'}}>{MY_TEAM}</span></div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{fontSize:11,color:'var(--text2)',marginBottom:6}}>Paste your FantasyPros round results below</div>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={12}
          placeholder={`Team Name\n1.10\nPlayer Name\nPos\nTeam\nEdit\n...`}
          style={{width:'100%',fontFamily:'monospace',fontSize:11,marginBottom:10}} />
        {msg && <div className={`alert ${msg.startsWith('✅')?'alert-ok':'alert-warn'}`} style={{marginBottom:10}}>{msg}</div>}
        <div style={{fontSize:10,color:'var(--text3)',marginBottom:12}}>After each round on FantasyPros, copy all picks and paste here.</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onParse}>Parse Round</button>
        </div>
      </div>
    </div>
  )
}

// ── STRATEGY SHEET ────────────────────────────────────────────────────────────
const PICK_STRATEGY = [
  { round:1,  pick:'1.10', overall:10,  keeper:false, notes:"Best elite hitter available — Henderson, Lindor, or Devers always here. Don't reach for SP.",
    targets:[] },
  { round:2,  pick:'2.01', overall:11,  keeper:false, notes:"Snake turn — picks 10+11 back-to-back. Jackson Chourio (3/5 mocks at 2.01) or Cal Raleigh for C.",
    targets:["Jackson Chourio","Cal Raleigh"] },
  { round:3,  pick:'3.10', overall:30,  keeper:false, notes:"Matt Olson, Yordan Alvarez, Freddie Freeman, or first elite SP window (Logan Webb).",
    targets:[] },
  { round:4,  pick:'4.01', overall:31,  keeper:false, notes:"Brice Turang goes R3-4 in ALL 5 mocks — steal at 4.01 if available.",
    targets:["Brice Turang"] },
  { round:5,  pick:'5.10', overall:50,  keeper:false, notes:"Jarren Duran realistic here (R4-6 avg). Mason Miller / Cade Smith if CL needed.",
    targets:["Jarren Duran"] },
  { round:6,  pick:'6.01', overall:51,  keeper:false, notes:"Geraldo Perdomo goes R6-7 every mock — grab him here if available.",
    targets:["Geraldo Perdomo"] },
  { round:7,  pick:'7.10', overall:70,  keeper:false, notes:"Maikel Garcia goes R7 in ALL 5 mocks — must-take at 7.10. If Perdomo still here, grab him.",
    targets:["Maikel Garcia","Geraldo Perdomo"] },
  { round:8,  pick:'8.01', overall:71,  keeper:false, notes:"Mid-tier SP or hitter. Nolan McLean, Dylan Cease, or strong hitter value.",
    targets:[] },
  { round:9,  pick:'9.10', overall:90,  keeper:false, notes:"Trey Yesavage sometimes here (R10-13). Start targeting upside arms.",
    targets:["Trey Yesavage"] },
  { round:10, pick:'10.01', overall:91, keeper:false, notes:"Jacob Misiorowski goes R10-11 every mock — goes earlier than people expect. Also Agustin Ramirez for C.",
    targets:["Jacob Misiorowski","Agustin Ramirez"] },
  { round:11, pick:'11.10', overall:110, keeper:false, notes:"Kyle Stowers R11-13 consistent. Trey Yesavage if still available.",
    targets:["Kyle Stowers","Trey Yesavage"] },
  { round:12, pick:'12.01', overall:111, keeper:false, notes:"Emmet Sheehan (R12-14), Cam Schlittler (R12-13). Sweet spot for upside arms.",
    targets:["Emmet Sheehan","Cam Schlittler"] },
  { round:13, pick:'13.10', overall:130, keeper:false, notes:"Trevor Rogers R13-14. Konnor Griffin wildly inconsistent (R13-22) — let him fall to you.",
    targets:["Trevor Rogers","Konnor Griffin"] },
  { round:14, pick:'14.01', overall:131, keeper:true,  notes:"🔒 KEEPER: Junior Caminero (free pick). One of the best keeper values in the league.",
    targets:["Junior Caminero"] },
  { round:15, pick:'15.10', overall:150, keeper:false, notes:"Bubba Chandler goes R15-18 in EVERY mock. High upside — take him here.",
    targets:["Bubba Chandler"] },
  { round:16, pick:'16.01', overall:151, keeper:false, notes:"Andrew Vaughn or upside late SP. Kevin McGonigle (sleeper SS) appeared at R18 in 1 mock.",
    targets:["Andrew Vaughn"] },
  { round:17, pick:'17.10', overall:170, keeper:false, notes:"Thomas White (SP-MIA) upside. Jac Caglianone starting to appear (4/5 mocks).",
    targets:["Thomas White","Jac Caglianone"] },
  { round:18, pick:'18.01', overall:171, keeper:false, notes:"Kevin McGonigle sleeper window. Jonathan Aranda inconsistent but sometimes here.",
    targets:["Kevin McGonigle","Jonathan Aranda"] },
  { round:19, pick:'19.10', overall:190, keeper:true,  notes:"🔒 KEEPER: Cristopher Sanchez (free pick). Solid SP value locked in.",
    targets:["Cristopher Sanchez"] },
  { round:20, pick:'20.01', overall:191, keeper:false, notes:"Alejandro Kirk C goes R19-20 in EVERY mock — reliable late C depth.",
    targets:["Alejandro Kirk"] },
  { round:21, pick:'21.10', overall:210, keeper:false, notes:"Addison Barger R21-23 consistent. Jac Caglianone still available.",
    targets:["Addison Barger","Jac Caglianone"] },
  { round:22, pick:'22.01', overall:211, keeper:false, notes:"Jonathan Aranda sometimes still here. Sal Stewart near-undrafted.",
    targets:["Jonathan Aranda","Sal Stewart"] },
  { round:23, pick:'23.10', overall:230, keeper:false, notes:"Brendan Donovan goes R23 in ALL 5 mocks — free value. Max Muncy near-undrafted.",
    targets:["Brendan Donovan","Max Muncy"] },
  { round:24, pick:'24.01', overall:231, keeper:false, notes:"JJ Wetherholt goes R24 in EVERY mock — always available, always worth taking.",
    targets:["JJ Wetherholt"] },
]

function StrategySheet({ round, myPlayers, draftedIds, scoredPlayers }) {
  const myCount = myPlayers.length

  return (
    <div style={{padding:12,overflow:'auto'}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>📋 Draft Strategy Cheat Sheet
          <span style={{fontSize:11,fontWeight:400,color:'var(--text3)',marginLeft:8}}>Pick 10 · Calibrated from 5 mock drafts</span>
        </div>
        <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:16,flexWrap:'wrap'}}>
          <span>🔒 = keeper slot (auto-filled)</span>
          <span>⚡ = current round</span>
          <span>✓ = pick made</span>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {PICK_STRATEGY.map(slot => {
          const isCurrent = slot.round === round && !slot.keeper
          const isPast    = slot.overall < (myCount + 1) * 1 // rough
          const isDone    = slot.keeper || (slot.round < round)
          const isKeeper  = slot.keeper

          // Check if targets are still available
          const targetStatus = slot.targets.map(name => {
            const p = scoredPlayers.find(sp =>
              name.toLowerCase().split(' ').every(part => sp.name.toLowerCase().includes(part.slice(0,4)))
            )
            return { name, drafted: p?.drafted ?? false, isKeeper: p?.isKeeper ?? false }
          })

          return (
            <div key={slot.round} className={`card`} style={{
              borderLeft: `3px solid ${
                isKeeper      ? 'var(--yellow)' :
                isCurrent     ? 'var(--blue)'   :
                isDone        ? 'var(--border)'  :
                                'var(--border2)'
              }`,
              opacity: isDone && !isKeeper ? 0.55 : 1,
              background: isCurrent ? 'rgba(59,130,246,0.06)' : undefined,
              padding:'10px 12px',
            }}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                <div style={{minWidth:60}}>
                  <div style={{fontSize:10,color:'var(--text3)'}}>
                    {isCurrent ? '⚡ NOW' : isKeeper ? '🔒 KEPT' : isDone ? '✓ Done' : `Pick`}
                  </div>
                  <div style={{fontSize:16,fontWeight:700,
                    color:isKeeper?'var(--yellow)':isCurrent?'var(--blue2)':isDone?'var(--text3)':'var(--text)'}}>
                    {slot.pick}
                  </div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>#{slot.overall}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:'var(--text2)',marginBottom:6,lineHeight:1.4}}>
                    {slot.notes}
                  </div>
                  {targetStatus.length > 0 && (
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {targetStatus.map(t => (
                        <span key={t.name} style={{
                          fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:3,
                          background: t.isKeeper  ? 'rgba(251,191,36,0.15)' :
                                      t.drafted   ? 'rgba(255,255,255,0.05)' :
                                                    'rgba(59,130,246,0.12)',
                          color:      t.isKeeper  ? 'var(--yellow)' :
                                      t.drafted   ? 'var(--text3)' :
                                                    'var(--blue2)',
                          border:     `1px solid ${t.isKeeper?'rgba(251,191,36,0.3)':t.drafted?'var(--border)':'rgba(59,130,246,0.25)'}`,
                          textDecoration: t.drafted && !t.isKeeper ? 'line-through' : 'none',
                        }}>
                          {t.name}{t.drafted&&!t.isKeeper?' (gone)':t.isKeeper?' (kept)':''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
