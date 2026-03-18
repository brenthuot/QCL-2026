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
      const typeScale = p.type === 'hitter'
        ? hitW * 2
        : pitW * 2 * (p.pos === 'SP' ? pitCompress : 1)
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
            />
          )}
          {tab === 'pool' && (
            <FullPool players={scoredPlayers}
              search={poolSearch} setSearch={setPoolSearch}
              pos={poolPos} setPos={setPoolPos}
              sortKey={poolSort} setSort={setPoolSort}
              keeperByPlayerId={keeperByPlayerId}
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
    </div>
  )
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function AppHeader({ round, myCount, draftedTotal, onImport, onReset, tab, setTab }) {
  const tabs = [
    { id:'board', label:'🎯 Draft Board' },
    { id:'team',  label:'👤 My Team'     },
    { id:'cats',  label:'📊 Categories'  },
    { id:'rec',   label:'⚡ Recs'        },
    { id:'pool',  label:'🔍 Full Pool'   },
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
          <button className="btn btn-primary btn-sm" onClick={onImport}>📥 Import Round</button>
          <button className="btn btn-ghost btn-sm" onClick={onReset}>↺ Reset</button>
        </div>
      </div>
      <div className="tab-nav" style={{ padding:'0 14px' }}>
        {tabs.map(t => (
          <div key={t.id} className={`tab-item ${tab===t.id?'active':''}`}
            onClick={() => setTab(t.id)}>{t.label}</div>
        ))}
      </div>
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
      <div style={{ padding:'5px 12px 0', fontSize:10, color:'var(--text3)' }}>
        All rankings update instantly as you adjust settings.
      </div>

      {/* Live Diagnostics */}
      <SidebarSection title="Live Diagnostics">
        <DiagRow label="SP in Top 20"  val={diagnostics.spIn20}  lo={3}  hi={5}  />
        <DiagRow label="SP in Top 50"  val={diagnostics.spIn50}  lo={10} hi={16} />
        <DiagRow label="SP in Top 100" val={diagnostics.spIn100} lo={22} hi={30} />
        <DiagRow label="CL in Top 20"  val={diagnostics.clIn20}  lo={1}  hi={3}  />
        <DiagRow label="CL in Top 50"  val={diagnostics.clIn50}  lo={3}  hi={6}  />
        <DiagRow label="RP in Top 50"  val={diagnostics.rpIn50}  lo={5}  hi={10} />
      </SidebarSection>

      {/* My Keepers */}
      <SidebarSection title="My Keepers">
        {MY_KEEPERS.map(k => (
          <div key={k.name} style={{ display:'flex', justifyContent:'space-between',
            padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ color:'var(--text)', fontSize:11 }}>{k.name}</span>
            <span style={{ color:'var(--yellow)', fontSize:10, fontWeight:700 }}>R{k.round}</span>
          </div>
        ))}
      </SidebarSection>

      {/* Weights */}
      <SidebarSection title="Weights">
        <SliderRow label="Hitter weight" value={hitWeight} min={30} max={75} step={1}
          display={`${hitWeight}%`} onChange={setHitWeight} />
        <div style={{ fontSize:10, color:'var(--text3)', marginBottom:8 }}>
          Pitcher weight (auto): {100 - hitWeight}%
        </div>
        <SliderRow label="Pitcher compression" value={pitCompress} min={0.60} max={1.10} step={0.05}
          display={pitCompress.toFixed(2)} onChange={setPitCompress}
          hint="Lower = fewer SP dominating top of board" />
        <SliderRow label="Gap sensitivity" value={gapSensitivity} min={0.5} max={2.0} step={0.1}
          display={gapSensitivity.toFixed(1)} onChange={setGapSensitivity}
          hint="How strongly category gaps shift rankings" />
        <button className="btn btn-ghost btn-sm" style={{ width:'100%', marginTop:4, fontSize:10 }}
          onClick={() => { setHitWeight(50); setPitCompress(0.85); setGapSensitivity(1.0) }}>
          Reset to defaults
        </button>
      </SidebarSection>

      {/* Pitcher Roles */}
      <SidebarSection title="Pitcher Roles">
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

function SidebarSection({ title, children }) {
  return (
    <div style={{ borderBottom:'1px solid var(--border)' }}>
      <div style={{ padding:'8px 12px 4px', fontSize:10, fontWeight:700,
        letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text3)' }}>
        {title}
      </div>
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
                  style={p.isKeeper ? { opacity:0.42 } : p.drafted ? { opacity:0.35 } : {}}
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
  return (
    <div style={{ padding:12, display:'grid', gap:12,
      gridTemplateColumns:'1fr 1fr', overflow:'auto' }}>
      <div>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>
          My Roster — {myPlayers.length}/24
        </div>
        {myPlayers.length === 0 && (
          <div style={{ color:'var(--text3)', fontSize:12 }}>No picks yet.</div>
        )}
        {myPlayers.map((p, i) => {
          const isK = keeperIds.has(p.id)
          return (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8,
              padding:'5px 8px', borderBottom:'1px solid var(--border)',
              background: isK ? 'rgba(251,191,36,0.04)' : 'transparent' }}>
              <span style={{ color:'var(--text3)', fontSize:11, minWidth:20 }}>{i+1}.</span>
              <span style={{ color:posColor(p.pos), fontWeight:700, fontSize:11, minWidth:28 }}>{p.pos}</span>
              <span style={{ flex:1, fontSize:12 }}>{p.name}</span>
              {isK && <span style={{ fontSize:9, color:'var(--yellow)', fontWeight:700,
                background:'rgba(251,191,36,0.12)', padding:'1px 5px', borderRadius:2 }}>KEPT</span>}
              <span style={{ fontSize:10, color:'var(--text3)' }}>{p.team}</span>
              {!isK && (
                <button className="btn btn-sm btn-ghost" style={{ fontSize:9, padding:'1px 5px' }}
                  onClick={() => onUndraft(p.id)}>✕</button>
              )}
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
      <div style={{ marginBottom:10, fontSize:13, fontWeight:700 }}>
        Category Dashboard
        <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>
          sorted by urgency · updates live after every pick
        </span>
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
function Recommendations({ recommendations, round, roles, onDraftMe }) {
  return (
    <div style={{ padding:12, overflow:'auto' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:700 }}>⚡ Best Picks Right Now</span>
        <span style={{ fontSize:11, color:'var(--text3)' }}>Round {round} · Weighted by category gaps</span>
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
            style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
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
function FullPool({ players, search, setSearch, pos, setPos, sortKey, setSort, keeperByPlayerId }) {
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
                  style={p.isKeeper?{opacity:0.5}:p.drafted?{opacity:0.38}:{}}>
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
