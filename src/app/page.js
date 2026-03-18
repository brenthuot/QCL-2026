'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  HIT_CATS, PIT_CATS, ALL_CATS, NEG_CATS,
  computeGapWeights, computeLiveScore, assignTiers,
  computeTeamTotals, catProgress, rosterRoles,
  buildRecommendations, posColor, tierColor,
} from '../lib/scoring'
import { parseFantasyProsRound, matchPlayer } from '../lib/parser'

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const MY_TEAM = 'numbahs'
const LS_KEY  = 'qcl2026_draft_v2'

const KEEPERS = [
  { team: "Jim Dog's Heroes",     name: "Kyle Schwarber",        round: 6  },
  { team: "Jim Dog's Heroes",     name: "Vladimir Guerrero Jr.", round: 5  },
  { team: "Boys of Summer",       name: "Andrew Abbott",         round: 17 },
  { team: "Boys of Summer",       name: "Juan Soto",             round: 3  },
  { team: "Roady",                name: "Corbin Carroll",        round: 8  },
  { team: "Roady",                name: "Teoscar Hernandez",     round: 13 },
  { team: "Purple and Gold",      name: "Aaron Judge",           round: 2  },
  { team: "Purple and Gold",      name: "Ronald Acuna Jr.",      round: 8  },
  { team: "Big League CHOO",      name: "Francisco Lindor",      round: 4  },
  { team: "Big League CHOO",      name: "Jose Ramirez",          round: 5  },
  { team: "The Cahills & Carole", name: "Bryce Harper",          round: 21 },
  { team: "The Cahills & Carole", name: "Eugenio Suarez",        round: 16 },
  { team: "Hendu",                name: "Chris Sale",            round: 10 },
  { team: "Hendu",                name: "Tarik Skubal",          round: 1  },
  { team: "The Milkmen",          name: "Shohei Ohtani",         round: 15 },
  { team: "The Milkmen",          name: "Yoshinobu Yamamoto",    round: 5  },
  { team: "numbahs",              name: "Cristopher Sanchez",    round: 19 },
  { team: "numbahs",              name: "Junior Caminero",       round: 14 },
]

const MY_KEEPERS = KEEPERS.filter(k => k.team === MY_TEAM)

// ── HELPERS ───────────────────────────────────────────────────────────────────
function normName(n) {
  return String(n).toLowerCase()
    .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e')
    .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
    .replace(/[ùúûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim()
}

function matchKeeperToPlayer(keeperName, players) {
  const kn = normName(keeperName)
  let match = players.find(p => normName(p.name) === kn)
  if (match) return match
  const kparts = kn.split(' ')
  const klast  = kparts[kparts.length - 1]
  const kfirst = kparts[0]?.[0] ?? ''
  const candidates = players.filter(p => {
    const pp = normName(p.name).split(' ')
    return pp[pp.length-1] === klast && pp[0]?.[0] === kfirst
  })
  return candidates.sort((a,b) => (b.FPTS??0)-(a.FPTS??0))[0] ?? null
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [hitters,  setHitters]  = useState([])
  const [pitchers, setPitchers] = useState([])
  const [config,   setConfig]   = useState(null)
  const [loading,  setLoading]  = useState(true)

  const [tab,         setTab]         = useState('board')
  const [posFilter,   setPosFilter]   = useState('ALL')
  const [typeFilter,  setTypeFilter]  = useState('ALL')
  const [search,      setSearch]      = useState('')
  const [showDrafted, setShowDrafted] = useState(false)
  const [showKept,    setShowKept]    = useState(true)
  const [boardLimit,  setBoardLimit]  = useState(200)

  const [poolSearch, setPoolSearch] = useState('')
  const [poolPos,    setPoolPos]    = useState('ALL')
  const [poolSort,   setPoolSort]   = useState('liveScore')

  const [sidebarOpen,    setSidebarOpen]    = useState(true)
  const [hitWeight,      setHitWeight]      = useState(50)
  const [pitCompress,    setPitCompress]    = useState(0.85)
  const [gapSensitivity, setGapSensitivity] = useState(1.0)

  const [draftedIds,  setDraftedIds]  = useState(new Set())
  const [myPlayerIds, setMyPlayerIds] = useState([])
  const [keeperIds,   setKeeperIds]   = useState(new Set())
  const [myKeeperIds, setMyKeeperIds] = useState([])
  const [round,       setRound]       = useState(1)

  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg,  setImportMsg]  = useState('')
  const [showReset,  setShowReset]  = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  // Load data + init keepers
  useEffect(() => {
    Promise.all([
      fetch('/hitters.json').then(r => r.json()),
      fetch('/pitchers.json').then(r => r.json()),
      fetch('/config.json').then(r => r.json()),
    ]).then(([h, p, c]) => {
      setHitters(h); setPitchers(p); setConfig(c)
      const all = [...h, ...p]

      const kIds    = new Set()
      const myKIds  = []
      const kDrafted = new Set()

      for (const k of KEEPERS) {
        const player = matchKeeperToPlayer(k.name, all)
        if (!player) { console.warn('Keeper not matched:', k.name); continue }
        kIds.add(player.id)
        kDrafted.add(player.id)
        if (k.team === MY_TEAM) myKIds.push(player.id)
      }

      setKeeperIds(kIds)

      let restored = false
      try {
        const saved = localStorage.getItem(LS_KEY)
        if (saved) {
          const { drafted, mine, roundNum } = JSON.parse(saved)
          setDraftedIds(new Set([...kDrafted, ...(drafted || [])]))
          setMyPlayerIds([...new Set([...myKIds, ...(mine || [])])])
          setMyKeeperIds(myKIds)
          setRound(roundNum || 1)
          restored = true
        }
      } catch {}

      if (!restored) {
        setDraftedIds(kDrafted)
        setMyPlayerIds(myKIds)
        setMyKeeperIds(myKIds)
      }

      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (loading) return
    localStorage.setItem(LS_KEY, JSON.stringify({
      drafted: [...draftedIds],
      mine: myPlayerIds,
      roundNum: round,
    }))
  }, [draftedIds, myPlayerIds, round, loading])

  const allPlayers = useMemo(() => [...hitters, ...pitchers], [hitters, pitchers])

  const playerById = useMemo(() => {
    const m = {}
    for (const p of allPlayers) m[p.id] = p
    return m
  }, [allPlayers])

  const myPlayers = useMemo(() =>
    myPlayerIds.map(id => playerById[id]).filter(Boolean),
  [myPlayerIds, playerById])

  const myTotals = useMemo(() => computeTeamTotals(myPlayers), [myPlayers])
  const targets  = config?.targets ?? {}

  const gapWeights = useMemo(() =>
    computeGapWeights(myTotals, targets, round, gapSensitivity),
  [myTotals, targets, round, gapSensitivity])

  // Keeper lookup map: playerId → keeper info
  const keeperByPlayerId = useMemo(() => {
    const m = {}
    for (const k of KEEPERS) {
      const p = matchKeeperToPlayer(k.name, allPlayers)
      if (p) m[p.id] = k
    }
    return m
  }, [allPlayers])

  const scoredPlayers = useMemo(() => {
    const pitW = (100 - hitWeight) / 100
    const hitW = hitWeight / 100
    const all = allPlayers.map(p => {
      const { liveScore, liveBreakdown } = computeLiveScore(p, gapWeights)
      // Dampeners calibrated from 10-team mock draft:
      // CL: go rounds 4-9 → should rank ~30-90 on board → dampener 0.68
      // SU: go rounds 13+ → should rank ~120-150 → dampener 0.38
      // RP: generic → dampener 0.35
      // SP: controlled by pitCompress slider (default 0.85)
      const rpDampener = p.pos === 'CL' ? 0.68
        : p.pos === 'SU' ? 0.38
        : p.pos === 'RP' ? 0.35
        : 1.0
      const typeScale = p.type === 'hitter'
        ? hitW * 2
        : pitW * 2 * (p.pos === 'SP' ? pitCompress : pitCompress * rpDampener)
      const kInfo = keeperByPlayerId[p.id]
      return {
        ...p,
        drafted:    draftedIds.has(p.id),
        isKeeper:   keeperIds.has(p.id),
        keeperInfo: kInfo ?? null,
        isMine:     myPlayerIds.includes(p.id),
        isMyKeeper: myKeeperIds.includes(p.id),
        liveScore:  liveScore * typeScale,
        liveBreakdown,
      }
    })
    return assignTiers(all, 'liveScore')
  }, [allPlayers, draftedIds, keeperIds, myPlayerIds, myKeeperIds,
      gapWeights, hitWeight, pitCompress, keeperByPlayerId])

  const roles = useMemo(() => rosterRoles(myPlayers), [myPlayers])

  const recommendations = useMemo(() =>
    buildRecommendations(
      scoredPlayers.filter(p => !p.drafted && !p.isKeeper),
      myPlayers, targets, round, myTotals, gapWeights
    ).slice(0, 8),
  [scoredPlayers, myPlayers, targets, round, myTotals, gapWeights])

  const diagnostics = useMemo(() => {
    const avail  = scoredPlayers.filter(p => !p.drafted && !p.isKeeper)
    const sorted = [...avail].sort((a,b) => b.liveScore - a.liveScore)
    const top20  = sorted.slice(0,20)
    const top50  = sorted.slice(0,50)
    const top100 = sorted.slice(0,100)
    return {
      spIn20:  top20.filter(p => p.pos==='SP').length,
      spIn50:  top50.filter(p => p.pos==='SP').length,
      spIn100: top100.filter(p => p.pos==='SP').length,
      clIn20:  top20.filter(p => p.pos==='CL').length,
      clIn50:  top50.filter(p => p.pos==='CL').length,
      rpIn50:  top50.filter(p => ['CL','SU','RP'].includes(p.pos)).length,
    }
  }, [scoredPlayers])

  const markDrafted = useCallback((player, isMine) => {
    setDraftedIds(prev => new Set([...prev, player.id]))
    if (isMine && !myPlayerIds.includes(player.id)) {
      setMyPlayerIds(prev => [...prev, player.id])
    }
    setRound(prev => {
      const nonKeeperDrafted = [...draftedIds].filter(id => !keeperIds.has(id)).length + 1
      return Math.max(1, Math.floor(nonKeeperDrafted / 10) + 1)
    })
  }, [draftedIds, myPlayerIds, keeperIds])

  const undraftPlayer = useCallback((id) => {
    if (keeperIds.has(id)) return
    setDraftedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    setMyPlayerIds(prev => prev.filter(pid => pid !== id))
  }, [keeperIds])

  const handleImport = useCallback(() => {
    const picks = parseFantasyProsRound(importText, MY_TEAM)
    if (picks.length === 0) { setImportMsg('⚠ No picks found. Check the format.'); return }
    let matched = 0, mine = 0, unmatched = []
    const newDrafted = new Set(draftedIds)
    const newMine    = [...myPlayerIds]
    for (const pick of picks) {
      const player = matchPlayer(pick.playerName, allPlayers)
      if (!player) { unmatched.push(pick.playerName); continue }
      if (!newDrafted.has(player.id)) {
        newDrafted.add(player.id); matched++
        if (pick.isMine && !newMine.includes(player.id)) { newMine.push(player.id); mine++ }
      }
    }
    setDraftedIds(newDrafted)
    setMyPlayerIds(newMine)
    setRound(picks.length > 0 ? Math.max(...picks.map(p => p.round)) + 1 : round)
    setImportMsg(`✅ Imported ${matched} picks (${mine} yours).${unmatched.length ? ` Unmatched: ${unmatched.slice(0,4).join(', ')}` : ''}`)
    setImportText('')
  }, [importText, draftedIds, myPlayerIds, allPlayers, round])

  const resetDraft = useCallback(() => {
    const kDrafted = new Set()
    const myKIds   = []
    for (const k of KEEPERS) {
      const p = matchKeeperToPlayer(k.name, allPlayers)
      if (!p) continue
      kDrafted.add(p.id)
      if (k.team === MY_TEAM) myKIds.push(p.id)
    }
    setDraftedIds(kDrafted); setMyPlayerIds(myKIds)
    setRound(1); setShowReset(false)
    localStorage.removeItem(LS_KEY)
  }, [allPlayers])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
      height:'100vh', color:'var(--text2)', fontSize:14, gap:10 }}>
      <span style={{ fontSize:20 }}>⚾</span> Loading QCL 2026...
    </div>
  )

  const nonKeeperDrafted = [...draftedIds].filter(id => !keeperIds.has(id)).length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      <AppHeader
        round={round} myCount={myPlayers.length}
        draftedTotal={nonKeeperDrafted}
        onImport={() => setShowImport(true)}
        onReset={() => setShowReset(true)}
        tab={tab} setTab={setTab}
      />

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {sidebarOpen && (
          <Sidebar
            diagnostics={diagnostics}
            hitWeight={hitWeight} setHitWeight={setHitWeight}
            pitCompress={pitCompress} setPitCompress={setPitCompress}
            gapSensitivity={gapSensitivity} setGapSensitivity={setGapSensitivity}
            onClose={() => setSidebarOpen(false)}
            roles={roles}
          />
        )}
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)}
            style={{ writingMode:'vertical-rl', padding:'12px 6px',
              background:'var(--bg2)', border:'none',
              borderRight:'1px solid var(--border)',
              color:'var(--text3)', fontSize:11, cursor:'pointer', letterSpacing:'0.1em' }}>
            ▶ CONTROLS
          </button>
        )}

        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {tab === 'board' && (
            <DraftBoard
              players={scoredPlayers}
              keeperByPlayerId={keeperByPlayerId}
              posFilter={posFilter} setPosFilter={setPosFilter}
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              search={search} setSearch={setSearch}
              showDrafted={showDrafted} setShowDrafted={setShowDrafted}
              showKept={showKept} setShowKept={setShowKept}
              boardLimit={boardLimit} setBoardLimit={setBoardLimit}
              onDraftMe={p => markDrafted(p, true)}
              onDraftOther={p => markDrafted(p, false)}
              onUndraft={undraftPlayer}
              selectedPlayer={selectedPlayer}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
          {tab === 'team' && (
            <MyTeam myPlayers={myPlayers} myTotals={myTotals}
              targets={targets} roles={roles}
              onUndraft={undraftPlayer} keeperIds={keeperIds}
            />
          )}
          {tab === 'cats' && (
            <CategoryDashboard myTotals={myTotals} targets={targets} gapWeights={gapWeights} />
          )}
          {tab === 'rec' && (
            <Recommendations recommendations={recommendations}
              round={round} roles={roles}
              onDraftMe={p => markDrafted(p, true)}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
          {tab === 'pool' && (
            <FullPool players={scoredPlayers}
              search={poolSearch} setSearch={setPoolSearch}
              pos={poolPos} setPos={setPoolPos}
              sortKey={poolSort} setSort={setPoolSort}
              keeperByPlayerId={keeperByPlayerId}
              selectedPlayer={selectedPlayer}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
        </div>
      </div>

      {showImport && (
        <ImportModal text={importText} setText={setImportText}
          msg={importMsg} setMsg={setImportMsg}
          onParse={handleImport}
          onClose={() => { setShowImport(false); setImportMsg('') }}
          myCount={myPlayers.length - myKeeperIds.length}
        />
      )}
      {showReset && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth:360 }}>
            <p style={{ marginBottom:4, fontWeight:700 }}>Reset Draft?</p>
            <p style={{ color:'var(--text3)', fontSize:12, marginBottom:16 }}>
              All picks cleared. Your keepers (Sanchez R19, Caminero R14) will be restored.
            </p>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowReset(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={resetDraft}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* PLAYER DETAIL PANEL */}
      {selectedPlayer && (
        <PlayerPanel
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          onDraftMe={p => { markDrafted(p, true); setSelectedPlayer(null) }}
          onDraftOther={p => { markDrafted(p, false); setSelectedPlayer(null) }}
          onUndraft={id => { undraftPlayer(id); setSelectedPlayer(null) }}
          keeperByPlayerId={keeperByPlayerId}
          gapWeights={gapWeights}
          targets={targets}
          scoredPlayers={scoredPlayers}
        />
      )}
    </div>
  )
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function AppHeader({ round, myCount, draftedTotal, onImport, onReset, tab, setTab }) {
  const tabs = [
    { id:'board', label:'🎯 Draft Board', desc:'Live-ranked board. M = mine, D = other team drafted.' },
    { id:'team',  label:'👤 My Team',     desc:'Your roster + 12-cat progress bars vs JRH targets.' },
    { id:'cats',  label:'📊 Categories',  desc:'Gap analysis for all 12 cats sorted by urgency.' },
    { id:'rec',   label:'⚡ Recs',        desc:'Best pick right now with plain-English reasoning.' },
    { id:'pool',  label:'🔍 Full Pool',   desc:'Every player sortable by any stat. Good for lookups.' },
  ]
  return (
    <div style={{ background:'var(--bg2)', borderBottom:'1px solid var(--border2)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <span style={{ fontSize:15, fontWeight:700, color:'var(--blue2)', letterSpacing:'0.06em' }}>
            ⚾ QCL 2026
          </span>
          <span style={{ fontSize:11, color:'var(--text3)' }}>Roto · 10-Team · Pick 10</span>
          <span style={{ fontSize:11, color:'var(--text3)' }}>
            Rd <b style={{ color:'var(--text2)' }}>{round}</b>
            {' · '}
            <b style={{ color:'var(--text2)' }}>{draftedTotal}</b> drafted
            {' · '}
            <b style={{ color:'var(--blue2)' }}>{myCount}</b>/24 mine
          </span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button className="btn btn-primary btn-sm" onClick={onImport}
            title="Paste FantasyPros round text to sync all picks at once">
            📥 Import Round
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onReset}
            title="Clear all picks and restore keepers">
            ↺ Reset
          </button>
        </div>
      </div>
      <div className="tab-nav" style={{ padding:'0 14px' }}>
        {tabs.map(t => (
          <div key={t.id} className={`tab-item ${tab===t.id?'active':''}`}
            onClick={() => setTab(t.id)}
            title={t.desc}>
            {t.label}
          </div>
        ))}
      </div>
      {/* Active tab description bar */}
      {tabs.find(t => t.id === tab) && (
        <div style={{ padding:'3px 14px 4px', fontSize:10, color:'var(--text3)',
          borderTop:'1px solid var(--border)', background:'var(--bg)' }}>
          {tabs.find(t => t.id === tab).desc}
        </div>
      )}
    </div>
  )
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function Sidebar({ diagnostics, hitWeight, setHitWeight, pitCompress, setPitCompress,
                   gapSensitivity, setGapSensitivity, onClose, roles }) {
  return (
    <div style={{ width:232, minWidth:232, background:'var(--bg2)',
      borderRight:'1px solid var(--border)', overflowY:'auto',
      display:'flex', flexDirection:'column', fontSize:12 }}>

      <div style={{ padding:'10px 12px 6px', borderBottom:'1px solid var(--border)',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:700, fontSize:11, letterSpacing:'0.1em',
          color:'var(--text2)', textTransform:'uppercase' }}>Model Controls</span>
        <button onClick={onClose} style={{ background:'none', border:'none',
          color:'var(--text3)', cursor:'pointer', fontSize:14 }}>◀</button>
      </div>
      <div style={{ padding:'5px 12px 8px', fontSize:10, color:'var(--text3)',
        borderBottom:'1px solid var(--border)', lineHeight:1.6 }}>
        All rankings update instantly as you adjust settings.<br/>
        <span style={{ color:'var(--yellow)' }}>Score</span> = z-score × gap weight × H/P weight.<br/>
        <span style={{ color:'var(--green)' }}>Edge</span> = your rank minus CBS ADP (positive = value pick).
      </div>

      {/* Live Diagnostics */}
      <SidebarSection title="Live Diagnostics" hint="Are SPs & closers ranked high enough on your board?">
        <DiagRow label="SP in Top 20"  val={diagnostics.spIn20}  lo={3}  hi={5}  />
        <DiagRow label="SP in Top 50"  val={diagnostics.spIn50}  lo={10} hi={16} />
        <DiagRow label="SP in Top 100" val={diagnostics.spIn100} lo={22} hi={30} />
        <DiagRow label="CL in Top 20"  val={diagnostics.clIn20}  lo={1}  hi={3}  />
        <DiagRow label="CL in Top 50"  val={diagnostics.clIn50}  lo={3}  hi={6}  />
        <DiagRow label="RP in Top 50"  val={diagnostics.rpIn50}  lo={5}  hi={10} />
      </SidebarSection>

      {/* My Keepers */}
      <SidebarSection title="My Keepers" hint="Pre-loaded on your roster. Shown grayed out on the board.">
        {MY_KEEPERS.map(k => (
          <div key={k.name} style={{ display:'flex', justifyContent:'space-between',
            padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ color:'var(--text)', fontSize:11 }}>{k.name}</span>
            <span style={{ color:'var(--yellow)', fontSize:10, fontWeight:700 }}>R{k.round}</span>
          </div>
        ))}
      </SidebarSection>

      {/* Weights */}
      <SidebarSection title="Weights" hint="Adjust how scores are calculated. Defaults work well.">
        <SliderRow label="Hitter weight" value={hitWeight} min={30} max={75} step={1}
          display={`${hitWeight}%`} onChange={setHitWeight} />
        <div style={{ fontSize:10, color:'var(--text3)', marginBottom:8 }}>
          Pitcher weight (auto): {100 - hitWeight}%
        </div>
        <SliderRow label="Pitcher compression" value={pitCompress} min={0.60} max={1.10} step={0.05}
          display={pitCompress.toFixed(2)} onChange={setPitCompress}
          hint="SP scale. CL ×0.68 (rounds 4–9), SU ×0.38 (round 13+)." />
        <SliderRow label="Gap sensitivity" value={gapSensitivity} min={0.5} max={2.0} step={0.1}
          display={gapSensitivity.toFixed(1)} onChange={setGapSensitivity}
          hint="How strongly category gaps shift rankings" />
        <button className="btn btn-ghost btn-sm" style={{ width:'100%', marginTop:4, fontSize:10 }}
          onClick={() => { setHitWeight(50); setPitCompress(0.85); setGapSensitivity(1.0) }}>
          Reset to defaults
        </button>
      </SidebarSection>

      {/* Pitcher Roles */}
      <SidebarSection title="Pitcher Roles" hint="Track your 3 pitcher role targets. Red = behind pace.">
        {[
          { label:'Win Contributors', cur:roles.winContributors, target:7 },
          { label:'Closers (S)',       cur:roles.closers,         target:3 },
          { label:'Hold Spec (HD)',    cur:roles.holdSpec,        target:2 },
        ].map(r => {
          const color = r.cur>=r.target?'var(--green)':r.cur>=r.target-1?'var(--yellow)':'var(--red)'
          return (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between',
              padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--text2)' }}>{r.label}</span>
              <span style={{ color, fontWeight:700 }}>{r.cur}/{r.target}</span>
            </div>
          )
        })}
      </SidebarSection>

      <div style={{ padding:'10px 12px', fontSize:10, color:'var(--text3)',
        borderTop:'1px solid var(--border)', marginTop:'auto' }}>
        z-score → H/P weights → gap weights → tier detection
      </div>
    </div>
  )
}

function SidebarSection({ title, hint, children }) {
  return (
    <div style={{ borderBottom:'1px solid var(--border)' }}>
      <div style={{ padding:'8px 12px 2px', fontSize:10, fontWeight:700,
        letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text3)' }}>
        {title}
      </div>
      {hint && (
        <div style={{ padding:'0 12px 4px', fontSize:9, color:'var(--text3)',
          lineHeight:1.5, fontStyle:'italic' }}>
          {hint}
        </div>
      )}
      <div style={{ padding:'4px 12px 10px' }}>{children}</div>
    </div>
  )
}

function DiagRow({ label, val, lo, hi }) {
  const ok   = val >= lo && val <= hi
  const low  = val < lo
  const color = ok ? 'var(--green)' : low ? 'var(--yellow)' : 'var(--yellow)'
  const icon  = ok ? '✓' : low ? '~' : '✗'
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'2px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ color:'var(--text2)', fontSize:11 }}>{label}</span>
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <span style={{ color, fontWeight:700, fontSize:12 }}>{val}</span>
        <span style={{ color:'var(--text3)', fontSize:10 }}>/{hi}</span>
        <span style={{ fontSize:11, color }}>{icon}</span>
      </div>
    </div>
  )
}

function SliderRow({ label, value, min, max, step, display, onChange, hint }) {
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
        <span style={{ color:'var(--text2)', fontSize:11 }}>{label}</span>
        <span style={{ color:'var(--blue2)', fontWeight:700, fontSize:11 }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step<1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width:'100%', accentColor:'var(--blue)', cursor:'pointer' }} />
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--text3)' }}>
        <span>{min}</span><span>{max}</span>
      </div>
      {hint && <div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{hint}</div>}
    </div>
  )
}

// ── DRAFT BOARD ───────────────────────────────────────────────────────────────
function DraftBoard({
  players, keeperByPlayerId,
  posFilter, setPosFilter, typeFilter, setTypeFilter,
  search, setSearch, showDrafted, setShowDrafted,
  showKept, setShowKept, boardLimit, setBoardLimit,
  onDraftMe, onDraftOther, onUndraft,
  selectedPlayer, onSelectPlayer,
}) {
  const positions = ['ALL','C','1B','2B','3B','SS','OF','SP','RP','CL','SU']

  const filtered = useMemo(() => {
    let p = [...players]
    if (!showKept)    p = p.filter(x => !x.isKeeper)
    if (!showDrafted) p = p.filter(x => !x.drafted || x.isKeeper)
    if (typeFilter === 'H') p = p.filter(x => x.type === 'hitter')
    if (typeFilter === 'P') p = p.filter(x => x.type === 'pitcher')
    if (posFilter !== 'ALL') p = p.filter(x => x.pos === posFilter)
    if (search) {
      const q = search.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q) || x.team.toLowerCase().includes(q))
    }
    // Keepers sink to bottom
    p.sort((a, b) => {
      if (a.isKeeper !== b.isKeeper) return a.isKeeper ? 1 : -1
      return (b.liveScore ?? -99) - (a.liveScore ?? -99)
    })
    return p.slice(0, boardLimit)
  }, [players, showKept, showDrafted, typeFilter, posFilter, search, boardLimit])

  const topScore = players.find(p => !p.drafted && !p.isKeeper)?.liveScore ?? 1

  let rankCounter = 0
  const withRank = filtered.map(p => {
    if (!p.isKeeper && !p.drafted) rankCounter++
    return { ...p, boardRank: (p.isKeeper || p.drafted) ? null : rankCounter }
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Filter bar */}
      <div style={{ padding:'4px 12px', background:'var(--bg)', borderBottom:'1px solid var(--border)',
        fontSize:10, color:'var(--text3)', display:'flex', gap:16, alignItems:'center' }}>
        <span><b style={{ color:'var(--text2)' }}>Score</b> = z-score weighted by your category gaps — updates after every pick</span>
        <span><b style={{ color:'var(--green)' }}>M</b> = drafted by me &nbsp;·&nbsp; <b style={{ color:'var(--text2)' }}>D</b> = drafted by other team</span>
        <span><b style={{ color:'var(--yellow)' }}>K·R#</b> = keeper, kept in that round</span>
        <span>Edge = your rank vs CBS ADP (<b style={{ color:'var(--green)' }}>+</b> = value, <b style={{ color:'var(--red)' }}>–</b> = reaching)</span>
      </div>
      <div style={{ padding:'7px 12px', background:'var(--bg2)',
        borderBottom:'1px solid var(--border)',
        display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search player or team…" style={{ width:170 }} />
        <div style={{ display:'flex', gap:3 }}>
          {[['ALL','All'],['H','⚾ Hitters'],['P','🥎 Pitchers']].map(([v,lbl]) => (
            <button key={v} className={`btn btn-sm ${typeFilter===v?'btn-primary':'btn-ghost'}`}
              onClick={() => { setTypeFilter(v); setPosFilter('ALL') }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:2, flexWrap:'wrap' }}>
          {positions.map(pos => (
            <button key={pos}
              className={`btn btn-sm ${posFilter===pos?'btn-primary':'btn-ghost'}`}
              style={{ minWidth:34, padding:'3px 6px' }}
              onClick={() => setPosFilter(pos)}>{pos}</button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center',
          fontSize:11, color:'var(--text2)' }}>
          <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
            <input type="checkbox" checked={showKept} onChange={e => setShowKept(e.target.checked)} />
            Keepers
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
            <input type="checkbox" checked={showDrafted} onChange={e => setShowDrafted(e.target.checked)} />
            Drafted
          </label>
          <span style={{ color:'var(--text3)' }}>{filtered.length} shown</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex:1, overflow:'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width:38 }}>#</th>
              <th style={{ width:22 }}>T</th>
              <th style={{ minWidth:160 }}>Player</th>
              <th>Pos</th><th>Team</th>
              <th>Score</th>
              <th style={{ width:38 }}>Tier</th>
              <th style={{ width:50 }}>CBS</th>
              <th style={{ width:44 }}>Edge</th>
              <th>R</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th><th>OBP</th>
              <th>W</th><th>S</th><th>HD</th><th>K</th><th>ERA</th><th>WHIP</th>
              <th style={{ width:70 }}>M / D</th>
            </tr>
          </thead>
          <tbody>
            {withRank.map(p => {
              const isH  = p.type === 'hitter'
              const edge = p.cbsADP && p.boardRank
                ? Math.round(p.boardRank - p.cbsADP) : null
              const barW = p.isKeeper ? 0
                : Math.max(0, Math.min(100, (p.liveScore / topScore) * 100))

              return (
                <tr key={p.id}
                  onClick={() => onSelectPlayer(p)}
                  style={{
                    ...(p.isKeeper ? { opacity:0.42 } : p.drafted ? { opacity:0.35 } : {}),
                    cursor:'pointer',
                    outline: selectedPlayer?.id === p.id ? '1px solid var(--blue)' : 'none',
                    background: selectedPlayer?.id === p.id ? 'rgba(59,130,246,0.08)' : undefined,
                  }}
                  className={`${p.isMine && !p.isKeeper ? 'mine' : ''} ${p.tierBreak && !p.isKeeper ? 'tier-break' : ''}`}
                >
                  <td style={{ color:'var(--text3)', fontSize:11 }}>
                    {p.isKeeper
                      ? <span style={{ fontSize:9, color:'var(--yellow)', fontWeight:700 }}>K·R{p.keeperInfo?.round}</span>
                      : p.boardRank}
                  </td>
                  <td>
                    <span style={{ fontSize:10, fontWeight:700,
                      color: isH ? 'var(--green)' : p.pos==='CL' ? 'var(--purple)' : 'var(--blue2)' }}>
                      {isH ? 'H' : p.pos==='CL' ? 'CL' : 'P'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: p.isMine ? 700 : 400 }}>{p.name}</span>
                    {p.isMyKeeper && (
                      <span style={{ marginLeft:5, fontSize:9, fontWeight:700,
                        color:'var(--yellow)', background:'rgba(251,191,36,0.12)',
                        padding:'1px 4px', borderRadius:2,
                        border:'1px solid rgba(251,191,36,0.25)' }}>
                        KEPT R{p.keeperInfo?.round}
                      </span>
                    )}
                    {p.isKeeper && !p.isMyKeeper && (
                      <span style={{ marginLeft:5, fontSize:9, color:'var(--text3)',
                        background:'rgba(255,255,255,0.05)', padding:'1px 4px', borderRadius:2 }}>
                        KEPT
                      </span>
                    )}
                    {p.isMine && !p.isKeeper && (
                      <span style={{ marginLeft:5, fontSize:9, color:'var(--blue)',
                        background:'rgba(59,130,246,0.12)', padding:'1px 4px', borderRadius:2 }}>
                        MINE
                      </span>
                    )}
                  </td>
                  <td><span style={{ color:posColor(p.pos), fontWeight:600, fontSize:12 }}>{p.pos}</span></td>
                  <td style={{ color:'var(--text3)' }}>{p.team}</td>
                  <td>
                    {!p.isKeeper && (
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <div style={{ width:42, height:4, background:'var(--bg3)', borderRadius:2 }}>
                          <div style={{ height:'100%', borderRadius:2,
                            background:tierColor(p.tier), width:`${barW}%` }} />
                        </div>
                        <span style={{ fontSize:11, color:'var(--text2)', minWidth:26 }}>
                          {p.liveScore?.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {!p.isKeeper && (
                      <span style={{ color:tierColor(p.tier), fontSize:11, fontWeight:700 }}>T{p.tier}</span>
                    )}
                  </td>
                  <td style={{ color:'var(--text3)', fontSize:11 }}>{p.cbsADP ? p.cbsADP.toFixed(1) : '—'}</td>
                  <td style={{ fontSize:11,
                    fontWeight: edge != null && Math.abs(edge)>5 ? 700 : 400,
                    color: edge==null ? 'var(--text3)'
                      : edge>5  ? 'var(--green)'
                      : edge<-5 ? 'var(--red)'
                      : 'var(--text3)' }}>
                    {edge != null ? (edge>0?`+${edge}`:edge) : '—'}
                  </td>
                  {/* Hitter stats */}
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?Math.round(p.R||0):'—'}</td>
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?Math.round(p.H||0):'—'}</td>
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?Math.round(p.HR||0):'—'}</td>
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?Math.round(p.RBI||0):'—'}</td>
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?Math.round(p.SB||0):'—'}</td>
                  <td style={{ color:isH?'var(--text)':'var(--text3)' }}>{isH?(p.OBP||0).toFixed(3):'—'}</td>
                  {/* Pitcher stats */}
                  <td style={{ color:!isH?'var(--text)'  :'var(--text3)' }}>{!isH?Math.round(p.W||0):'—'}</td>
                  <td style={{ color:!isH?'var(--purple)':'var(--text3)' }}>{!isH?Math.round(p.SV||0):'—'}</td>
                  <td style={{ color:!isH?'var(--blue2)' :'var(--text3)' }}>{!isH?Math.round(p.HLD||0):'—'}</td>
                  <td style={{ color:!isH?'var(--text)'  :'var(--text3)' }}>{!isH?Math.round(p.SO||0):'—'}</td>
                  <td style={{ color:!isH?'var(--text)'  :'var(--text3)' }}>{!isH?(p.ERA||0).toFixed(2):'—'}</td>
                  <td style={{ color:!isH?'var(--text)'  :'var(--text3)' }}>{!isH?(p.WHIP||0).toFixed(3):'—'}</td>
                  {/* M/D */}
                  <td>
                    {p.isKeeper ? (
                      <span style={{ fontSize:10, color:'var(--yellow)' }}>KEPT</span>
                    ) : p.drafted ? (
                      <button className="btn btn-sm btn-ghost" style={{ fontSize:10, padding:'2px 6px' }}
                        onClick={() => onUndraft(p.id)}>Undo</button>
                    ) : (
                      <div style={{ display:'flex', gap:3 }}>
                        <button className="btn btn-sm btn-primary" style={{ padding:'2px 8px' }}
                          onClick={() => onDraftMe(p)} title="Draft to my team">M</button>
                        <button className="btn btn-sm btn-ghost"
                          style={{ padding:'2px 8px', color:'var(--text3)' }}
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
          <div style={{ padding:12, textAlign:'center' }}>
            <button className="btn btn-ghost btn-sm"
              onClick={() => setBoardLimit(b => b + 100)}>Show more players</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MY TEAM ───────────────────────────────────────────────────────────────────
function MyTeam({ myPlayers, myTotals, targets, roles, onUndraft, keeperIds }) {
  // Slot definitions in display order
  const SLOTS = [
    { id:'C',    label:'C',    eligible:['C'],                              group:'hitters' },
    { id:'1B',   label:'1B',   eligible:['1B'],                             group:'hitters' },
    { id:'2B',   label:'2B',   eligible:['2B'],                             group:'hitters' },
    { id:'3B',   label:'3B',   eligible:['3B'],                             group:'hitters' },
    { id:'SS',   label:'SS',   eligible:['SS'],                             group:'hitters' },
    { id:'OF1',  label:'OF',   eligible:['OF'],                             group:'hitters' },
    { id:'OF2',  label:'OF',   eligible:['OF'],                             group:'hitters' },
    { id:'OF3',  label:'OF',   eligible:['OF'],                             group:'hitters' },
    { id:'OF4',  label:'OF',   eligible:['OF'],                             group:'hitters' },
    { id:'UT1',  label:'UTIL', eligible:['C','1B','2B','3B','SS','OF'],     group:'hitters' },
    { id:'UT2',  label:'UTIL', eligible:['C','1B','2B','3B','SS','OF'],     group:'hitters' },
    { id:'UT3',  label:'UTIL', eligible:['C','1B','2B','3B','SS','OF'],     group:'hitters' },
    { id:'SP1',  label:'SP',   eligible:['SP'],                             group:'pitchers' },
    { id:'SP2',  label:'SP',   eligible:['SP'],                             group:'pitchers' },
    { id:'SP3',  label:'SP',   eligible:['SP'],                             group:'pitchers' },
    { id:'SP4',  label:'SP',   eligible:['SP'],                             group:'pitchers' },
    { id:'RP1',  label:'RP',   eligible:['RP','CL','SU'],                   group:'pitchers' },
    { id:'RP2',  label:'RP',   eligible:['RP','CL','SU'],                   group:'pitchers' },
    { id:'RP3',  label:'RP',   eligible:['RP','CL','SU'],                   group:'pitchers' },
    { id:'P1',   label:'P',    eligible:['SP','RP','CL','SU'],              group:'pitchers' },
    { id:'P2',   label:'P',    eligible:['SP','RP','CL','SU'],              group:'pitchers' },
    { id:'BN1',  label:'BN',   eligible:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], group:'bench' },
    { id:'BN2',  label:'BN',   eligible:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], group:'bench' },
    { id:'BN3',  label:'BN',   eligible:['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], group:'bench' },
  ]

  // Greedy slot-filling: fill specific slots first, then flex/bench
  // Priority order: specific pos slots → UTIL → P flex → BN
  const slotted = useMemo(() => {
    const unassigned = [...myPlayers]
    const assigned   = {}

    // Pass 1: exact position matches (C→C, 1B→1B, SP→SP, RP→RP)
    for (const slot of SLOTS.filter(s => !['UTIL','P','BN'].includes(s.label))) {
      const idx = unassigned.findIndex(p => slot.eligible.includes(p.pos))
      if (idx >= 0) {
        assigned[slot.id] = unassigned.splice(idx, 1)[0]
      }
    }

    // Pass 2: UTIL slots
    for (const slot of SLOTS.filter(s => s.label === 'UTIL')) {
      const idx = unassigned.findIndex(p => slot.eligible.includes(p.pos))
      if (idx >= 0) {
        assigned[slot.id] = unassigned.splice(idx, 1)[0]
      }
    }

    // Pass 3: P (SP/RP flex) slots
    for (const slot of SLOTS.filter(s => s.label === 'P')) {
      const idx = unassigned.findIndex(p => slot.eligible.includes(p.pos))
      if (idx >= 0) {
        assigned[slot.id] = unassigned.splice(idx, 1)[0]
      }
    }

    // Pass 4: BN gets whatever is left
    for (const slot of SLOTS.filter(s => s.label === 'BN')) {
      if (unassigned.length > 0) {
        assigned[slot.id] = unassigned.shift()
      }
    }

    return assigned
  }, [myPlayers])

  const GROUP_LABELS = { hitters:'Hitters', pitchers:'Pitchers', bench:'Bench' }
  let lastGroup = null

  return (
    <div style={{ padding:12, display:'grid', gap:12,
      gridTemplateColumns:'1fr 1fr', overflow:'auto' }}>
      <div>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>
          My Roster — {myPlayers.length}/24
        </div>
        {SLOTS.map(slot => {
          const player = slotted[slot.id]
          const isK    = player ? keeperIds.has(player.id) : false
          const showGroupHeader = slot.group !== lastGroup
          lastGroup = slot.group
          return (
            <div key={slot.id}>
              {showGroupHeader && (
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em',
                  textTransform:'uppercase', color:'var(--text3)',
                  padding:'8px 0 4px', marginTop: slot.group==='hitters' ? 0 : 6,
                  borderTop: slot.group==='hitters' ? 'none' : '1px solid var(--border)' }}>
                  {GROUP_LABELS[slot.group]}
                </div>
              )}
              <div style={{ display:'flex', alignItems:'center', gap:6,
                padding:'4px 0', borderBottom:'1px solid var(--border)',
                background: isK ? 'rgba(251,191,36,0.03)' : 'transparent',
                minHeight:30 }}>
                {/* Slot label */}
                <span style={{ fontSize:10, fontWeight:700, color:'var(--text3)',
                  minWidth:32, textAlign:'right', paddingRight:4,
                  borderRight:'1px solid var(--border)', marginRight:4 }}>
                  {slot.label}
                </span>
                {player ? (
                  <>
                    <span style={{ color:posColor(player.pos), fontWeight:700,
                      fontSize:11, minWidth:26 }}>{player.pos}</span>
                    <span style={{ flex:1, fontSize:12,
                      fontWeight: isK ? 600 : 400 }}>{player.name}</span>
                    {isK && (
                      <span style={{ fontSize:9, color:'var(--yellow)', fontWeight:700,
                        background:'rgba(251,191,36,0.12)', padding:'1px 5px',
                        borderRadius:2, flexShrink:0 }}>KEPT</span>
                    )}
                    <span style={{ fontSize:10, color:'var(--text3)',
                      minWidth:28, textAlign:'right' }}>{player.team}</span>
                    {!isK && (
                      <button className="btn btn-sm btn-ghost"
                        style={{ fontSize:9, padding:'1px 5px', flexShrink:0 }}
                        onClick={() => onUndraft(player.id)}>✕</button>
                    )}
                  </>
                ) : (
                  <span style={{ color:'var(--text3)', fontSize:11,
                    fontStyle:'italic' }}>— empty —</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div className="card">
          <div style={{ fontWeight:700, fontSize:11, marginBottom:10, color:'var(--text2)',
            letterSpacing:'0.08em', textTransform:'uppercase' }}>Category Progress</div>
          {ALL_CATS.map(cat => {
            const t = targets[cat]?.third
            const cur = myTotals[cat] ?? 0
            const isNeg = NEG_CATS.has(cat)
            const { pct, status } = catProgress(cur, t, isNeg)
            const barColor = status==='ok'?'var(--green)':status==='warn'?'var(--yellow)':'var(--red)'
            const fmt = v => v==null?'—':isNeg?v.toFixed(2):cat==='OBP'?v.toFixed(3):Math.round(v)
            return (
              <div key={cat} style={{ marginBottom:7 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                  <span style={{ color:'var(--text2)', fontWeight:600 }}>{cat}</span>
                  <span style={{ color:barColor }}>
                    {fmt(cur)}<span style={{ color:'var(--text3)' }}> / {fmt(t)}</span>
                  </span>
                </div>
                <div className="progress-bar">
                  <div className={`progress-fill progress-${status==='ok'?'green':status==='warn'?'yellow':'red'}`}
                    style={{ width:`${Math.round(pct*100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="card">
          <div style={{ fontWeight:700, fontSize:11, marginBottom:10, color:'var(--text2)',
            letterSpacing:'0.08em', textTransform:'uppercase' }}>Pitcher Roles</div>
          {[
            { label:'Win Contributors', cur:roles.winContributors, target:7, hint:'W≥5 or IP≥100' },
            { label:'Closers (S)',       cur:roles.closers,         target:3, hint:'SV≥8'          },
            { label:'Hold Spec (HD)',    cur:roles.holdSpec,        target:2, hint:'HLD≥8'         },
          ].map(r => {
            const color = r.cur>=r.target?'var(--green)':r.cur>=r.target-1?'var(--yellow)':'var(--red)'
            return (
              <div key={r.label} style={{ display:'flex', justifyContent:'space-between',
                alignItems:'center', marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:12 }}>{r.label}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{r.hint}</div>
                </div>
                <span style={{ color, fontWeight:700, fontSize:15 }}>{r.cur}/{r.target}</span>
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
  const sorted = [...ALL_CATS].sort((a,b) => (gapWeights[b]??1)-(gapWeights[a]??1))
  return (
    <div style={{ padding:12, overflow:'auto' }}>
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>
          📊 Category Dashboard
          <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>
            sorted by urgency · updates live after every pick
          </span>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:16, flexWrap:'wrap' }}>
          <span><b style={{ color:'var(--red)' }}>HIGH</b> = biggest gap, weight the most in rankings</span>
          <span><b style={{ color:'var(--yellow)' }}>MED</b> = approaching — keep an eye on it</span>
          <span><b style={{ color:'var(--green)' }}>OK</b> = on pace for 3rd place or better</span>
          <span>Target = JRH historical 3rd-place threshold for this 10-team league</span>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(255px,1fr))', gap:10 }}>
        {sorted.map(cat => {
          const t = targets[cat]
          const cur = myTotals[cat] ?? 0
          const isNeg = NEG_CATS.has(cat)
          const { pct, status } = catProgress(cur, t?.third, isNeg)
          const w = gapWeights[cat] ?? 1
          const urgency = w>=1.8?'HIGH':w>=1.2?'MED':'OK'
          const uc = urgency==='HIGH'?'var(--red)':urgency==='MED'?'var(--yellow)':'var(--green)'
          const bc = status==='ok'?'var(--green)':status==='warn'?'var(--yellow)':'var(--red)'
          const fmt = v => v==null?'—':isNeg?v.toFixed(2):cat==='OBP'?v.toFixed(3):Math.round(v)
          return (
            <div key={cat} className="card" style={{ borderLeft:`3px solid ${bc}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontWeight:700, fontSize:14 }}>{cat}</span>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:10, color:uc, fontWeight:700,
                    background:`${uc}22`, padding:'1px 5px', borderRadius:3 }}>{urgency}</span>
                  <span style={{ fontSize:10, color:'var(--text3)' }}>wt {w.toFixed(2)}</span>
                </div>
              </div>
              <div className="progress-bar" style={{ height:8, marginBottom:8 }}>
                <div style={{ height:'100%', borderRadius:3, background:bc,
                  width:`${Math.round(pct*100)}%`, transition:'width 0.4s' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:6, fontSize:11 }}>
                {[['Current',fmt(cur),bc],['3rd',fmt(t?.third),'var(--text2)'],
                  ['2nd',fmt(t?.second),'var(--text2)'],['1st',fmt(t?.first),'var(--text2)']].map(([lbl,val,clr])=>(
                  <div key={lbl}>
                    <div style={{ color:'var(--text3)', fontSize:10, marginBottom:2 }}>{lbl}</div>
                    <div style={{ color:clr, fontWeight:lbl==='Current'?700:400 }}>{val}</div>
                  </div>
                ))}
              </div>
              {t?.third && (
                <div style={{ marginTop:6, fontSize:10, color:'var(--text3)' }}>
                  {isNeg
                    ? cur===0?'No pitchers yet':cur>t.third?`↓ Need -${(cur-t.third).toFixed(2)}`:'✓ On track'
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
    <div style={{ padding:12, overflow:'auto' }}>
      <div style={{ marginBottom:12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
          <span style={{ fontSize:13, fontWeight:700 }}>⚡ Best Picks Right Now</span>
          <span style={{ fontSize:11, color:'var(--text3)' }}>Round {round} · Weighted by your category gaps</span>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:16, flexWrap:'wrap' }}>
          <span>Rankings = z-score × gap weight. Players filling your biggest needs rise to the top.</span>
          <span><b style={{ color:'var(--orange)' }}>Role bonus</b> = extra boost when a pitcher role target is at risk.</span>
          <span>Hit <b style={{ color:'var(--blue2)' }}>Draft</b> to add to your roster instantly.</span>
        </div>
      </div>
      {roles.closers < 3 && round > 6 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.closers}/3 closers — Saves are scarce, act soon.
        </div>
      )}
      {roles.holdSpec < 2 && round > 10 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.holdSpec}/2 hold specialists — HD gap growing.
        </div>
      )}
      {roles.winContributors < 4 && round > 8 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.winContributors}/7 win contributors — Wins (W) at risk.
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {recommendations.map((p, i) => (
          <div key={p.id} className={`rec-card ${i===0?'top':''}`}
            onClick={() => onSelectPlayer(p)}
            style={{ display:'flex', gap:12, alignItems:'flex-start', cursor:'pointer' }}>
            <div style={{ minWidth:24, fontSize:18, fontWeight:700,
              color:i===0?'var(--tier1)':'var(--text3)', paddingTop:2 }}>{i+1}</div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                <span style={{ fontWeight:700, fontSize:14 }}>{p.name}</span>
                <span style={{ color:posColor(p.pos), fontWeight:700, fontSize:12 }}>{p.pos}</span>
                <span style={{ color:'var(--text3)', fontSize:11 }}>{p.team}</span>
                {p.urgencyBoost > 0 && (
                  <span style={{ fontSize:10, color:'var(--orange)',
                    background:'rgba(249,115,22,0.15)', padding:'1px 5px', borderRadius:3 }}>
                    +{p.urgencyBoost.toFixed(1)} role bonus
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:10, fontSize:11, color:'var(--text2)', marginBottom:4, flexWrap:'wrap' }}>
                <span>Score: <b style={{ color:'var(--blue2)' }}>{p.liveScore.toFixed(2)}</b></span>
                {p.type==='hitter'
                  ? <><span>R:{Math.round(p.R||0)}</span><span>HR:{Math.round(p.HR||0)}</span><span>RBI:{Math.round(p.RBI||0)}</span><span>SB:{Math.round(p.SB||0)}</span><span>OBP:{(p.OBP||0).toFixed(3)}</span></>
                  : <><span>W:{Math.round(p.W||0)}</span><span>SV:{Math.round(p.SV||0)}</span><span>HLD:{Math.round(p.HLD||0)}</span><span>K:{Math.round(p.SO||0)}</span><span>ERA:{(p.ERA||0).toFixed(2)}</span><span>WHIP:{(p.WHIP||0).toFixed(3)}</span></>
                }
              </div>
              {p.reasons?.map((r, ri) => (
                <div key={ri} style={{ fontSize:11, color:ri===0?'var(--text)':'var(--text3)' }}>
                  {ri===0?'→':'·'} {r}
                </div>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end', flexShrink:0 }}>
              <button className="btn btn-primary btn-sm" onClick={() => onDraftMe(p)}>Draft</button>
              {p.cbsADP && <span style={{ fontSize:10, color:'var(--text3)' }}>CBS {p.cbsADP.toFixed(1)}</span>}
            </div>
          </div>
        ))}
        {recommendations.length===0 && (
          <div style={{ color:'var(--text3)', padding:20, textAlign:'center' }}>
            No available players found.
          </div>
        )}
      </div>
    </div>
  )
}

// ── FULL POOL ─────────────────────────────────────────────────────────────────
function FullPool({ players, search, setSearch, pos, setPos, sortKey, setSort, keeperByPlayerId, selectedPlayer, onSelectPlayer }) {
  const positions = ['ALL','C','1B','2B','3B','SS','OF','SP','RP','CL','SU']
  const sortOpts  = [
    {v:'liveScore',label:'Score'},{v:'FPTS',label:'FPTS'},
    {v:'cbsADP',label:'CBS ADP'},{v:'WAR',label:'WAR'},
    {v:'HR',label:'HR'},{v:'SB',label:'SB'},{v:'W',label:'W'},{v:'SV',label:'SV'},
  ]
  const filtered = useMemo(() => {
    let p = players
    if (pos !== 'ALL') p = p.filter(x => x.pos === pos)
    if (search) {
      const q = search.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q) || x.team.toLowerCase().includes(q))
    }
    const neg = ['cbsADP','ERA','WHIP'].includes(sortKey)
    return [...p].sort((a,b) => {
      const av = a[sortKey] ?? (neg?999:-999)
      const bv = b[sortKey] ?? (neg?999:-999)
      return neg ? av-bv : bv-av
    })
  }, [players, pos, search, sortKey])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'7px 12px', background:'var(--bg2)',
        borderBottom:'1px solid var(--border)',
        display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search…" style={{ width:160 }} />
        <select value={pos} onChange={e => setPos(e.target.value)}>
          {positions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
          {sortOpts.map(s => (
            <button key={s.v} className={`btn btn-sm ${sortKey===s.v?'btn-primary':'btn-ghost'}`}
              onClick={() => setSort(s.v)}>{s.label}</button>
          ))}
        </div>
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text3)' }}>
          {filtered.length} players
        </span>
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th><th>Pos</th><th>Team</th><th>Score</th><th>FPTS</th>
              <th>CBS</th><th>WAR</th><th>R</th><th>H</th><th>HR</th><th>RBI</th>
              <th>SB</th><th>OBP</th><th>W</th><th>SV</th><th>HLD</th><th>K</th>
              <th>ERA</th><th>WHIP</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const kInfo = keeperByPlayerId[p.id]
              return (
                <tr key={p.id} className={p.isMine?'mine':''}
                  onClick={() => onSelectPlayer(p)}
                  style={{
                    ...(p.isKeeper?{opacity:0.5}:p.drafted?{opacity:0.38}:{}),
                    cursor:'pointer',
                    outline: selectedPlayer?.id === p.id ? '1px solid var(--blue)' : 'none',
                    background: selectedPlayer?.id === p.id ? 'rgba(59,130,246,0.08)' : undefined,
                  }}>
                  <td style={{ fontWeight:p.isMine?700:400 }}>
                    {p.name}
                    {kInfo && (
                      <span style={{ marginLeft:5, fontSize:9, color:'var(--yellow)', fontWeight:700 }}>
                        K·R{kInfo.round}
                      </span>
                    )}
                  </td>
                  <td><span style={{ color:posColor(p.pos), fontWeight:600 }}>{p.pos}</span></td>
                  <td style={{ color:'var(--text3)' }}>{p.team}</td>
                  <td style={{ color:'var(--blue2)' }}>{p.isKeeper?'—':p.liveScore?.toFixed(1)}</td>
                  <td>{p.FPTS?Math.round(p.FPTS):'—'}</td>
                  <td>{p.cbsADP?.toFixed(1)??'—'}</td>
                  <td style={{ color:'var(--text2)' }}>{p.WAR?.toFixed(1)??'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.R||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.H||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.HR||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.RBI||0):'—'}</td>
                  <td>{p.type==='hitter'?Math.round(p.SB||0):'—'}</td>
                  <td>{p.type==='hitter'?(p.OBP||0).toFixed(3):'—'}</td>
                  <td style={{ color:p.type==='pitcher'?'var(--text)':'var(--text3)' }}>{p.type==='pitcher'?Math.round(p.W||0):'—'}</td>
                  <td style={{ color:p.type==='pitcher'?'var(--purple)':'var(--text3)' }}>{p.type==='pitcher'?Math.round(p.SV||0):'—'}</td>
                  <td style={{ color:p.type==='pitcher'?'var(--blue2)':'var(--text3)' }}>{p.type==='pitcher'?Math.round(p.HLD||0):'—'}</td>
                  <td>{p.type==='pitcher'?Math.round(p.SO||0):'—'}</td>
                  <td>{p.type==='pitcher'?(p.ERA||0).toFixed(2):'—'}</td>
                  <td>{p.type==='pitcher'?(p.WHIP||0).toFixed(3):'—'}</td>
                  <td>
                    {p.isKeeper
                      ? <span style={{ color:'var(--yellow)', fontSize:10 }}>{p.isMyKeeper?'MY KEEP':'KEPT'}</span>
                      : p.drafted
                        ? <span style={{ color:p.isMine?'var(--blue2)':'var(--text3)', fontSize:10 }}>{p.isMine?'MINE':'GONE'}</span>
                        : <span style={{ color:'var(--green)', fontSize:10 }}>AVAIL</span>
                    }
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

// ── IMPORT MODAL ──────────────────────────────────────────────────────────────
function ImportModal({ text, setText, msg, setMsg, onParse, onClose, myCount }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>Import Round</div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
              {myCount} picks imported · Your team: <span style={{ color:'var(--blue2)' }}>{MY_TEAM}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize:11, color:'var(--text2)', marginBottom:6 }}>
          Paste your FantasyPros round results below
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
          placeholder={`Team Name\n1.10\nPlayer Name\nPos\nTeam\nEdit\n...`}
          style={{ width:'100%', fontFamily:'monospace', fontSize:11, marginBottom:10 }}
        />
        {msg && (
          <div className={`alert ${msg.startsWith('✅')?'alert-ok':'alert-warn'}`}
            style={{ marginBottom:10 }}>{msg}</div>
        )}
        <div style={{ fontSize:10, color:'var(--text3)', marginBottom:12 }}>
          After each round on FantasyPros, copy all picks and paste here.
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onParse}>Parse Round</button>
        </div>
      </div>
    </div>
  )
}

// ── PLAYER PANEL ──────────────────────────────────────────────────────────────
function PlayerPanel({ player, onClose, onDraftMe, onDraftOther, onUndraft,
                       keeperByPlayerId, gapWeights, targets, scoredPlayers }) {
  const isH    = player.type === 'hitter'
  const kInfo  = keeperByPlayerId[player.id]
  const isNeg  = cat => ['ERA','WHIP'].includes(cat)

  // Board rank among undrafted non-keepers
  const boardRank = useMemo(() => {
    const avail = scoredPlayers.filter(p => !p.drafted && !p.isKeeper)
    const sorted = [...avail].sort((a,b) => b.liveScore - a.liveScore)
    const idx = sorted.findIndex(p => p.id === player.id)
    return idx >= 0 ? idx + 1 : null
  }, [scoredPlayers, player.id])

  // Score breakdown from liveBreakdown
  const breakdown = player.liveBreakdown ?? {}
  const cats = isH ? ['R','H','HR','RBI','SB','OBP'] : ['W','S','HD','K','ERA','WHIP']

  const edge = player.cbsADP && boardRank
    ? Math.round(boardRank - player.cbsADP) : null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:40 }}
      />

      {/* Panel */}
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, width:320,
        background:'var(--bg2)', borderLeft:'1px solid var(--border2)',
        zIndex:50, display:'flex', flexDirection:'column',
        boxShadow:'-8px 0 32px rgba(0,0,0,0.4)',
        animation: 'slideIn 0.18s ease-out',
      }}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>

        {/* Panel header */}
        <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4 }}>
                <span style={{
                  fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:3,
                  background: isH ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
                  color: isH ? 'var(--green)' : 'var(--blue2)',
                  border: `1px solid ${isH ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
                }}>
                  {isH ? 'HITTER' : player.pos === 'CL' ? 'CLOSER' : player.pos === 'SP' ? 'STARTER' : 'RELIEVER'}
                </span>
                {kInfo && (
                  <span style={{ fontSize:10, fontWeight:700, color:'var(--yellow)',
                    background:'rgba(251,191,36,0.12)', padding:'2px 6px', borderRadius:3,
                    border:'1px solid rgba(251,191,36,0.3)' }}>
                    KEPT R{kInfo.round} · {kInfo.team}
                  </span>
                )}
              </div>
              <div style={{ fontSize:18, fontWeight:700, color:'var(--text)', lineHeight:1.2 }}>
                {player.name}
              </div>
              <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
                <span style={{ color: posColor(player.pos), fontWeight:700 }}>{player.pos}</span>
                {' · '}{player.team}
              </div>
            </div>
            <button onClick={onClose} style={{
              background:'none', border:'none', color:'var(--text3)',
              fontSize:18, cursor:'pointer', padding:'0 4px', lineHeight:1,
            }}>✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* Rank + Score + CBS */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <StatBox label="Board Rank" value={boardRank ? `#${boardRank}` : kInfo ? 'KEPT' : '—'}
              color={boardRank && boardRank <= 20 ? 'var(--tier1)' : boardRank && boardRank <= 50 ? 'var(--tier2)' : 'var(--text)'} />
            <StatBox label="Score" value={player.liveScore?.toFixed(2) ?? '—'} color="var(--blue2)" />
            <StatBox label="Tier" value={player.tier ? `T${player.tier}` : '—'} color={tierColor(player.tier ?? 5)} />
          </div>

          {/* CBS ADP + Edge */}
          {(player.cbsADP || edge != null) && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <StatBox label="CBS ADP" value={player.cbsADP?.toFixed(1) ?? '—'} color="var(--text2)" />
              <StatBox
                label="Edge vs CBS"
                value={edge != null ? (edge > 0 ? `+${edge}` : `${edge}`) : '—'}
                color={edge == null ? 'var(--text3)' : edge > 5 ? 'var(--green)' : edge < -5 ? 'var(--red)' : 'var(--text2)'}
                hint={edge > 5 ? 'Value pick' : edge < -5 ? 'Reaching' : 'Near consensus'}
              />
            </div>
          )}

          {/* Score Breakdown */}
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em',
              textTransform:'uppercase', color:'var(--text3)', marginBottom:8 }}>
              Score Breakdown
            </div>
            {cats.map(cat => {
              const bd    = breakdown[cat] ?? {}
              const z     = bd.z ?? 0
              const w     = bd.w ?? (gapWeights[cat] ?? 1)
              const contrib = bd.contribution ?? (z * w)
              const barMax = 4
              const barW  = Math.min(100, Math.abs(contrib) / barMax * 100)
              const isPos = contrib >= 0
              return (
                <div key={cat} style={{ marginBottom:7 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                    <span style={{ color:'var(--text2)', fontWeight:600 }}>{cat}</span>
                    <div style={{ display:'flex', gap:10, color:'var(--text3)', fontSize:10 }}>
                      <span>z={z.toFixed(2)}</span>
                      <span>wt={w.toFixed(2)}</span>
                      <span style={{ color: isPos ? 'var(--green)' : 'var(--red)', fontWeight:700 }}>
                        {isPos ? '+' : ''}{contrib.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div style={{ height:4, background:'var(--bg3)', borderRadius:2 }}>
                    <div style={{
                      height:'100%', borderRadius:2, width:`${barW}%`,
                      background: isPos ? 'var(--green)' : 'var(--red)',
                      marginLeft: isPos ? 0 : `${100 - barW}%`,
                    }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Projected Stats */}
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em',
              textTransform:'uppercase', color:'var(--text3)', marginBottom:8 }}>
              Projected Stats
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {isH ? [
                ['Runs (R)', Math.round(player.R ?? 0)],
                ['Hits (H)', Math.round(player.H ?? 0)],
                ['Home Runs (HR)', Math.round(player.HR ?? 0)],
                ['RBI', Math.round(player.RBI ?? 0)],
                ['Stolen Bases (SB)', Math.round(player.SB ?? 0)],
                ['OBP', (player.OBP ?? 0).toFixed(3)],
                ['PA', Math.round(player.PA ?? 0)],
                ['WAR', (player.WAR ?? 0).toFixed(1)],
              ] : [
                ['Wins (W)', Math.round(player.W ?? 0)],
                ['Saves (SV)', Math.round(player.SV ?? 0)],
                ['Holds (HLD)', Math.round(player.HLD ?? 0)],
                ['Strikeouts (K)', Math.round(player.SO ?? 0)],
                ['ERA', (player.ERA ?? 0).toFixed(2)],
                ['WHIP', (player.WHIP ?? 0).toFixed(3)],
                ['IP', Math.round(player.IP ?? 0)],
                ['WAR', (player.WAR ?? 0).toFixed(1)],
              ].map(([lbl, val]) => (
                <div key={lbl} style={{ background:'var(--bg3)', borderRadius:4, padding:'6px 10px' }}>
                  <div style={{ fontSize:10, color:'var(--text3)', marginBottom:2 }}>{lbl}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Category targets context */}
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em',
              textTransform:'uppercase', color:'var(--text3)', marginBottom:8 }}>
              vs Your Targets
            </div>
            {cats.filter(cat => !isNeg(cat)).map(cat => {
              const t3  = targets[cat]?.third
              const val = isH
                ? { R: player.R, H: player.H, HR: player.HR, RBI: player.RBI, SB: player.SB, OBP: player.OBP }[cat]
                : { W: player.W, S: player.SV, HD: player.HLD, K: player.SO }[cat]
              if (!t3 || val == null) return null
              const pct = Math.min(1.2, val / t3)
              const fmt = v => cat === 'OBP' ? v.toFixed(3) : Math.round(v)
              return (
                <div key={cat} style={{ marginBottom:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                    <span style={{ color:'var(--text2)' }}>{cat} contribution</span>
                    <span style={{ color:'var(--text3)' }}>{fmt(val)} of {fmt(t3)} needed</span>
                  </div>
                  <div style={{ height:4, background:'var(--bg3)', borderRadius:2 }}>
                    <div style={{
                      height:'100%', borderRadius:2,
                      background: pct >= 0.15 ? 'var(--green)' : pct >= 0.08 ? 'var(--yellow)' : 'var(--red)',
                      width:`${Math.round(pct * 100)}%`,
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:8 }}>
          {player.isKeeper ? (
            <div style={{ textAlign:'center', color:'var(--yellow)', fontSize:12, fontWeight:700, padding:'8px 0' }}>
              🔒 Keeper — already on roster
            </div>
          ) : player.drafted ? (
            <>
              <div style={{ textAlign:'center', fontSize:12, color:'var(--text3)', marginBottom:4 }}>
                {player.isMine ? 'On your roster' : 'Drafted by another team'}
              </div>
              <button className="btn btn-ghost" style={{ width:'100%', justifyContent:'center' }}
                onClick={() => onUndraft(player.id)}>
                ↩ Undo Draft
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'9px 0', fontSize:13 }}
                onClick={() => onDraftMe(player)}>
                + Add to my team
              </button>
              <button className="btn btn-ghost" style={{ width:'100%', justifyContent:'center' }}
                onClick={() => onDraftOther(player)}>
                Mark drafted by others (off board)
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function StatBox({ label, value, color, hint }) {
  return (
    <div style={{ background:'var(--bg3)', borderRadius:4, padding:'8px 10px', textAlign:'center' }}>
      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:17, fontWeight:700, color: color ?? 'var(--text)' }}>{value}</div>
      {hint && <div style={{ fontSize:9, color:'var(--text3)', marginTop:2 }}>{hint}</div>}
    </div>
  )
}
