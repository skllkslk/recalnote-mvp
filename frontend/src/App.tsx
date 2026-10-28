import { FormEvent, useEffect, useState } from "react"

type Page = "home" | "records" | "proposals" | "quests"
type RecordItem = { id: string; title: string; contentMarkdown: string; tags?: string[]; version: number; createdAt: string }
type Epic = { id: string; title: string; completionCriteria: string }
type Proposal = { id: string; title: string; description: string; status: string }
type Quest = { id: string; title: string; description: string; status: string }

const API = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "")

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `요청에 실패했습니다 (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function App() {
  const [page, setPage] = useState<Page>("home")
  const [records, setRecords] = useState<RecordItem[]>([])
  const [epic, setEpic] = useState<Epic | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function refresh() {
    setError("")
    try {
      const [recordRows, activeEpic, proposalRows, questRows] = await Promise.all([
        request<RecordItem[]>("/records"), request<Epic>("/epics/active"),
        request<Proposal[]>("/quest-proposals"), request<Quest[]>("/quests"),
      ])
      setRecords(recordRows)
      setEpic(activeEpic)
      setProposals(proposalRows)
      setQuests(questRows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "데이터를 불러오지 못했습니다.")
    }
  }
  useEffect(() => { void refresh() }, [])

  async function saveRecord(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    try {
      await request<RecordItem>("/records", { method: "POST", body: JSON.stringify({ title: title.trim(), contentMarkdown: content.trim(), tags: [] }) })
      setTitle(""); setContent(""); setShowEditor(false); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "기록을 저장하지 못했습니다.") }
    finally { setBusy(false) }
  }

  async function generate() {
    if (!epic) return
    setBusy(true)
    try {
      await request("/agent/quest-proposals", { method: "POST", body: JSON.stringify({ epicId: epic.id }) })
      setPage("proposals"); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 만들지 못했습니다.") }
    finally { setBusy(false) }
  }

  async function decide(proposal: Proposal, action: "ACCEPT" | "REJECT") {
    setBusy(true)
    try {
      await request(`/quest-proposals/${proposal.id}/decisions`, { method: "POST", body: JSON.stringify({ action }) })
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 처리하지 못했습니다.") }
    finally { setBusy(false) }
  }

  const nav: { id: Page; label: string; icon: string }[] = [
    { id: "home", label: "홈", icon: "⌂" }, { id: "records", label: "기록 보관함", icon: "▤" },
    { id: "proposals", label: "제안 검토", icon: "✦" }, { id: "quests", label: "퀘스트", icon: "◇" },
  ]
  const pending = proposals.filter(item => item.status === "PENDING")

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("home")}><span className="brand-mark">R</span> RecallNote</button>
      <p className="nav-label">MY SPACE</p>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => { setPage(item.id); setSelectedRecord(null) }}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "proposals" && pending.length > 0 && <span className="nav-count">{pending.length}</span>}</button>)}</nav>
      <div className="sidebar-foot"><div className="profile"><span className="avatar">R</span><span><strong>내 작업 공간</strong><small>개인 기록</small></span></div></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><span className="mobile-brand"><span className="brand-mark">R</span> RecallNote</span><button className="button primary" onClick={() => { setSelectedRecord(null); setShowEditor(true) }}>＋ 기록 남기기</button></header>
      {error && <div className="notice" role="alert"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
      <main className="page">
        {page === "home" && <>
          <section className="hero"><p className="eyebrow">YOUR WORK, REMEMBERED</p><h1>지나간 경험을<br /><em>다음의 근거</em>로.</h1><p className="hero-copy">작은 업무 기록을 모아, 지금 필요한 경험과 다음 목표를 찾아보세요.</p><button className="button primary" onClick={() => setShowEditor(true)}>첫 기록 남기기 <span>→</span></button></section>
          <section className="quick-section"><div className="section-heading"><div><p className="eyebrow">MVP WORKFLOW</p><h2>기록에서 퀘스트까지</h2></div><p>경험을 기록하고, 근거가 담긴 제안을 확인한 뒤 퀘스트로 저장합니다.</p></div><div className="quick-grid">
            <button className="quick-card" onClick={() => setPage("records")}><span className="quick-icon mint">▤</span><span><strong>기록 보관함</strong><small>{records.length}개의 원본 기록</small></span><span>→</span></button>
            <button className="quick-card" onClick={generate} disabled={busy || records.length === 0}><span className="quick-icon yellow">✦</span><span><strong>퀘스트 제안 만들기</strong><small>{records.length ? "기록을 바탕으로 제안을 생성합니다" : "먼저 기록을 추가해 주세요"}</small></span><span>→</span></button>
            <button className="quick-card" onClick={() => setPage("proposals")}><span className="quick-icon mint">◇</span><span><strong>제안 검토</strong><small>검토 대기 {pending.length}건</small></span><span>→</span></button>
          </div></section>
          <section className="recent"><div className="section-heading row"><div><p className="eyebrow">RECENT NOTES</p><h2>최근 기록</h2></div><button className="see-all" onClick={() => setPage("records")}>전체 보기 →</button></div>{records.length ? <div className="recent-list">{records.slice(0, 4).map(record => <button key={record.id} onClick={() => setSelectedRecord(record)}><span className="file-tile">▤</span><span className="recent-copy"><strong>{record.title}</strong><small>{record.contentMarkdown.slice(0, 100)}</small></span><span className="recent-date">v{record.version}</span><span>→</span></button>)}</div> : <p className="empty-copy">아직 기록이 없습니다. 첫 경험을 짧게 남겨보세요.</p>}</section>
        </>}
        {page === "records" && <>
          {selectedRecord ? <section className="record-detail"><button className="back-link" onClick={() => setSelectedRecord(null)}>← 기록 목록</button><p className="eyebrow">SAVED RECORD · v{selectedRecord.version}</p><h1>{selectedRecord.title}</h1><pre>{selectedRecord.contentMarkdown}</pre></section> : <>
            <div className="page-title"><div><p className="eyebrow">NOTE ARCHIVE</p><h1>기록 보관함</h1><p>경험의 원문을 보관하고 필요할 때 다시 찾아보세요.</p></div><button className="button primary" onClick={() => setShowEditor(true)}>＋ 기록 남기기</button></div>
            <div className="toolbar"><span>전체 기록 <strong>{records.length}</strong></span></div>
            {records.length ? <div className="archive-grid">{records.map(record => <button className="archive-card" key={record.id} onClick={() => setSelectedRecord(record)}><span className="tag">기록 · v{record.version}</span><h2>{record.title}</h2><p>{record.contentMarkdown.slice(0, 220)}{record.contentMarkdown.length > 220 ? "…" : ""}</p><span className="archive-foot">{new Date(record.createdAt).toLocaleDateString("ko-KR")}</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h2>아직 저장된 기록이 없어요</h2><p>기억하고 싶은 업무 경험을 Markdown 텍스트로 추가하세요.</p><button className="button primary" onClick={() => setShowEditor(true)}>첫 기록 추가</button></div>}
          </>}
        </>}
        {page === "proposals" && <><div className="page-title"><div><p className="eyebrow">QUEST PROPOSALS</p><h1>퀘스트 제안 검토</h1><p>제안의 근거를 확인하고 수락하거나 거절하세요.</p></div><button className="button primary" disabled={!records.length || busy} onClick={generate}>{busy ? "생성 중…" : "✦ 제안 생성"}</button></div>{pending.length ? <div className="proposal-list">{pending.map(item => <article className="proposal-card" key={item.id}><p className="eyebrow">검토 대기</p><h2>{item.title}</h2><p>{item.description}</p><div className="card-actions"><button className="button secondary" disabled={busy} onClick={() => decide(item, "REJECT")}>거절</button><button className="button primary" disabled={busy} onClick={() => decide(item, "ACCEPT")}>제안 수락</button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon">✦</span><h2>검토할 제안이 없습니다</h2><p>기록을 저장한 뒤 제안을 생성하면 여기에 표시됩니다.</p><button className="button primary" disabled={!records.length || busy} onClick={generate}>제안 생성하기</button></div>}{proposals.filter(item => item.status !== "PENDING").length > 0 && <section className="recent"><h2>검토 완료</h2><div className="recent-list">{proposals.filter(item => item.status !== "PENDING").map(item => <div className="recent-row" key={item.id}><span className="file-tile">{item.status === "ACCEPTED" ? "✓" : "×"}</span><span className="recent-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="tag">{item.status === "ACCEPTED" ? "수락됨" : "거절됨"}</span></div>)}</div></section>}</>}
        {page === "quests" && <><div className="page-title"><div><p className="eyebrow">QUEST BOARD</p><h1>내 퀘스트</h1><p>{epic?.title ?? "활성 목표"}</p></div><button className="button secondary" onClick={() => setPage("proposals")}>제안 검토 →</button></div>{quests.length ? <div className="quest-grid">{quests.map(quest => <article className="quest-card-large" key={quest.id}><span className="tag">{quest.status}</span><h2>{quest.title}</h2><p>{quest.description}</p><div className="quest-stats"><span>활성 Epic과 연결됨</span></div></article>)}</div> : <div className="empty-state"><span className="empty-icon">◇</span><h2>아직 퀘스트가 없습니다</h2><p>제안을 수락하면 퀘스트와 근거 기록이 함께 저장됩니다.</p><button className="button primary" onClick={() => setPage("proposals")}>제안 확인하기</button></div>}</>}
      </main>
    </div>
    {showEditor && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowEditor(false) }}><form className="modal" onSubmit={saveRecord}><button type="button" className="modal-close" aria-label="닫기" onClick={() => setShowEditor(false)}>×</button><p className="eyebrow">NEW RECORD</p><h2>경험 기록하기</h2><p className="modal-copy">원본 기록은 수정 없이 보관되며, 제안의 근거로 사용됩니다.</p><label>제목<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 검색 전환 개선 프로젝트 회고" required /></label><label>내용 (Markdown)<textarea value={content} onChange={event => setContent(event.target.value)} placeholder="상황, 내가 한 일, 결과를 적어주세요." rows={8} required /></label><div className="card-actions"><button type="button" className="button secondary" onClick={() => setShowEditor(false)}>취소</button><button className="button primary" disabled={busy}>{busy ? "저장 중…" : "기록 저장"}</button></div></form></div>}
    <div className="mobile-nav">{nav.map(item => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}</div>
  </div>
}

export default App
