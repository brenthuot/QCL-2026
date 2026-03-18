'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  HIT_CATS, PIT_CATS, ALL_CATS, NEG_CATS, CAT_KEY,
  computeGapWeights, computeLiveScore, assignTiers,
  computeTeamTotals, catProgress, rosterRoles,
  buildRecommendations, fmtStat, posColor, tierColor,
} from '../lib/scoring'
import { parseFantasyProsRound, matchPlayer } from '../lib/parser'

const LS_KEY = 'qcl2026_draft_v1'
const MY_TEAM = 'numbahs'

// ── ROSTER SLOT DEFINITIONS ──────────────────────────────────────────────────
const ROSTER_SLOTS = [
  { id: 'C',     label: 'C',     eligible: ['C'],                    type: 'hitter' },
  { id: '1B',    label: '1B',    eligible: ['1B'],                   type: 'hitter' },
  { id: '2B',    label: '2B',    eligible: ['2B'],                   type: 'hitter' },
  { id: '3B',    label: '3B',    eligible: ['3B'],                   type: 'hitter' },
  { id: 'SS',    label: 'SS',    eligible: ['SS'],                   type: 'hitter' },
  { id: 'OF1',   label: 'OF',    eligible: ['OF'],                   type: 'hitter' },
  { id: 'OF2',   label: 'OF',    eligible: ['OF'],                   type: 'hitter' },
  { id: 'OF3',   label: 'OF',    eligible: ['OF'],                   type: 'hitter' },
  { id: 'OF4',   label: 'OF',    eligible: ['OF'],                   type: 'hitter' },
  { id: 'UTIL1', label: 'UTIL',  eligible: ['C','1B','2B','3B','SS','OF'], type: 'hitter' },
  { id: 'UTIL2', label: 'UTIL',  eligible: ['C','1B','2B','3B','SS','OF'], type: 'hitter' },
  { id: 'UTIL3', label: 'UTIL',  eligible: ['C','1B','2B','3B','SS','OF'], type: 'hitter' },
  { id: 'SP1',   label: 'SP',    eligible: ['SP'],                   type: 'pitcher' },
  { id: 'SP2',   label: 'SP',    eligible: ['SP'],                   type: 'pitcher' },
  { id: 'SP3',   label: 'SP',    eligible: ['SP'],                   type: 'pitcher' },
  { id: 'SP4',   label: 'SP',    eligible: ['SP'],                   type: 'pitcher' },
  { id: 'RP1',   label: 'RP',    eligible: ['SP','RP','CL','SU'],    type: 'pitcher' },
  { id: 'RP2',   label: 'RP',    eligible: ['SP','RP','CL','SU'],    type: 'pitcher' },
  { id: 'RP3',   label: 'RP',    eligible: ['SP','RP','CL','SU'],    type: 'pitcher' },
  { id: 'SPRP1', label: 'SP/RP', eligible: ['SP','RP','CL','SU'],    type: 'pitcher' },
  { id: 'SPRP2', label: 'SP/RP', eligible: ['SP','RP','CL','SU'],    type: 'pitcher' },
  { id: 'BN1',   label: 'BN',    eligible: ['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], type: 'any' },
  { id: 'BN2',   label: 'BN',    eligible: ['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], type: 'any' },
  { id: 'BN3',   label: 'BN',    eligible: ['C','1B','2B','3B','SS','OF','SP','RP','CL','SU'], type: 'any' },
]

export default function App() {
  const [hitters, setHitters] = useState([])
  const [pitchers, setPitchers] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState('board')
  const [posFilter, setPosFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [showDrafted, setShowDrafted] = useState(false)
  const [boardLimit, setBoardLimit] = useState(150)

  // Full pool state
  const [poolSearch, setPoolSearch] = useState('')
  const [poolPos, setPoolPos] = useState('ALL')
  const [poolSort, setPoolSort] = useState('FPTS')

  // Draft state
  const [draftedIds, setDraftedIds] = useState(new Set()) // all drafted (any team)
  const [myPlayerIds, setMyPlayerIds] = useState([])      // my picks in order
  const [round, setRound] = useState(1)

  // Import modal
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState('')

  // Reset confirm
  const [showReset, setShowReset] = useState(false)

  // Load data
  useEffect(() => {
    Promise.all([
      fetch('/hitters.json').then(r => r.json()),
      fetch('/pitchers.json').then(r => r.json()),
      fetch('/config.json').then(r => r.json()),
    ]).then(([h, p, c]) => {
      setHitters(h)
      setPitchers(p)
      setConfig(c)
      setLoading(false)

      // Restore draft state
      try {
        const saved = localStorage.getItem(LS_KEY)
        if (saved) {
          const { drafted, mine, roundNum } = JSON.parse(saved)
          setDraftedIds(new Set(drafted || []))
          setMyPlayerIds(mine || [])
          setRound(roundNum || 1)
        }
      } catch {}
    })
  }, [])

  // Persist draft state
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
  const targets = config?.targets ?? {}

  const gapWeights = useMemo(() =>
    computeGapWeights(myTotals, targets, round),
  [myTotals, targets, round])

  // Score and tier all players
  const scoredPlayers = useMemo(() => {
    const all = allPlayers.map(p => ({
      ...p,
      drafted: draftedIds.has(p.id),
      isMine: myPlayerIds.includes(p.id),
      ...computeLiveScore(p, gapWeights),
    }))
    return assignTiers(all, 'liveScore')
  }, [allPlayers, draftedIds, myPlayerIds, gapWeights])

  const roles = useMemo(() => rosterRoles(myPlayers), [myPlayers])

  const recommendations = useMemo(() =>
    buildRecommendations(
      scoredPlayers.filter(p => !p.drafted),
      myPlayers, targets, round, myTotals, gapWeights
    ).slice(0, 8),
  [scoredPlayers, myPlayers, targets, round, myTotals, gapWeights])

  // Actions
  const markDrafted = useCallback((player, isMine = false) => {
    setDraftedIds(prev => new Set([...prev, player.id]))
    if (isMine) {
      setMyPlayerIds(prev => [...prev, player.id])
      setRound(Math.ceil((myPlayerIds.length + 1) / 1) || 1)
    }
    // Auto-advance round
    setRound(prev => {
      const totalDrafted = draftedIds.size + 1
      return Math.floor(totalDrafted / 10) + 1
    })
  }, [draftedIds, myPlayerIds])

  const undraftPlayer = useCallback((id) => {
    setDraftedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    setMyPlayerIds(prev => prev.filter(pid => pid !== id))
  }, [])

  const handleImport = useCallback(() => {
    const picks = parseFantasyProsRound(importText, MY_TEAM)
    if (picks.length === 0) {
      setImportMsg('⚠ No picks found. Check format — each pick needs 6 lines.')
      return
    }

    let matched = 0, mine = 0, unmatched = []
    const newDrafted = new Set(draftedIds)
    const newMine = [...myPlayerIds]

    for (const pick of picks) {
      const player = matchPlayer(pick.playerName, allPlayers)
      if (!player) { unmatched.push(pick.playerName); continue }
      if (!newDrafted.has(player.id)) {
        newDrafted.add(player.id)
        matched++
        if (pick.isMine && !newMine.includes(player.id)) {
          newMine.push(player.id)
          mine++
        }
      }
    }

    setDraftedIds(newDrafted)
    setMyPlayerIds(newMine)
    setRound(picks.length > 0 ? Math.max(...picks.map(p => p.round)) + 1 : round)
    setImportMsg(`✅ Imported ${matched} picks (${mine} yours). ${unmatched.length > 0 ? `Unmatched: ${unmatched.slice(0,5).join(', ')}` : ''}`)
    setImportText('')
  }, [importText, draftedIds, myPlayerIds, allPlayers, round])

  const resetDraft = useCallback(() => {
    setDraftedIds(new Set())
    setMyPlayerIds([])
    setRound(1)
    setShowReset(false)
    localStorage.removeItem(LS_KEY)
  }, [])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)', fontSize:14 }}>
      <span>⚾ Loading QCL 2026...</span>
    </div>
  )

  const picksLeft = 24 - myPlayers.length
  const isMyTurn = round <= 24 && (round % 2 === 0 ? (11 - (round * 10 - 9 + 9)) <= 0 : true) // approximate

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      {/* HEADER */}
      <Header
        round={round} myCount={myPlayers.length} picksLeft={picksLeft}
        draftedTotal={draftedIds.size}
        onImport={() => setShowImport(true)}
        onReset={() => setShowReset(true)}
      />

      {/* TABS */}
      <div className="tab-nav">
        {[
          { id:'board', label:'🎯 Draft Board' },
          { id:'team',  label:'👤 My Team' },
          { id:'cats',  label:'📊 Categories' },
          { id:'rec',   label:'⚡ Recommendations' },
          { id:'pool',  label:'🔍 Full Pool' },
        ].map(t => (
          <div key={t.id} className={`tab-item ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* BODY */}
      <div style={{ flex:1, overflow:'auto', padding:'0' }}>
        {tab === 'board' && (
          <DraftBoard
            players={scoredPlayers} myPlayerIds={myPlayerIds}
            posFilter={posFilter} setPosFilter={setPosFilter}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            search={search} setSearch={setSearch}
            showDrafted={showDrafted} setShowDrafted={setShowDrafted}
            boardLimit={boardLimit} setBoardLimit={setBoardLimit}
            onDraftMe={p => markDrafted(p, true)}
            onDraftOther={p => markDrafted(p, false)}
            onUndraft={id => undraftPlayer(id)}
            targets={targets} round={round}
          />
        )}
        {tab === 'team' && (
          <MyTeam
            myPlayers={myPlayers} myTotals={myTotals}
            targets={targets} roles={roles}
            onUndraft={id => undraftPlayer(id)}
            round={round}
          />
        )}
        {tab === 'cats' && (
          <CategoryDashboard
            myTotals={myTotals} targets={targets}
            gapWeights={gapWeights} myCount={myPlayers.length}
          />
        )}
        {tab === 'rec' && (
          <Recommendations
            recommendations={recommendations} myTotals={myTotals}
            targets={targets} round={round} roles={roles}
            onDraftMe={p => markDrafted(p, true)}
          />
        )}
        {tab === 'pool' && (
          <FullPool
            players={scoredPlayers}
            search={poolSearch} setSearch={setPoolSearch}
            pos={poolPos} setPos={setPoolPos}
            sortKey={poolSort} setSort={setPoolSort}
          />
        )}
      </div>

      {/* IMPORT MODAL */}
      {showImport && (
        <ImportModal
          text={importText} setText={setImportText}
          msg={importMsg} setMsg={setImportMsg}
          onParse={handleImport}
          onClose={() => { setShowImport(false); setImportMsg('') }}
          myCount={myPlayers.length}
        />
      )}

      {/* RESET CONFIRM */}
      {showReset && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth:340 }}>
            <p style={{ marginBottom:16, color:'var(--text)' }}>Reset all draft picks? This cannot be undone.</p>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowReset(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={resetDraft}>Reset Draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ round, myCount, picksLeft, draftedTotal, onImport, onReset }) {
  return (
    <div className="app-header">
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <span style={{ fontSize:15, fontWeight:700, color:'var(--blue2)', letterSpacing:'0.05em' }}>
          ⚾ QCL 2026
        </span>
        <span style={{ color:'var(--text3)', fontSize:11 }}>
          Round {round} · {draftedTotal} drafted · {myCount}/24 my picks · {picksLeft} left
        </span>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button className="btn btn-primary btn-sm" onClick={onImport}>📥 Import Round</button>
        <button className="btn btn-ghost btn-sm" onClick={onReset}>↺ Reset</button>
      </div>
    </div>
  )
}

// ── DRAFT BOARD ───────────────────────────────────────────────────────────────
function DraftBoard({
  players, myPlayerIds, posFilter, setPosFilter, typeFilter, setTypeFilter,
  search, setSearch, showDrafted, setShowDrafted, boardLimit, setBoardLimit,
  onDraftMe, onDraftOther, onUndraft, targets, round
}) {
  const positions = ['ALL','C','1B','2B','3B','SS','OF','SP','RP','CL','SU']

  const filtered = useMemo(() => {
    let p = players
    if (!showDrafted) p = p.filter(x => !x.drafted)
    if (typeFilter === 'H') p = p.filter(x => x.type === 'hitter')
    if (typeFilter === 'P') p = p.filter(x => x.type === 'pitcher')
    if (posFilter !== 'ALL') p = p.filter(x => x.pos === posFilter)
    if (search) {
      const q = search.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q) || x.team.toLowerCase().includes(q))
    }
    return p.slice(0, boardLimit)
  }, [players, showDrafted, typeFilter, posFilter, search, boardLimit])

  const topScore = players.find(p => !p.drafted)?.liveScore ?? 1

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Filters */}
      <div style={{ padding:'8px 12px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search player or team…" style={{ width:180 }}
        />
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPosFilter('ALL') }}>
          <option value="ALL">All Types</option>
          <option value="H">Hitters</option>
          <option value="P">Pitchers</option>
        </select>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {positions.map(pos => (
            <button
              key={pos}
              className={`btn btn-sm ${posFilter===pos?'btn-primary':'btn-ghost'}`}
              style={{ minWidth:36 }}
              onClick={() => setPosFilter(pos)}
            >{pos}</button>
          ))}
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text2)', marginLeft:'auto', cursor:'pointer' }}>
          <input type="checkbox" checked={showDrafted} onChange={e => setShowDrafted(e.target.checked)} />
          Show drafted
        </label>
      </div>

      {/* Table */}
      <div style={{ flex:1, overflow:'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width:32 }}>#</th>
              <th style={{ width:28 }}>T</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Score</th>
              <th>Tier</th>
              <th>CBS</th>
              <th>Edge</th>
              {/* Hitter stats */}
              <th>R</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th><th>OBP</th>
              {/* Pitcher stats */}
              <th>W</th><th>S</th><th>HD</th><th>K</th><th>ERA</th><th>WHIP</th>
              <th style={{ width:80 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => {
              const isMine = myPlayerIds.includes(p.id)
              const edge = p.cbsADP && p.liveScore > -50
                ? Math.round((players.filter(x=>!x.drafted).indexOf(p) + 1) - p.cbsADP)
                : null
              return (
                <tr
                  key={p.id}
                  className={`${p.drafted?'drafted':''} ${isMine?'mine':''} ${p.tierBreak?'tier-break':''}`}
                >
                  <td style={{ color:'var(--text3)', fontSize:11 }}>{idx + 1}</td>
                  <td>
                    <span style={{ fontSize:10, fontWeight:700,
                      color: p.type==='hitter'?'var(--green)':p.pos==='CL'?'var(--purple)':'var(--blue2)' }}>
                      {p.type==='hitter'?'H':p.pos==='CL'?'CL':'P'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: isMine ? 700 : 400, color: isMine ? 'var(--blue2)' : 'var(--text)' }}>
                      {p.name}
                    </span>
                    {isMine && <span style={{ marginLeft:4, fontSize:9, color:'var(--blue)', background:'rgba(59,130,246,0.15)', padding:'1px 4px', borderRadius:2 }}>MINE</span>}
                  </td>
                  <td><span style={{ color: posColor(p.pos), fontWeight:600 }}>{p.pos}</span></td>
                  <td style={{ color:'var(--text3)' }}>{p.team}</td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <div style={{ width:50, height:4, background:'var(--bg3)', borderRadius:2 }}>
                        <div style={{
                          height:'100%', borderRadius:2, background: tierColor(p.tier),
                          width: `${Math.max(0, Math.min(100, (p.liveScore / (topScore || 1)) * 100))}%`
                        }} />
                      </div>
                      <span style={{ fontSize:11, color:'var(--text2)' }}>{p.liveScore?.toFixed(1)}</span>
                    </div>
                  </td>
                  <td><span style={{ color: tierColor(p.tier), fontSize:11, fontWeight:700 }}>T{p.tier}</span></td>
                  <td style={{ color:'var(--text3)', fontSize:11 }}>{p.cbsADP ? p.cbsADP.toFixed(1) : '—'}</td>
                  <td style={{ color: edge != null ? (edge > 0 ? 'var(--green)' : edge < -3 ? 'var(--red)' : 'var(--text3)') : 'var(--text3)', fontSize:11 }}>
                    {edge != null ? (edge > 0 ? `+${edge}` : edge) : '—'}
                  </td>
                  {/* Hitter stats */}
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? Math.round(p.R||0) : '—'}</td>
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? Math.round(p.H||0) : '—'}</td>
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? Math.round(p.HR||0) : '—'}</td>
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? Math.round(p.RBI||0) : '—'}</td>
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? Math.round(p.SB||0) : '—'}</td>
                  <td style={{ color: p.type==='hitter' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='hitter' ? (p.OBP||0).toFixed(3) : '—'}</td>
                  {/* Pitcher stats */}
                  <td style={{ color: p.type==='pitcher' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.W||0) : '—'}</td>
                  <td style={{ color: p.type==='pitcher' ? 'var(--purple)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.SV||0) : '—'}</td>
                  <td style={{ color: p.type==='pitcher' ? 'var(--blue2)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.HLD||0) : '—'}</td>
                  <td style={{ color: p.type==='pitcher' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.SO||0) : '—'}</td>
                  <td style={{ color: p.type==='pitcher' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='pitcher' ? (p.ERA||0).toFixed(2) : '—'}</td>
                  <td style={{ color: p.type==='pitcher' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='pitcher' ? (p.WHIP||0).toFixed(3) : '—'}</td>
                  <td>
                    {p.drafted ? (
                      <button className="btn btn-sm btn-ghost" style={{ fontSize:10 }} onClick={() => onUndraft(p.id)}>Undo</button>
                    ) : (
                      <div style={{ display:'flex', gap:3 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => onDraftMe(p)} title="Draft to my team">Mine</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => onDraftOther(p)} title="Mark drafted by other team">–</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {boardLimit < players.filter(p => showDrafted || !p.drafted).length && (
          <div style={{ padding:12, textAlign:'center' }}>
            <button className="btn btn-ghost" onClick={() => setBoardLimit(b => b + 100)}>
              Show more players
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MY TEAM ───────────────────────────────────────────────────────────────────
function MyTeam({ myPlayers, myTotals, targets, roles, onUndraft, round }) {
  const hitters = myPlayers.filter(p => p.type === 'hitter')
  const pitchers = myPlayers.filter(p => p.type === 'pitcher')

  // Snake turn alert
  const nextPicks = []
  const pick10 = round <= 24 && (round % 2 === 1 && round > 1) // rough approximation
  const isTurn = myPlayers.length < 24

  return (
    <div style={{ padding:12, display:'grid', gap:12, gridTemplateColumns:'1fr 1fr' }}>
      {/* Left: Roster */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ fontWeight:700, color:'var(--text)', fontSize:13 }}>My Roster — {myPlayers.length}/24</span>
          {round === 1 && myPlayers.length === 0 && (
            <span className="badge" style={{ background:'rgba(251,191,36,0.15)', color:'var(--tier1)', border:'1px solid rgba(251,191,36,0.3)' }}>
              Picking 10th · Snake Turn at 10+11
            </span>
          )}
        </div>

        {/* Hitters */}
        <div style={{ fontSize:11, color:'var(--text3)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2 }}>Hitters ({hitters.length}/15)</div>
        {ROSTER_SLOTS.filter(s => s.type === 'hitter').map(slot => {
          // Find player that fits this slot
          const filled = hitters.find(p => p._slot === slot.id) || null
          return <RosterSlotRow key={slot.id} slot={slot} players={hitters} myPlayers={myPlayers} onUndraft={onUndraft} />
        })}

        {/* Pitchers */}
        <div style={{ fontSize:11, color:'var(--text3)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2, marginTop:8 }}>Pitchers ({pitchers.length}/9)</div>
        {ROSTER_SLOTS.filter(s => s.type === 'pitcher').map(slot => (
          <RosterSlotRow key={slot.id} slot={slot} players={pitchers} myPlayers={myPlayers} onUndraft={onUndraft} />
        ))}

        {/* Bench */}
        <div style={{ fontSize:11, color:'var(--text3)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2, marginTop:8 }}>Bench (3)</div>
        {ROSTER_SLOTS.filter(s => s.id.startsWith('BN')).map(slot => (
          <RosterSlotRow key={slot.id} slot={slot} players={myPlayers} myPlayers={myPlayers} onUndraft={onUndraft} />
        ))}
      </div>

      {/* Right: Stats + Roles */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {/* Category Totals */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:12, marginBottom:10, color:'var(--text2)' }}>CATEGORY PROGRESS</div>
          {ALL_CATS.map(cat => {
            const t = targets[cat]?.third
            const cur = myTotals[cat] ?? 0
            const isNeg = NEG_CATS.has(cat)
            const { pct, status } = catProgress(cur, t, isNeg)
            const barColor = status === 'ok' ? 'var(--green)' : status === 'warn' ? 'var(--yellow)' : 'var(--red)'
            return (
              <div key={cat} style={{ marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2, fontSize:11 }}>
                  <span style={{ color:'var(--text2)', fontWeight:600 }}>{cat}</span>
                  <span style={{ color: barColor }}>
                    {isNeg && cur > 0 ? cur.toFixed(2) : cat === 'OBP' ? cur.toFixed(3) : Math.round(cur)}
                    <span style={{ color:'var(--text3)' }}> / {t ? (isNeg ? t.toFixed(2) : cat === 'OBP' ? t.toFixed(3) : Math.round(t)) : '—'}</span>
                  </span>
                </div>
                <div className="progress-bar">
                  <div className={`progress-fill progress-${status === 'ok' ? 'green' : status === 'warn' ? 'yellow' : 'red'}`}
                    style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Pitcher Roles */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:12, marginBottom:10, color:'var(--text2)' }}>PITCHER ROLES</div>
          {[
            { label:'Win Contributors (SP)', cur: roles.winContributors, target: 7, hint:'W+K+ERA+WHIP' },
            { label:'Closers', cur: roles.closers, target: 3, hint:'SV ≥ 8' },
            { label:'Hold Specialists', cur: roles.holdSpec, target: 2, hint:'HLD ≥ 8' },
          ].map(r => {
            const ok = r.cur >= r.target
            const warn = r.cur >= r.target - 1
            const color = ok ? 'var(--green)' : warn ? 'var(--yellow)' : 'var(--red)'
            return (
              <div key={r.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:12, color:'var(--text)' }}>{r.label}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{r.hint}</div>
                </div>
                <span style={{ color, fontWeight:700, fontSize:14 }}>{r.cur}/{r.target}</span>
              </div>
            )
          })}
        </div>

        {/* My Players List */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:12, marginBottom:8, color:'var(--text2)' }}>PICKS IN ORDER</div>
          {myPlayers.length === 0 && <div style={{ color:'var(--text3)', fontSize:11 }}>No picks yet</div>}
          {myPlayers.map((p, i) => (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--text3)', fontSize:11, minWidth:20 }}>{i+1}.</span>
              <span style={{ color: posColor(p.pos), fontSize:11, fontWeight:700, minWidth:24 }}>{p.pos}</span>
              <span style={{ flex:1, fontSize:12 }}>{p.name}</span>
              <button className="btn btn-sm btn-ghost" style={{ fontSize:9, padding:'1px 4px' }} onClick={() => onUndraft(p.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RosterSlotRow({ slot, players, myPlayers, onUndraft }) {
  // Find an unassigned player that fits the slot's eligible positions
  const assigned = myPlayers.find(p => {
    if (!slot.eligible.includes(p.pos)) return false
    // Make sure no other earlier slot claimed this player
    return true
  })

  // Simple slot filling: find first player matching position
  const posPlayers = myPlayers.filter(p => slot.eligible.includes(p.pos))
  const player = posPlayers[0] || null // simplified assignment

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:11, fontWeight:600, color:'var(--text3)', minWidth:36 }}>{slot.label}</span>
      <div className={`roster-slot ${player ? 'filled' : 'empty'}`} style={{ flex:1 }}>
        {player ? (
          <>
            <span style={{ color: posColor(player.pos), fontSize:11, fontWeight:700 }}>{player.pos}</span>
            <span style={{ flex:1 }}>{player.name}</span>
            <span style={{ fontSize:10, color:'var(--text3)' }}>{player.team}</span>
          </>
        ) : (
          <span style={{ fontSize:11 }}>— empty —</span>
        )}
      </div>
    </div>
  )
}

// ── CATEGORY DASHBOARD ────────────────────────────────────────────────────────
function CategoryDashboard({ myTotals, targets, gapWeights, myCount }) {
  const allCats = ALL_CATS

  const sorted = [...allCats].sort((a, b) => {
    const wA = gapWeights[a] ?? 1
    const wB = gapWeights[b] ?? 1
    return wB - wA
  })

  return (
    <div style={{ padding:12 }}>
      <div style={{ marginBottom:12, display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>Category Dashboard</span>
        <span style={{ fontSize:11, color:'var(--text3)' }}>— gaps update live as you draft · red = most urgent need</span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:10 }}>
        {sorted.map(cat => {
          const t = targets[cat]
          const cur = myTotals[cat] ?? 0
          const isNeg = NEG_CATS.has(cat)
          const third = t?.third
          const second = t?.second
          const first = t?.first
          const { pct, status } = catProgress(cur, third, isNeg)
          const w = gapWeights[cat] ?? 1
          const urgency = w >= 1.8 ? 'HIGH' : w >= 1.2 ? 'MED' : 'LOW'
          const urgencyColor = urgency === 'HIGH' ? 'var(--red)' : urgency === 'MED' ? 'var(--yellow)' : 'var(--green)'
          const barColor = status === 'ok' ? 'var(--green)' : status === 'warn' ? 'var(--yellow)' : 'var(--red)'
          const fmt = v => v == null ? '—' : isNeg ? v.toFixed(2) : cat === 'OBP' ? v.toFixed(3) : Math.round(v)

          return (
            <div key={cat} className="card" style={{ borderLeft: `3px solid ${barColor}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <span style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>{cat}</span>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:10, color: urgencyColor, fontWeight:700, background: `${urgencyColor}22`, padding:'1px 5px', borderRadius:3 }}>
                    {urgency} NEED
                  </span>
                  <span style={{ fontSize:10, color:'var(--text3)' }}>wt {w.toFixed(2)}</span>
                </div>
              </div>

              {/* Progress bar with target markers */}
              <div style={{ position:'relative', marginBottom:8 }}>
                <div className="progress-bar" style={{ height:10 }}>
                  <div style={{ height:'100%', borderRadius:3, background: barColor, width:`${Math.round(pct * 100)}%`, transition:'width 0.4s' }} />
                </div>
                {/* Target markers */}
                <div style={{ position:'absolute', top:0, height:10, left: isNeg ? 'auto' : `${Math.min(83, 100)}%`, right: isNeg ? '17%' : 'auto', width:1, background:'rgba(255,255,255,0.3)' }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:6, fontSize:11 }}>
                <div>
                  <div style={{ color:'var(--text3)', fontSize:10, marginBottom:2 }}>Current</div>
                  <div style={{ color: barColor, fontWeight:700, fontSize:13 }}>{fmt(cur)}</div>
                </div>
                <div>
                  <div style={{ color:'var(--text3)', fontSize:10, marginBottom:2 }}>3rd (target)</div>
                  <div style={{ color:'var(--text2)', fontWeight:600 }}>{fmt(third)}</div>
                </div>
                <div>
                  <div style={{ color:'var(--text3)', fontSize:10, marginBottom:2 }}>2nd</div>
                  <div style={{ color:'var(--text2)' }}>{fmt(second)}</div>
                </div>
                <div>
                  <div style={{ color:'var(--text3)', fontSize:10, marginBottom:2 }}>1st</div>
                  <div style={{ color:'var(--text2)' }}>{fmt(first)}</div>
                </div>
              </div>

              {third && (
                <div style={{ marginTop:6, fontSize:10, color:'var(--text3)' }}>
                  {isNeg
                    ? cur === 0 ? 'No pitchers yet' : cur > third ? `↓ Need to lower by ${(cur - third).toFixed(2)}` : '✓ On track'
                    : cur >= third ? '✓ Target reached' : `Need +${fmt(third - cur)} more to reach 3rd`
                  }
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
function Recommendations({ recommendations, myTotals, targets, round, roles, onDraftMe }) {
  const isTurn = true // round 10, 11, etc.
  const turnMsg = round <= 2 || (round % 2 === 0)
    ? `🔄 Snake turn — consider pairing two complementary picks`
    : null

  return (
    <div style={{ padding:12 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:700 }}>⚡ Best Picks Right Now</span>
        <span style={{ fontSize:11, color:'var(--text3)' }}>Round {round} · Weighted by your current category gaps</span>
      </div>

      {turnMsg && (
        <div className="alert alert-info" style={{ marginBottom:10 }}>
          {turnMsg}
        </div>
      )}

      {/* Role warnings */}
      {roles.closers < 3 && round > 6 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.closers}/3 closers drafted. Saves are scarce — prioritize a closer soon.
        </div>
      )}
      {roles.holdSpec < 2 && round > 10 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.holdSpec}/2 hold specialists. HD target at risk.
        </div>
      )}
      {roles.winContributors < 4 && round > 8 && (
        <div className="alert alert-warn" style={{ marginBottom:8 }}>
          ⚠ Only {roles.winContributors}/7 win contributors. Wins (W) category needs SPs.
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {recommendations.slice(0, 8).map((p, i) => (
          <div key={p.id} className={`rec-card ${i === 0 ? 'top' : ''}`}
            style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
            <div style={{ minWidth:24, fontSize:16, fontWeight:700, color: i === 0 ? 'var(--tier1)' : 'var(--text3)' }}>
              {i + 1}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>{p.name}</span>
                <span style={{ color: posColor(p.pos), fontWeight:700, fontSize:12 }}>{p.pos}</span>
                <span style={{ color:'var(--text3)', fontSize:11 }}>{p.team}</span>
                {p.urgencyBoost > 0 && (
                  <span style={{ fontSize:10, color:'var(--orange)', background:'rgba(249,115,22,0.15)', padding:'1px 5px', borderRadius:3 }}>
                    +{p.urgencyBoost.toFixed(1)} role bonus
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:12, fontSize:11, color:'var(--text2)', marginBottom:4 }}>
                <span>Score: <b style={{ color:'var(--blue2)' }}>{p.liveScore.toFixed(2)}</b></span>
                {p.type === 'hitter' ? (
                  <>
                    <span>R:{Math.round(p.R||0)}</span>
                    <span>HR:{Math.round(p.HR||0)}</span>
                    <span>RBI:{Math.round(p.RBI||0)}</span>
                    <span>SB:{Math.round(p.SB||0)}</span>
                    <span>OBP:{(p.OBP||0).toFixed(3)}</span>
                  </>
                ) : (
                  <>
                    <span>W:{Math.round(p.W||0)}</span>
                    <span>SV:{Math.round(p.SV||0)}</span>
                    <span>HLD:{Math.round(p.HLD||0)}</span>
                    <span>K:{Math.round(p.SO||0)}</span>
                    <span>ERA:{(p.ERA||0).toFixed(2)}</span>
                    <span>WHIP:{(p.WHIP||0).toFixed(3)}</span>
                  </>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                {p.reasons.map((r, ri) => (
                  <div key={ri} style={{ fontSize:11, color: ri === 0 ? 'var(--text)' : 'var(--text3)' }}>
                    {ri === 0 ? '→' : '·'} {r}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => onDraftMe(p)}>Draft</button>
              {p.cbsADP && <span style={{ fontSize:10, color:'var(--text3)' }}>CBS {p.cbsADP.toFixed(1)}</span>}
            </div>
          </div>
        ))}
      </div>

      {recommendations.length === 0 && (
        <div style={{ color:'var(--text3)', padding:20, textAlign:'center' }}>
          All available players have been filtered or drafted.
        </div>
      )}
    </div>
  )
}

// ── FULL POOL ─────────────────────────────────────────────────────────────────
function FullPool({ players, search, setSearch, pos, setPos, sortKey, setSort }) {
  const positions = ['ALL','C','1B','2B','3B','SS','OF','SP','RP','CL','SU']
  const sortOptions = [
    { v:'FPTS', label:'FPTS' }, { v:'liveScore', label:'Score' },
    { v:'cbsADP', label:'CBS ADP' }, { v:'WAR', label:'WAR' },
    { v:'HR', label:'HR' }, { v:'SB', label:'SB' },
    { v:'W', label:'W' }, { v:'SV', label:'SV' },
  ]

  const filtered = useMemo(() => {
    let p = players
    if (pos !== 'ALL') p = p.filter(x => x.pos === pos)
    if (search) {
      const q = search.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q) || x.team.toLowerCase().includes(q))
    }
    const isNeg = sortKey === 'cbsADP' || sortKey === 'ERA' || sortKey === 'WHIP'
    p = [...p].sort((a, b) => {
      const av = a[sortKey] ?? (isNeg ? 999 : -999)
      const bv = b[sortKey] ?? (isNeg ? 999 : -999)
      return isNeg ? av - bv : bv - av
    })
    return p
  }, [players, pos, search, sortKey])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'8px 12px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width:160 }} />
        <select value={pos} onChange={e => setPos(e.target.value)}>
          {positions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--text3)' }}>Sort:</span>
          {sortOptions.map(s => (
            <button key={s.v} className={`btn btn-sm ${sortKey===s.v?'btn-primary':'btn-ghost'}`} onClick={() => setSort(s.v)}>
              {s.label}
            </button>
          ))}
        </div>
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text3)' }}>{filtered.length} players</span>
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th><th>Pos</th><th>Team</th>
              <th>Score</th><th>FPTS</th><th>CBS ADP</th><th>WAR</th>
              <th>R</th><th>H</th><th>HR</th><th>RBI</th><th>SB</th><th>OBP</th>
              <th>W</th><th>SV</th><th>HLD</th><th>K</th><th>ERA</th><th>WHIP</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className={p.drafted ? 'drafted' : p.isMine ? 'mine' : ''}>
                <td style={{ fontWeight: p.isMine ? 700 : 400 }}>{p.name}</td>
                <td><span style={{ color: posColor(p.pos), fontWeight:600 }}>{p.pos}</span></td>
                <td style={{ color:'var(--text3)' }}>{p.team}</td>
                <td style={{ color:'var(--blue2)' }}>{p.liveScore?.toFixed(1) ?? '—'}</td>
                <td>{p.FPTS ? Math.round(p.FPTS) : '—'}</td>
                <td style={{ color: p.cbsADP ? 'var(--text)' : 'var(--text3)' }}>{p.cbsADP?.toFixed(1) ?? '—'}</td>
                <td style={{ color:'var(--text2)' }}>{p.WAR?.toFixed(1) ?? '—'}</td>
                <td>{p.type==='hitter' ? Math.round(p.R||0) : '—'}</td>
                <td>{p.type==='hitter' ? Math.round(p.H||0) : '—'}</td>
                <td>{p.type==='hitter' ? Math.round(p.HR||0) : '—'}</td>
                <td>{p.type==='hitter' ? Math.round(p.RBI||0) : '—'}</td>
                <td>{p.type==='hitter' ? Math.round(p.SB||0) : '—'}</td>
                <td>{p.type==='hitter' ? (p.OBP||0).toFixed(3) : '—'}</td>
                <td style={{ color: p.type==='pitcher' ? 'var(--text)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.W||0) : '—'}</td>
                <td style={{ color: p.type==='pitcher' ? 'var(--purple)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.SV||0) : '—'}</td>
                <td style={{ color: p.type==='pitcher' ? 'var(--blue2)' : 'var(--text3)' }}>{p.type==='pitcher' ? Math.round(p.HLD||0) : '—'}</td>
                <td>{p.type==='pitcher' ? Math.round(p.SO||0) : '—'}</td>
                <td>{p.type==='pitcher' ? (p.ERA||0).toFixed(2) : '—'}</td>
                <td>{p.type==='pitcher' ? (p.WHIP||0).toFixed(3) : '—'}</td>
                <td>
                  {p.drafted
                    ? <span style={{ color: p.isMine ? 'var(--blue2)' : 'var(--text3)', fontSize:10 }}>{p.isMine ? 'MINE' : 'GONE'}</span>
                    : <span style={{ color:'var(--green)', fontSize:10 }}>AVAIL</span>
                  }
                </td>
              </tr>
            ))}
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
              {myCount} picks already imported · Paste from FantasyPros · Your team: <span style={{ color:'var(--blue2)' }}>{MY_TEAM}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ fontSize:11, color:'var(--text2)', marginBottom:8 }}>
          Paste your FantasyPros round results below
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          placeholder={`Sandlot Warriors\n1.01\nS. Ohtani\nDH\nLAD\nEdit\nnumbahs\n1.10\nB. Witt\nSS\nKC\nEdit`}
          style={{ width:'100%', fontFamily:'monospace', fontSize:11, marginBottom:10 }}
        />

        {msg && (
          <div className={`alert ${msg.startsWith('✅') ? 'alert-ok' : 'alert-warn'}`} style={{ marginBottom:10 }}>
            {msg}
          </div>
        )}

        <div style={{ fontSize:10, color:'var(--text3)', marginBottom:12 }}>
          After each round on FantasyPros, copy all picks from that round and paste here.
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onParse}>Parse Round</button>
        </div>
      </div>
    </div>
  )
}
