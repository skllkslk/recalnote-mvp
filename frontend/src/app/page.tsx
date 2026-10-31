"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react"

type Page = "home" | "archive" | "import" | "search" | "quests" | "world" | "studio"
type RecordItem = { id: string; title: string; contentMarkdown: string; tags?: string[]; version: number; createdAt: string }
type Epic = { id: string; title: string; completionCriteria: string }
type Evidence = { recordId: string; recordVersion: number; excerpt: string; recordTitle: string }
type Proposal = { id: string; title: string; description: string; steps: string[]; completionCriteria: string; rationale: string; evidence: Evidence[]; status: string }
type Quest = { id: string; epicId: string; title: string; description: string; steps: string[]; completionCriteria: string; status: string }
type EditedQuest = { title: string; description: string; steps: string[]; completionCriteria: string }

const nav: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "홈", icon: "⌂" },
  { id: "archive", label: "기록 보관함", icon: "▤" },
  { id: "quests", label: "퀘스트 보드", icon: "◇" },
  { id: "studio", label: "결과물 작업실", icon: "▧" },
  { id: "world", label: "기억의 세계", icon: "◎" },
]

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
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

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "날짜 정보 없음" : date.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })
}

function Icon({ children }: { children: string }) { return <span className="icon-mark" aria-hidden="true">{children}</span> }

function EmptyState({ icon, title, copy, action }: { icon: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon>{icon}</Icon></span><h2>{title}</h2><p>{copy}</p>{action}</div>
}

function ProposalReviewCard({ proposal, busy, onReject, onAccept, onOpenRecord }: {
  proposal: Proposal; busy: boolean; onReject: (proposal: Proposal) => void
  onAccept: (proposal: Proposal, edited: EditedQuest) => void; onOpenRecord: (id: string) => void
}) {
  const [title, setTitle] = useState(proposal.title)
  const [description, setDescription] = useState(proposal.description)
  const [steps, setSteps] = useState(proposal.steps?.length ? proposal.steps : ["", ""])
  const [criteria, setCriteria] = useState(proposal.completionCriteria ?? "")
  const canAccept = title.trim() && description.trim() && criteria.trim() && steps.length >= 2 && steps.length <= 5 && steps.every(step => step.trim())

  return <article className="proposal-card">
    <div className="proposal-topline"><span className="status-pill pending">검토 대기</span><span className="eyebrow">기록 기반 제안</span></div>
    <label className="field-label">퀘스트 제목<input value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="field-label">목표<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <div className="plan-editor"><div className="plan-heading"><strong>실행 단계</strong>{steps.length < 5 && <button className="inline-action" type="button" onClick={() => setSteps(current => [...current, ""])}>＋ 단계 추가</button>}</div>
      <ol>{steps.map((step, index) => <li key={index}><input aria-label={`실행 단계 ${index + 1}`} value={step} onChange={event => setSteps(current => current.map((item, i) => i === index ? event.target.value : item))} /><button className="icon-action remove-action" type="button" aria-label={`단계 ${index + 1} 삭제`} onClick={() => setSteps(current => current.length > 2 ? current.filter((_, i) => i !== index) : current.map((item, i) => i === index ? "" : item))}>×</button></li>)}</ol>
    </div>
    <label className="field-label">완료 기준<textarea rows={2} value={criteria} onChange={event => setCriteria(event.target.value)} /></label>
    {proposal.rationale && <p className="rationale">제안 이유 · {proposal.rationale}</p>}
    <div className="evidence-box"><div className="plan-heading"><strong>연결된 근거</strong><span>{proposal.evidence?.length ?? 0}개</span></div>
      {proposal.evidence?.length ? proposal.evidence.map(item => <button className="evidence-row" key={item.recordId} type="button" onClick={() => onOpenRecord(item.recordId)}><span className="evidence-title">{item.recordTitle}<small>기록 버전 {item.recordVersion}</small></span><blockquote>{item.excerpt}</blockquote><span className="evidence-open">기록 보기 →</span></button>) : <p className="muted-copy">연결된 근거가 없습니다.</p>}
    </div>
    <div className="card-actions"><button className="button secondary" disabled={busy} onClick={() => onReject(proposal)}>거절</button><button className="button primary" disabled={busy || !canAccept} onClick={() => onAccept(proposal, { title: title.trim(), description: description.trim(), steps: steps.map(step => step.trim()), completionCriteria: criteria.trim() })}>수정 후 수락</button></div>
  </article>
}

export default function App() {
  const [page, setPage] = useState<Page>("home")
  const [records, setRecords] = useState<RecordItem[]>([])
  const [epic, setEpic] = useState<Epic | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null)
  const [recordEditor, setRecordEditor] = useState(false)
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [importTitle, setImportTitle] = useState("")
  const [importContent, setImportContent] = useState("")
  const [importMode, setImportMode] = useState<"files" | "write">("files")
  const [studioQuest, setStudioQuest] = useState("")
  const [studioRecordIds, setStudioRecordIds] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState("")

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
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const pending = proposals.filter(item => item.status === "PENDING")
  const completed = proposals.filter(item => item.status !== "PENDING")
  const searchResults = useMemo(() => {
    const term = submittedQuery.trim().toLocaleLowerCase()
    if (!term) return records
    return records.filter(record => `${record.title} ${record.contentMarkdown} ${(record.tags ?? []).join(" ")}`.toLocaleLowerCase().includes(term))
  }, [records, submittedQuery])
  const selectedQuest = quests.find(quest => quest.id === studioQuest)

  function openNewRecord() {
    setEditingRecord(null); setTitle(""); setContent(""); setRecordEditor(true)
  }
  function openEditRecord(record: RecordItem) {
    setEditingRecord(record); setTitle(record.title); setContent(record.contentMarkdown); setRecordEditor(true)
  }
  function openImport() {
    setImportFiles([]); setImportTitle(""); setImportContent(""); setImportMode("files"); setPage("import")
  }
  function runSearch(event: FormEvent) {
    event.preventDefault(); setSubmittedQuery(query.trim()); setPage("search")
  }
  async function saveRecord(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    try {
      const payload = JSON.stringify({ title: title.trim(), contentMarkdown: content.trim(), tags: editingRecord?.tags ?? [] })
      const saved = await request<RecordItem>(editingRecord ? `/records/${editingRecord.id}` : "/records", { method: editingRecord ? "PUT" : "POST", body: payload })
      setRecordEditor(false); setEditingRecord(null); await refresh()
      if (selectedRecord?.id === saved.id) setSelectedRecord(saved)
      setNotice(editingRecord ? "기록을 수정했습니다." : "기록을 저장했습니다.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "기록을 저장하지 못했습니다.") }
    finally { setBusy(false) }
  }
  async function deleteRecord(record: RecordItem) {
    if (!window.confirm(`“${record.title}” 기록을 보관함에서 삭제할까요?`)) return
    try { await request(`/records/${record.id}`, { method: "DELETE" }); setSelectedRecord(null); await refresh(); setNotice("기록을 삭제했습니다.") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "기록을 삭제하지 못했습니다.") }
  }
  async function filesChanged(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(file => file.name.toLocaleLowerCase().endsWith(".md"))
    setImportFiles(files)
  }
  async function importMarkdown(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("")
    try {
      const entries: { title: string; contentMarkdown: string }[] = []
      if (importMode === "write") {
        if (importTitle.trim() && importContent.trim()) entries.push({ title: importTitle.trim(), contentMarkdown: importContent.trim() })
      } else {
        for (const file of importFiles) {
          const text = await file.text()
          const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
          entries.push({ title: heading || file.name.replace(/\.md$/i, ""), contentMarkdown: text.trim() })
        }
      }
      if (!entries.length) throw new Error(importMode === "files" ? "가져올 Markdown 파일을 선택해 주세요." : "제목과 내용을 입력해 주세요.")
      for (const entry of entries) await request("/records", { method: "POST", body: JSON.stringify({ ...entry, tags: [] }) })
      await refresh(); setPage("archive"); setImportFiles([]); setImportTitle(""); setImportContent("")
      setNotice(`${entries.length}개의 Markdown 기록을 가져왔습니다.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Markdown을 가져오지 못했습니다.") }
    finally { setBusy(false) }
  }
  async function generateProposal() {
    if (!epic || !records.length) return
    setBusy(true); setError("")
    try { await request("/agent/quest-proposals", { method: "POST", body: JSON.stringify({ epicId: epic.id }) }); await refresh(); setPage("quests"); setNotice("기록을 바탕으로 퀘스트 제안을 만들었습니다.") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 만들지 못했습니다.") }
    finally { setBusy(false) }
  }
  async function decide(proposal: Proposal, action: "ACCEPT_EDITED" | "REJECT", edited?: EditedQuest) {
    setBusy(true)
    try {
      await request(`/quest-proposals/${proposal.id}/decisions`, { method: "POST", body: JSON.stringify({ action, ...(edited ? { editedTitle: edited.title, editedDescription: edited.description, editedSteps: edited.steps, editedCompletionCriteria: edited.completionCriteria } : {}) }) })
      await refresh(); setNotice(action === "REJECT" ? "제안을 거절했습니다." : "퀘스트 보드에 추가했습니다.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 처리하지 못했습니다.") }
    finally { setBusy(false) }
  }
  function buildDraft() {
    if (!selectedQuest) return
    const sources = records.filter(record => studioRecordIds.includes(record.id))
    const text = [`# ${selectedQuest.title}`, "", `## 목표\n${selectedQuest.description}`, "", "## 실행 계획", ...selectedQuest.steps.map((step, index) => `${index + 1}. ${step}`), "", "## 연결한 기록", ...sources.map(record => `### ${record.title}\n${record.contentMarkdown.slice(0, 700)}`), "", `## 완료 기준\n${selectedQuest.completionCriteria}`].join("\n")
    setDraft(text); setNotice("선택한 퀘스트와 기록으로 편집 가능한 Markdown 초안을 구성했습니다.")
  }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(draft); setNotice("초안을 복사했습니다.") }
    catch { setError("클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.") }
  }
  function downloadDraft() {
    const blob = new Blob([draft], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a")
    anchor.href = url; anchor.download = `${(selectedQuest?.title || "recallnote-draft").replace(/[\\/:*?"<>|]/g, "-")}.md`; anchor.click(); URL.revokeObjectURL(url)
  }
  function toggleStudioRecord(id: string) { setStudioRecordIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }

  const recordDetail = selectedRecord && <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedRecord(null) }}><aside className="record-drawer" aria-label="기록 상세"><button className="drawer-close" onClick={() => setSelectedRecord(null)} aria-label="닫기">×</button><p className="eyebrow">원본 기록 · v{selectedRecord.version}</p><div className="drawer-meta"><span className="source-pill">직접 입력 / 가져오기</span><span>{dateLabel(selectedRecord.createdAt)}</span></div><h2>{selectedRecord.title}</h2><pre className="record-body">{selectedRecord.contentMarkdown}</pre><div className="drawer-actions"><button className="button secondary" onClick={() => openEditRecord(selectedRecord)}>기록 수정</button><button className="button danger-quiet" onClick={() => void deleteRecord(selectedRecord)}>기록 삭제</button><button className="button primary" onClick={() => { setStudioRecordIds(ids => ids.includes(selectedRecord.id) ? ids : [...ids, selectedRecord.id]); setSelectedRecord(null); setPage("studio") }}>결과물 근거로 선택</button></div></aside></div>

  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => setPage("home")}><span className="brand-mark">R</span><span>RecallNote</span></button><p className="nav-label">WORKSPACE</p><nav aria-label="주요 메뉴">{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><Icon>{item.icon}</Icon><span>{item.label}</span>{item.id === "quests" && pending.length > 0 && <span className="nav-count">{pending.length}</span>}{item.id === "world" && <span className="beta">실험</span>}</button>)}</nav><div className="sidebar-bottom"><div className="space-note"><span className="space-orb">✦</span><div><strong>기억은 쌓이고</strong><small>다음 선택의 근거가 됩니다</small></div></div><div className="profile-row"><span className="avatar">R</span><span><strong>내 작업 공간</strong><small>개인 기록</small></span><span className="profile-menu">···</span></div></div></aside>
    <div className="app-main"><header className="topbar"><span className="mobile-brand"><span className="brand-mark">R</span> RecallNote</span><div className="topbar-right"><span className="save-indicator"><i /> 원본 기록 보관 중</span><button className="button primary" onClick={openNewRecord}>＋ 새 기록</button></div></header>
      {(error || notice) && <div className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice("") }}>닫기</button></div>}
      {page === "home" && <main className="page home-page">
        <section className="home-hero"><div className="hero-spark">✦</div><p className="eyebrow">YOUR WORK, REMEMBERED</p><h1>지나간 경험을<br /><em>다음의 근거</em>로.</h1><p className="hero-copy">기록 속 경험을 찾고, 지금 필요한 목표로 이어보세요.</p><form className="search-bar" onSubmit={runSearch}><Icon>⌕</Icon><input value={query} onChange={event => setQuery(event.target.value)} placeholder="어떤 경험을 찾고 있나요?" aria-label="기록 검색" /><button className="search-submit" type="submit">검색 <span>→</span></button></form><div className="search-hints"><span>예시</span>{["문제를 해결한 경험", "프로젝트 협업", "사용자 인터뷰"].map(hint => <button key={hint} type="button" onClick={() => { setQuery(hint); setSubmittedQuery(hint); setPage("search") }}>{hint}</button>)}</div></section>
        <section className="home-actions"><button className="home-action-card" onClick={() => setPage("archive")}><span className="action-icon mint"><Icon>▤</Icon></span><span><strong>기록 보관함</strong><small>모아둔 경험 {records.length}개 살펴보기</small></span><b>→</b></button><button className="home-action-card" onClick={openImport}><span className="action-icon butter"><Icon>↥</Icon></span><span><strong>기록 가져오기</strong><small>Markdown 파일을 추가하거나 직접 작성</small></span><b>→</b></button><button className="home-action-card world-action" onClick={() => setPage("world")}><span className="action-icon world-icon"><Icon>◎</Icon></span><span><strong>기억의 세계 <em>실험</em></strong><small>주제별로 모인 기록 탐색</small></span><b>→</b></button></section>
        <section className="home-lower">
          <div className="home-quests">
            <div className="section-heading"><div><p className="eyebrow">QUEST BOARD</p><h2>진행 중인 퀘스트</h2></div><button className="text-link" onClick={() => setPage("quests")}>모두 보기 →</button></div>
            {quests.filter(q => q.status !== "DONE").length ? (
              <div className="mini-quest-list">{quests.filter(q => q.status !== "DONE").slice(0, 2).map(quest => <button className="mini-quest" key={quest.id} onClick={() => { setStudioQuest(quest.id); setPage("quests") }}><span className="quest-gem">◇</span><span><strong>{quest.title}</strong><small>{quest.status === "IN_PROGRESS" ? "진행 중" : "시작 전"} · {quest.steps?.length ?? 0}개 단계</small></span><span className="chevron">›</span></button>)}</div>
            ) : (
              <div className="inline-empty"><span>◇</span><div><strong>아직 퀘스트가 없어요</strong><small>기록을 바탕으로 첫 제안을 받아보세요.</small></div><button onClick={() => setPage("quests")}>퀘스트 보드 →</button></div>
            )}
          </div>
          <div className="home-recent">
            <div className="section-heading"><div><p className="eyebrow">RECENT RECORDS</p><h2>최근 기록</h2></div><button className="text-link" onClick={() => setPage("archive")}>모두 보기 →</button></div>
            {records.length ? records.slice(0, 3).map(record => <button className="recent-row" key={record.id} onClick={() => setSelectedRecord(record)}><span className="recent-file">▤</span><span className="recent-text"><strong>{record.title}</strong><small>{record.contentMarkdown.slice(0, 88)}</small></span><span className="recent-date">{dateLabel(record.createdAt)}</span></button>) : <p className="subtle-empty">아직 저장된 기록이 없습니다.</p>}
          </div>
        </section>
      </main>}

      {page === "search" && <main className="page inner-page"><div className="search-results-head"><button className="back-link" onClick={() => setPage("home")}>← 홈</button><form className="search-bar compact" onSubmit={runSearch}><Icon>⌕</Icon><input value={query} onChange={event => setQuery(event.target.value)} placeholder="기록 검색" aria-label="검색어" /><button className="search-submit" type="submit">검색</button></form></div><div className="page-title"><div><p className="eyebrow">QUICK SEARCH</p><h1>{submittedQuery ? `“${submittedQuery}” 검색 결과` : "전체 기록"}</h1><p>{searchResults.length}개의 기록이 검색되었습니다.</p></div></div>{loading ? <div className="loading-state">기록을 불러오는 중…</div> : searchResults.length ? <div className="results-layout"><div className="result-list">{searchResults.map(record => <button className="result-card" key={record.id} onClick={() => setSelectedRecord(record)}><div className="result-meta"><span className="source-pill">기록 · v{record.version}</span><span>{dateLabel(record.createdAt)}</span></div><h2>{record.title}</h2><p>{record.contentMarkdown.slice(0, 360)}</p><span className="result-open">원본 기록 보기 →</span></button>)}</div><aside className="search-assist"><span className="assist-gem">✦</span><p className="eyebrow">NEXT STEP</p><h2>찾은 경험을<br />목표로 이어보세요.</h2><p>기록을 바탕으로 퀘스트 제안을 만들고, 근거를 확인할 수 있습니다.</p><button className="button primary full-width" disabled={!records.length || busy} onClick={() => void generateProposal()}>{busy ? "제안 만드는 중…" : "퀘스트 제안 받기 →"}</button><button className="button secondary full-width" onClick={() => setPage("studio")}>결과물 작업실</button></aside></div> : <EmptyState icon="⌕" title="검색 결과가 없습니다" copy="검색어를 바꾸거나 기록 보관함에 경험을 추가해 보세요." action={<><button className="button secondary" onClick={openImport}>기록 가져오기</button><button className="button primary" onClick={openNewRecord}>직접 기록하기</button></>} />}</main>}

      {page === "archive" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">RECORD ARCHIVE</p><h1>기록 보관함</h1><p>원본은 그대로 보관하고, 필요할 때 다시 찾아보세요.</p></div><div className="title-actions"><button className="button secondary" onClick={openNewRecord}>＋ 직접 입력</button><button className="button primary" onClick={openImport}>↥ Markdown 가져오기</button></div></div><div className="archive-toolbar"><span>전체 기록 <strong>{records.length}</strong></span><span className="toolbar-note">원본 기록은 퀘스트와 결과물의 근거로 연결됩니다.</span></div>{loading ? <div className="loading-state">기록을 불러오는 중…</div> : records.length ? <div className="archive-grid">{records.map(record => <button className="archive-card" key={record.id} onClick={() => setSelectedRecord(record)}><div className="archive-card-top"><span className="source-pill">기록 · v{record.version}</span><span>{dateLabel(record.createdAt)}</span></div><h2>{record.title}</h2><p>{record.contentMarkdown.slice(0, 230)}{record.contentMarkdown.length > 230 ? "…" : ""}</p><div className="archive-card-foot"><span>{record.tags?.length ? record.tags.join(" · ") : "Markdown 기록"}</span><span>원본 열기 →</span></div></button>)}</div> : <EmptyState icon="▤" title="아직 저장된 기록이 없어요" copy="Markdown 파일을 가져오거나 업무 경험을 직접 적어보세요." action={<><button className="button secondary" onClick={openNewRecord}>직접 기록하기</button><button className="button primary" onClick={openImport}>Markdown 가져오기</button></>} />}</main>}

      {page === "import" && <main className="page inner-page import-page"><button className="back-link" onClick={() => setPage("archive")}>← 기록 보관함</button><div className="page-title"><div><p className="eyebrow">ADD TO YOUR ARCHIVE</p><h1>기록 가져오기</h1><p>Markdown 원문을 보관함에 추가합니다. 원본 내용은 그대로 저장됩니다.</p></div></div><div className="import-tabs"><button className={importMode === "files" ? "selected" : ""} onClick={() => setImportMode("files")}>파일 가져오기</button><button className={importMode === "write" ? "selected" : ""} onClick={() => setImportMode("write")}>직접 입력</button></div><form className="import-panel" onSubmit={importMarkdown}>{importMode === "files" ? <><label className="drop-zone"><input type="file" accept=".md,text/markdown" multiple onChange={event => void filesChanged(event)} /><span className="drop-icon">↥</span><strong>Markdown 파일을 선택하세요</strong><small>여러 개의 .md 파일을 한 번에 가져올 수 있습니다.</small><span className="button secondary">파일 선택</span></label>{importFiles.length > 0 && <div className="selected-files"><div className="plan-heading"><strong>가져올 파일</strong><span>{importFiles.length}개</span></div>{importFiles.map(file => <div className="file-row" key={`${file.name}-${file.size}`}><span>▤</span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></div>)}</div>}</> : <><label className="field-label">제목<input value={importTitle} onChange={event => setImportTitle(event.target.value)} placeholder="예: 검색 전환 개선 회고" required /></label><label className="field-label">내용 <span className="label-hint">Markdown 지원</span><textarea className="large-textarea" value={importContent} onChange={event => setImportContent(event.target.value)} placeholder={"상황, 내가 한 일, 결과를 자유롭게 적어보세요.\n\n## 상황\n\n## 내가 한 일\n\n## 결과"} rows={12} required /></label></>}<div className="import-footnote"><span>ⓘ</span><p>가져온 내용은 원문 기록으로 저장됩니다. 구조화된 분석과 AI 제안은 이후 단계에서 별도로 검토할 수 있습니다.</p></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setPage("archive")}>취소</button><button type="submit" className="button primary" disabled={busy || (importMode === "files" ? !importFiles.length : !importTitle.trim() || !importContent.trim())}>{busy ? "가져오는 중…" : importMode === "files" ? `${importFiles.length || ""}개 파일 가져오기` : "기록 저장"}</button></div></form></main>}

      {page === "quests" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">QUEST BOARD</p><h1>퀘스트 보드</h1><p>{epic?.title ?? "활성 목표"}</p></div><button className="button primary" disabled={!records.length || busy} onClick={() => void generateProposal()}>{busy ? "제안 만드는 중…" : "✦ 기록에서 제안 받기"}</button></div><section className="goal-banner"><span className="goal-icon">◎</span><div><p className="eyebrow">현재 목표</p><h2>{epic?.title ?? "목표를 불러오는 중"}</h2><p>{epic?.completionCriteria ?? "목표 정보를 불러오지 못했습니다."}</p></div><span className="goal-count">{quests.length}<small>퀘스트</small></span></section><div className="board-section-head"><div><h2>진행 중인 퀘스트</h2><span>{quests.filter(q => q.status !== "DONE").length}개</span></div><button className="text-link" onClick={() => setPage("search")}>기록 검색 →</button></div>{quests.filter(q => q.status !== "DONE").length ? <div className="quest-grid">{quests.filter(q => q.status !== "DONE").map(quest => <article className="quest-card-large" key={quest.id}><div className="quest-card-top"><span className={`status-pill ${quest.status === "IN_PROGRESS" ? "active" : "todo"}`}>{quest.status === "IN_PROGRESS" ? "진행 중" : "시작 전"}</span><span>퀘스트</span></div><span className="quest-card-symbol">◇</span><h2>{quest.title}</h2><p className="quest-description">{quest.description}</p><div className="quest-plan"><strong>실행 단계</strong><ol>{quest.steps?.map((step, index) => <li key={index}>{step}</li>)}</ol></div><div className="completion-box"><strong>완료 기준</strong><p>{quest.completionCriteria || "완료 기준이 아직 지정되지 않았습니다."}</p></div><div className="quest-card-actions"><button className="text-link" onClick={() => { setStudioQuest(quest.id); setPage("studio") }}>결과물 만들기 →</button></div></article>)}</div> : <EmptyState icon="◇" title="아직 진행 중인 퀘스트가 없습니다" copy="기록을 바탕으로 제안을 만들고, 검토한 뒤 퀘스트로 저장하세요." action={<button className="button primary" disabled={!records.length || busy} onClick={() => void generateProposal()}>{records.length ? "기록에서 제안 받기" : "먼저 기록 추가하기"}</button>} />}
        {pending.length > 0 && <section className="proposals-section"><div className="board-section-head"><div><h2>검토할 제안</h2><span>{pending.length}개</span></div><span className="section-aside">수락하기 전에 목표와 근거를 확인하세요.</span></div><div className="proposal-list">{pending.map(proposal => <ProposalReviewCard key={proposal.id} proposal={proposal} busy={busy} onReject={item => void decide(item, "REJECT")} onAccept={(item, edited) => void decide(item, "ACCEPT_EDITED", edited)} onOpenRecord={id => { const record = records.find(row => row.id === id); if (record) setSelectedRecord(record) }} />)}</div></section>}
        {completed.length > 0 && <section className="completed-section"><div className="board-section-head"><div><h2>검토 완료</h2><span>{completed.length}개</span></div></div><div className="completed-list">{completed.slice(0, 6).map(item => <div className="completed-row" key={item.id}><span className={`completed-mark ${item.status === "ACCEPTED" ? "accepted" : "rejected"}`}>{item.status === "ACCEPTED" ? "✓" : "×"}</span><span><strong>{item.title}</strong><small>{item.description}</small></span><span className="status-pill">{item.status === "ACCEPTED" ? "수락됨" : "거절됨"}</span></div>)}</div></section>}
      </main>}

      {page === "world" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">MEMORY WORLD <span className="beta inline-beta">실험</span></p><h1>기억의 세계</h1><p>기록의 주제와 연결을 둘러보는 탐색 공간입니다.</p></div><button className="button secondary" onClick={() => setPage("archive")}>기록 보관함 →</button></div>{!quests.length && <div className="journey-banner"><span className="journey-star">✦</span><div><strong>새로운 여정을 시작해 보세요</strong><p>기록을 탐색하거나 첫 퀘스트 제안을 만들어보세요. 월드맵은 실험 기능입니다.</p></div><button className="button primary" disabled={!records.length || busy} onClick={() => void generateProposal()}>{records.length ? "여정 시작하기" : "기록 추가하기"}</button></div>}{records.length ? <div className="memory-world"><div className="world-intro"><span className="world-orbit-large"><i /><i /><i /><b>R</b></span><div><p className="eyebrow">YOUR MEMORY ATLAS</p><h2>{records.length}개의 기억 조각</h2><p>현재는 기록의 태그를 기준으로 묶어 보여줍니다. 관계 경로는 아직 제안하지 않습니다.</p></div></div><div className="world-regions">{Object.entries(records.reduce<Record<string, RecordItem[]>>((groups, record) => { const key = record.tags?.[0] || "분류되지 않은 기록"; (groups[key] ||= []).push(record); return groups }, {})).map(([region, items], index) => <section className={`world-region region-${index % 3}`} key={region}><div className="region-heading"><span className="region-pin">{index === 0 ? "✦" : "◇"}</span><div><p className="eyebrow">REGION {String(index + 1).padStart(2, "0")}</p><h3>{region}</h3></div><span className="region-total">{items.length}개 기록</span></div><div className="memory-nodes">{items.map((record, itemIndex) => <button className="memory-node" key={record.id} onClick={() => setSelectedRecord(record)}><span className="node-dot">{itemIndex % 2 ? "·" : "✦"}</span><span><strong>{record.title}</strong><small>{dateLabel(record.createdAt)}</small></span><span>→</span></button>)}</div></section>)}</div></div> : <EmptyState icon="◎" title="탐색할 기록이 아직 없습니다" copy="기록을 추가하면 이곳에서 주제별로 둘러볼 수 있습니다." action={<button className="button primary" onClick={openImport}>기록 가져오기</button>} />}</main>}

      {page === "studio" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">RESULT WORKSHOP</p><h1>결과물 작업실</h1><p>퀘스트와 근거 기록을 모아 Markdown 초안을 편집합니다.</p></div><span className="workshop-stamp">DRAFT WORKSPACE</span></div>{quests.length ? <div className="studio-layout"><section className="studio-main"><label className="field-label">기준 퀘스트<select value={studioQuest} onChange={event => setStudioQuest(event.target.value)}><option value="">퀘스트를 선택하세요</option>{quests.map(quest => <option value={quest.id} key={quest.id}>{quest.title}</option>)}</select></label>{selectedQuest && <div className="studio-quest-summary"><span className="status-pill active">{selectedQuest.status === "DONE" ? "완료" : "퀘스트"}</span><h2>{selectedQuest.title}</h2><p>{selectedQuest.description}</p></div>}<div className="studio-evidence"><div className="plan-heading"><div><strong>근거 기록 선택</strong><small>초안에 포함할 원문을 선택하세요.</small></div><span>{studioRecordIds.length}개 선택</span></div>{records.length ? <div className="evidence-picker">{records.map(record => <label className="evidence-pick" key={record.id}><input type="checkbox" checked={studioRecordIds.includes(record.id)} onChange={() => toggleStudioRecord(record.id)} /><span className="checkmark">✓</span><span><strong>{record.title}</strong><small>{record.contentMarkdown.slice(0, 100)}</small></span><button type="button" className="open-record-link" onClick={event => { event.preventDefault(); setSelectedRecord(record) }}>보기</button></label>)}</div> : <p className="muted-copy">아직 연결할 기록이 없습니다.</p>}</div><button className="button primary" disabled={!selectedQuest || !studioRecordIds.length} onClick={buildDraft}>선택한 근거로 초안 구성</button></section><aside className="studio-side"><span className="side-spark">✦</span><p className="eyebrow">FROM QUEST TO STORY</p><h2>기록을 모아<br />다음 결과물로.</h2><p>현재는 선택한 퀘스트와 기록을 바탕으로 Markdown 편집 초안을 구성합니다. 자동 AI 작성은 모델 연동 후 연결할 수 있습니다.</p><ul><li>퀘스트 목표와 실행 계획</li><li>선택한 기록 원문</li><li>완료 기준</li></ul><button className="button secondary full-width" onClick={() => setPage("quests")}>퀘스트 보드 보기</button></aside></div> : <EmptyState icon="▧" title="작업할 퀘스트가 없습니다" copy="기록을 바탕으로 퀘스트를 만들면 결과물 초안을 구성할 수 있습니다." action={<button className="button primary" onClick={() => setPage("quests")}>퀘스트 보드로 이동</button>} />}{draft && <section className="draft-panel"><div className="draft-toolbar"><div><p className="eyebrow">EDITABLE MARKDOWN</p><h2>초안 편집</h2></div><div className="title-actions"><button className="button secondary" onClick={() => void copyDraft()}>복사</button><button className="button primary" onClick={downloadDraft}>Markdown 내보내기</button></div></div><textarea className="draft-editor" value={draft} onChange={event => setDraft(event.target.value)} aria-label="Markdown 초안 편집" /><p className="editor-footnote">이 초안은 브라우저에서 편집됩니다. 저장 기능은 아직 연결되지 않았습니다.</p></section>}</main>}
    </div>
    <nav className="mobile-nav" aria-label="모바일 메뉴">{nav.map(item => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><Icon>{item.icon}</Icon><span>{item.label.replace(" 보관함", "").replace(" 보드", "")}</span></button>)}</nav>
    {recordDetail}
    {recordEditor && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setRecordEditor(false) }}><form className="modal" onSubmit={saveRecord}><button type="button" className="modal-close" aria-label="닫기" onClick={() => setRecordEditor(false)}>×</button><p className="eyebrow">{editingRecord ? "EDIT RECORD" : "NEW RECORD"}</p><h2>{editingRecord ? "기록 수정" : "업무 경험 기록"}</h2><p className="modal-copy">원본 기록은 퀘스트 제안과 결과물의 근거로 활용됩니다.</p><label className="field-label">제목<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 검색 전환 개선 프로젝트 회고" required /></label><label className="field-label">내용 <span className="label-hint">Markdown 지원</span><textarea className="large-textarea" value={content} onChange={event => setContent(event.target.value)} placeholder={"상황, 내가 한 일, 결과를 자유롭게 적어보세요.\n\n## 상황\n\n## 내가 한 일\n\n## 결과"} rows={9} required /></label><div className="modal-hint">팁 · 무엇이 문제였고, 어떻게 해결했으며, 결과를 어떻게 확인했는지 적어두면 나중에 다시 찾기 쉽습니다.</div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setRecordEditor(false)}>취소</button><button className="button primary" disabled={busy}>{busy ? "저장 중…" : editingRecord ? "변경 사항 저장" : "기록 저장"}</button></div></form></div>}
  </div>
}
