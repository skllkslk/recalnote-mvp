"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react"
import { makeBusinessProjects } from "./memory-world-model"
import { KnowledgeMap } from "./knowledge-map"

type Page = "home" | "archive" | "import" | "search" | "quests" | "world" | "studio" | "learning" | "profile" | "agent"
type RecordItem = { id: string; title: string; contentMarkdown: string; tags?: string[]; projectId?: string; projectName?: string; version: number; createdAt: string }
type Epic = { id: string; title: string; completionCriteria: string; useCase?: "CAREER" | "LEARNING" }
type Evidence = { recordId: string; recordVersion: number; excerpt: string; recordTitle: string }
type Proposal = { epicId?: string; resultMarkdown?: string; id: string; title: string; description: string; steps: string[]; completionCriteria: string; rationale: string; evidence: Evidence[]; status: string }
type Quest = { resultMarkdown?: string; id: string; epicId: string; title: string; description: string; steps: string[]; completionCriteria: string; status: string; recordIds?: string[] }
type EditedQuest = { title: string; description: string; steps: string[]; completionCriteria: string; resultMarkdown?: string }
type CareerFields = { summary: string; project: string; period: string; role: string; challenge: string; actions: string; outcome: string }
const emptyCareerFields: CareerFields = { summary: "", project: "", period: "", role: "", challenge: "", actions: "", outcome: "" }
type PlayerProfile = { onboardingCompleted?: boolean; displayName: string; occupation: string; currentGoal: string; experienceSummary: string; interests: string[]; useCase: "CAREER" | "LEARNING" }
type AgentCardOption = { id: string; label: string; requiresText?: boolean }
type AgentCard = { type: string; id: string; title: string; options?: AgentCardOption[]; allowFreeText?: boolean; value?: unknown; sourceRefs?: Evidence[] }
type AgentSession = { sessionId: string; useCase: "CAREER" | "LEARNING"; state: string; npc: { name: string; message: string }; cards: AgentCard[]; proposalId?: string }
const emptyPlayerProfile: PlayerProfile = { displayName: "", occupation: "", currentGoal: "", experienceSummary: "", interests: [], useCase: "CAREER" }
const nav: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "홈", icon: "⌂" },
  { id: "profile", label: "Epic 선택", icon: "◎" },
  { id: "agent", label: "NPC 대화", icon: "✦" },
  { id: "quests", label: "결과물", icon: "◇" },
  { id: "archive", label: "내 경험", icon: "▤" },
]

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  })
  if (!response.ok) {
    if (response.status === 422 && path.startsWith("/agent-sessions/")) {
      throw new Error("원본 근거와 일치하는 결과물을 만들지 못했어요. 다시 시도하거나 ‘다른 기록을 찾을게요’로 내용을 보완해 주세요.")
    }
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

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim()).filter(Boolean)
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return normalizeTags(parsed)
    } catch { /* A plain string is handled as a single tag below. */ }
    return value.trim() ? [value.trim()] : []
  }
  if (value && typeof value === "object" && "value" in value) return normalizeTags(value.value)
  return []
}

function Icon({ children }: { children: string }) { return <span className="icon-mark" aria-hidden="true">{children}</span> }

function PlayerSprite() {
  return <svg viewBox="0 0 32 40" shapeRendering="crispEdges" role="img" aria-label="픽셀 모험가 캐릭터"><path fill="#8358dc" d="M7 10h18v4h-3v4h-2v4h-8v-4h-2v-4H7z"/><path fill="#f3c84f" d="M6 18h20v3H6z"/><path fill="#efb58f" d="M10 21h12v8H10z"/><path fill="#101a2d" d="M12 24h2v2h-2zm7 0h2v2h-2z"/><path fill="#5276bd" d="M8 29h16v7H8z"/><path fill="#8358dc" d="M5 29h3v7H5zm19 0h3v7h-3z"/><path fill="#18233d" d="M9 36h6v3H9zm9 0h6v3h-6z"/><path fill="#6ce8db" d="M27 22h2v15h-2zm-1-2h4v2h-4z"/></svg>
}

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
  const [resultMarkdown, setResultMarkdown] = useState(proposal.resultMarkdown ?? "")
  const canAccept = title.trim() && description.trim() && criteria.trim() && steps.length >= 2 && steps.length <= 5 && steps.every(step => step.trim())

  return <article className="proposal-card">
    <label className="field-label">결과물 본문<textarea rows={12} value={resultMarkdown} onChange={event => setResultMarkdown(event.target.value)} /></label><div className="proposal-topline"><span className="status-pill pending">검토 대기</span><span className="eyebrow">결과물 제안</span></div>
    <label className="field-label">결과물 제목<input value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="field-label">목표<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <div className="plan-editor"><div className="plan-heading"><strong>실행 단계</strong>{steps.length < 5 && <button className="inline-action" type="button" onClick={() => setSteps(current => [...current, ""])}>＋ 단계 추가</button>}</div>
      <ol>{steps.map((step, index) => <li key={index}><input aria-label={`실행 단계 ${index + 1}`} value={step} onChange={event => setSteps(current => current.map((item, i) => i === index ? event.target.value : item))} /><button className="icon-action remove-action" type="button" aria-label={`단계 ${index + 1} 삭제`} onClick={() => setSteps(current => current.length > 2 ? current.filter((_, i) => i !== index) : current.map((item, i) => i === index ? "" : item))}>×</button></li>)}</ol>
    </div>
    <label className="field-label">완료 기준<textarea rows={2} value={criteria} onChange={event => setCriteria(event.target.value)} /></label>
    {proposal.rationale && <p className="rationale">제안 이유 · {proposal.rationale}</p>}
    <div className="evidence-box"><div className="plan-heading"><strong>연결된 근거</strong><span>{proposal.evidence?.length ?? 0}개</span></div>
      {proposal.evidence?.length ? proposal.evidence.map(item => <button className="evidence-row" key={item.recordId} type="button" onClick={() => onOpenRecord(item.recordId)}><span className="evidence-title">{item.recordTitle}<small>기록 버전 {item.recordVersion}</small></span><blockquote>{item.excerpt}</blockquote><span className="evidence-open">기록 보기 →</span></button>) : <p className="muted-copy">연결된 근거가 없습니다.</p>}
    </div>
    <div className="card-actions"><button className="button secondary" disabled={busy} onClick={() => onReject(proposal)}>거절</button><button className="button primary" disabled={busy || !canAccept} onClick={() => onAccept(proposal, { title: title.trim(), description: description.trim(), steps: steps.map(step => step.trim()), completionCriteria: criteria.trim(), resultMarkdown: resultMarkdown.trim() })}>수정 후 수락</button></div>
  </article>
}

function CareerStatementForm({ fields, onChange }: { fields: CareerFields; onChange: (fields: CareerFields) => void }) {
  const update = (key: keyof CareerFields, value: string) => onChange({ ...fields, [key]: value })
  return <section className="career-template-form" aria-labelledby="career-template-title">
    <div className="career-template-heading"><div><p className="eyebrow">CAREER STATEMENT TEMPLATE</p><h3 id="career-template-title">경력기술서 기본 양식</h3></div><span>기록 근거 우선</span></div>
    <label className="field-label">한 줄 성과<input value={fields.summary} onChange={event => update("summary", event.target.value)} placeholder="문제와 행동, 기록으로 확인한 결과를 한 문장으로 요약" /></label>
    <div className="career-template-grid">
      <label className="field-label">프로젝트명<input value={fields.project} onChange={event => update("project", event.target.value)} placeholder="프로젝트 또는 서비스 이름" /></label>
      <label className="field-label">수행 기간<input value={fields.period} onChange={event => update("period", event.target.value)} placeholder="예: 2024.03 – 2024.08" /></label>
      <label className="field-label">담당 역할<textarea rows={3} value={fields.role} onChange={event => update("role", event.target.value)} placeholder="내 책임, 담당 범위, 협업한 사람이나 팀" /></label>
      <label className="field-label">문제와 목표<textarea rows={3} value={fields.challenge} onChange={event => update("challenge", event.target.value)} placeholder="어떤 상황에서 무엇을 해결하거나 달성하려 했나요?" /></label>
      <label className="field-label">내가 실행한 일<textarea rows={4} value={fields.actions} onChange={event => update("actions", event.target.value)} placeholder="직접 내린 판단과 행동, 사용한 기술이나 방법" /></label>
      <label className="field-label">결과와 검증<textarea rows={4} value={fields.outcome} onChange={event => update("outcome", event.target.value)} placeholder="결과, 수치, 검증 방법. 확인되지 않은 내용은 비워두세요." /></label>
    </div>
    <p className="career-template-note">양식은 초안에 반영됩니다. 기록에서 확인할 수 없는 수치와 사실은 추측해 채우지 마세요.</p>
  </section>
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
  const [tagsText, setTagsText] = useState("")
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [importTitle, setImportTitle] = useState("")
  const [importContent, setImportContent] = useState("")
  const [importProject, setImportProject] = useState("")
  const [importMode, setImportMode] = useState<"files" | "write">("files")
  const [studioQuest, setStudioQuest] = useState("")
  const [studioRecordIds, setStudioRecordIds] = useState<string[]>([])
  const [careerFields, setCareerFields] = useState<CareerFields>(emptyCareerFields)
  const [profile, setProfile] = useState<PlayerProfile>(emptyPlayerProfile)
  const [profileInterests, setProfileInterests] = useState("")
  const [draft, setDraft] = useState("")
  const [learningTitle, setLearningTitle] = useState("")
  const [learningContent, setLearningContent] = useState("")
  const [notice, setNotice] = useState("")
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [agentCapture, setAgentCapture] = useState("")
  const [agentTitle, setAgentTitle] = useState("")
  const [agentFreeText, setAgentFreeText] = useState<Record<string, string>>({})
  const [captureFields, setCaptureFields] = useState<Record<string, string>>({})
  const [reviewMarkdown, setReviewMarkdown] = useState("")
  const [agentBusy, setAgentBusy] = useState(false)

  async function refresh() {
    setError("")
    try {
      const [recordRows, activeEpic, proposalRows, questRows, playerProfile] = await Promise.all([
        request<RecordItem[]>("/records"), request<Epic>("/epics/active"),
        request<Proposal[]>("/quest-proposals"), request<Quest[]>("/quests"), request<PlayerProfile>("/users/me/profile"),
      ])
      setRecords(recordRows.map(record => ({ ...record, tags: normalizeTags(record.tags) })))
      setEpic(activeEpic)
      setProposals(proposalRows.filter(row => row.epicId === activeEpic.id))
      setQuests(questRows.filter(row => row.epicId === activeEpic.id))
      setProfile(playerProfile)
      if (!playerProfile.onboardingCompleted) setPage("profile")
      setProfileInterests(playerProfile.interests.join(", "))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "데이터를 불러오지 못했습니다.")
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    void request<Partial<AgentSession>>("/agent-sessions/latest").then(session => {
      if (session.sessionId) setAgentSession(session as AgentSession)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const value = agentSession?.cards.find(card => card.type === "PROPOSAL")?.value as Proposal | undefined
    setReviewMarkdown(value?.resultMarkdown ?? "")
  }, [agentSession])

  const pending = proposals.filter(item => item.status === "PENDING")
  const experienceRecords = records.filter(record => !record.tags?.includes("learning-note"))
  const learningNotes = records.filter(record => record.tags?.includes("learning-note"))
  const searchResults = useMemo(() => {
    const term = submittedQuery.trim().toLocaleLowerCase()
    if (!term) return records
    return records.filter(record => `${record.title} ${record.contentMarkdown} ${(record.tags ?? []).join(" ")}`.toLocaleLowerCase().includes(term))
  }, [records, submittedQuery])
  const selectedQuest = quests.find(quest => quest.id === studioQuest)
  const worldProjects = useMemo(() => makeBusinessProjects(experienceRecords, quests), [experienceRecords, quests])
  const learningSuggestions = [
    { title: "내 역할과 기여를 구체적으로 쓰기", copy: "팀의 결과와 내가 직접 맡은 일을 구분하는 방법을 정리해 보세요." },
    { title: "성과를 근거와 함께 표현하기", copy: "수치나 검증 자료가 있을 때 성과 문장에 연결하는 방법을 살펴보세요." },
    { title: "경력기술서 문장을 간결하게 다듬기", copy: "상황보다 행동과 결과가 잘 드러나도록 문장을 줄이는 연습을 해보세요." },
  ]
  const careerStages = [
    { title: "Epic 선택과 입력", complete: Boolean(profile.onboardingCompleted) },
    { title: "NPC 대화 · 사실 확인", complete: Boolean(agentSession?.proposalId) || quests.length > 0 },
    { title: "결과물 검토 및 승인", complete: quests.length > 0 },
  ]
  const completedCareerStages = careerStages.filter(stage => stage.complete).length
  const nextAction = !profile.onboardingCompleted ? "Epic을 선택해 주세요" : agentSession?.state === "PROPOSAL_PENDING" ? "결과물을 검토해 주세요" : agentSession ? "리콜 가이드가 기다리고 있어요" : "새로운 결과물을 만들어볼까요?"
  const nextActionHint = "경력기술서 또는 학습 로드맵을 선택하고, 편하게 입력한 뒤 NPC와 내용을 확인하세요. 마지막 승인은 직접 결정합니다."


  function openNewRecord() {
    setEditingRecord(null); setTitle(""); setContent(""); setTagsText(""); setRecordEditor(true)
  }
  function openEditRecord(record: RecordItem) {
    setEditingRecord(record); setTitle(record.title); setContent(record.contentMarkdown); setTagsText((record.tags ?? []).join(", ")); setRecordEditor(true)
  }
  function openImport() {
    setImportFiles([]); setImportTitle(""); setImportContent(""); setImportProject(""); setImportMode("files"); setPage("import")
  }
  function runSearch(event: FormEvent) {
    event.preventDefault(); setSubmittedQuery(query.trim()); setPage("search")
  }
  async function saveRecord(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    try {
      const tags = tagsText.split(",").map(tag => tag.trim()).filter(Boolean)
      const payload = JSON.stringify({ title: title.trim(), contentMarkdown: content.trim(), tags })
      const savedResponse = await request<RecordItem>(editingRecord ? `/records/${editingRecord.id}` : "/records", { method: editingRecord ? "PUT" : "POST", body: payload })
      const saved = { ...savedResponse, tags: normalizeTags(savedResponse.tags) }
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
      const tags = importProject.trim() ? [`project:${importProject.trim()}`] : []
      for (const entry of entries) await request("/records", { method: "POST", body: JSON.stringify({ ...entry, tags }) })
      await refresh(); setPage("archive"); setImportFiles([]); setImportTitle(""); setImportContent(""); setImportProject("")
      setNotice(`${entries.length}개의 Markdown 기록을 가져왔습니다.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Markdown을 가져오지 못했습니다.") }
    finally { setBusy(false) }
  }
  async function generateProposal() {
    if (!epic || !experienceRecords.length) return
    setBusy(true); setError("")
    try { await request("/agent/quest-proposals", { method: "POST", body: JSON.stringify({ epicId: epic.id }) }); await refresh(); setPage("quests"); setNotice("경력기술서 작성 단계를 제안했습니다.") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 만들지 못했습니다.") }
    finally { setBusy(false) }
  }
  function startLearningNote(topic: string) {
    setLearningTitle(topic)
    setLearningContent("## 배운 내용\n\n## 참고 자료\n\n## 경력기술서에 적용할 점\n")
  }
  async function saveLearningNote(event: FormEvent) {
    event.preventDefault()
    if (!learningTitle.trim() || !learningContent.trim()) return
    setBusy(true); setError("")
    try {
      await request("/records", { method: "POST", body: JSON.stringify({ title: learningTitle.trim(), contentMarkdown: learningContent.trim(), tags: ["learning-note"] }) })
      await refresh(); setLearningTitle(""); setLearningContent(""); setNotice("학습 노트를 저장했습니다.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "학습 노트를 저장하지 못했습니다.") }
    finally { setBusy(false) }
  }
  async function savePlayerProfile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("")
    try {
      const saved = await request<PlayerProfile>("/users/me/profile", { method: "PUT", body: JSON.stringify({ ...profile, interests: profileInterests.split(",").map(item => item.trim()).filter(Boolean) }) })
      setProfile(saved); setProfileInterests(saved.interests.join(", ")); setNotice("Epic을 선택했습니다. 편한 방식으로 내용을 입력해 주세요."); setCaptureFields({}); setAgentCapture(""); setAgentTitle(""); setAgentFreeText({}); setAgentSession(null); setPage("agent"); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "프로필을 저장하지 못했습니다.") }
    finally { setBusy(false) }
  }

  function openAgent() {
    if (!profile.onboardingCompleted) { setPage("profile"); return }
    setPage("agent")
  }

  async function startAgentSession(event: FormEvent) {
    event.preventDefault()
    const structured = Object.entries(captureFields).filter(([, value]) => value.trim()).map(([label, value]) => `## ${label}\n${value.trim()}`).join("\n\n")
    const capture = [structured, agentCapture.trim()].filter(Boolean).join("\n\n")
    if (!capture) return
    setAgentBusy(true); setError("")
    try {
      const session = await request<AgentSession>("/agent-sessions", { method: "POST", body: JSON.stringify({ useCase: profile.useCase, title: agentTitle.trim() || (captureFields["프로젝트 / 경험"] || captureFields["배우고 싶은 주제"] || "").split("\n")[0], contentMarkdown: capture }) })
      setAgentSession(session); await refresh(); setNotice("NPC가 경험을 정리하기 시작했습니다.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대화를 시작하지 못했습니다.") }
    finally { setAgentBusy(false) }
  }

  async function answerAgentCard(card: AgentCard, value: unknown) {
    if (!agentSession) return
    setAgentBusy(true); setError("")
    try {
      const session = await request<AgentSession>(`/agent-sessions/${agentSession.sessionId}/turns`, { method: "POST", body: JSON.stringify({ cardId: card.id, value }) })
      setAgentSession(session)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대화를 진행하지 못했습니다.") }
    finally { setAgentBusy(false) }
  }

  async function approveAgentSession() {
    if (!agentSession) return
    setAgentBusy(true); setError("")
    try { await request(`/agent-sessions/${agentSession.sessionId}/approve`, { method: "POST", body: JSON.stringify({ editedResultMarkdown: reviewMarkdown }) }); setAgentSession(null); await refresh(); setNotice("결과물을 승인하고 저장했습니다."); setPage("quests") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "결과를 승인하지 못했습니다.") }
    finally { setAgentBusy(false) }
  }
  async function rejectAgentResult() {
    if (!agentSession) return
    setAgentBusy(true); setError("")
    try {
      await request(`/agent-sessions/${agentSession.sessionId}/reject`, { method: "POST", body: JSON.stringify({ reason: "사용자 거절" }) })
      setAgentSession(null); await refresh(); setNotice("제안을 거절했습니다. 내용을 바꿔 다시 시작할 수 있어요.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "거절하지 못했습니다.") }
    finally { setAgentBusy(false) }
  }
  async function decide(proposal: Proposal, action: "ACCEPT_EDITED" | "REJECT", edited?: EditedQuest) {
    setBusy(true)
    try {
      await request(`/quest-proposals/${proposal.id}/decisions`, { method: "POST", body: JSON.stringify({ action, ...(edited ? { editedTitle: edited.title, editedDescription: edited.description, editedSteps: edited.steps, editedCompletionCriteria: edited.completionCriteria, editedResultMarkdown: edited.resultMarkdown } : {}) }) })
      if (agentSession?.proposalId === proposal.id) setAgentSession(null)
      await refresh(); setNotice(action === "REJECT" ? "제안을 거절했습니다." : "결과물을 승인하고 저장했습니다.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 처리하지 못했습니다.") }
    finally { setBusy(false) }
  }
  function buildDraft() {
    if (!selectedQuest) return
    const sources = experienceRecords.filter(record => studioRecordIds.includes(record.id))
    const project = careerFields.project.trim() || sources[0]?.projectName || sources[0]?.tags?.find(tag => tag.startsWith("project:"))?.slice(8) || "[프로젝트명]"
    const actions = careerFields.actions.trim() || "[확인 필요: 내가 직접 실행한 행동]"
    const text = [
      "# 경력기술서 초안", "", `## ${project}`, "",
      "### 한 줄 성과", `> ${careerFields.summary.trim() || "[문제나 목표]를 해결하기 위해 [핵심 행동]을 수행해 [검증 가능한 결과]를 만들었습니다."}`, "",
      "### 프로젝트 정보", `- 기간: ${careerFields.period.trim() || "[시작 시점 – 종료 시점]"}`, `- 역할: ${careerFields.role.trim() || "[담당한 책임과 협업 범위]"}`, "",
      "### 문제와 목표", careerFields.challenge.trim() || selectedQuest.description || "[당시 상황과 해결해야 했던 문제]", "",
      "### 실행한 일", actions, "",
      "### 결과와 검증", careerFields.outcome.trim() || "[결과와 이를 확인한 방법]", "",
      "### 근거가 된 원본 기록", ...sources.map(record => `#### ${record.title}\n> ${record.contentMarkdown.slice(0, 1600).replace(/\n/g, "\n> ")}`), "",
      "<!-- 원본 기록으로 확인되지 않는 수치나 사실은 추가하지 말고, 대괄호 항목을 실제 경험에 맞게 보완하세요. -->",
    ].join("\n")
    setDraft(text); setNotice("선택한 퀘스트와 원본 근거로 경력기술서 초안을 구성했습니다.")
  }

  function continueCareerDraft() {
    if (!experienceRecords.length) { openAgent(); return }
    if (pending.length) { setPage("quests"); return }
    const nextQuest = quests.find(quest => quest.status === "IN_PROGRESS") || quests.find(quest => quest.status !== "DONE") || quests[0]
    if (nextQuest) {
      setStudioQuest(nextQuest.id)
      setStudioRecordIds(nextQuest.recordIds ?? [])
      setPage("studio")
      return
    }
    openAgent()
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

  const recordDetail = selectedRecord && <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedRecord(null) }}><aside className="record-drawer" aria-label="기록 상세"><button className="drawer-close" onClick={() => setSelectedRecord(null)} aria-label="닫기">×</button><p className="eyebrow">원본 기록 · v{selectedRecord.version}</p><div className="drawer-meta"><span className="source-pill">직접 입력 / 가져오기</span><span>{dateLabel(selectedRecord.createdAt)}</span></div><h2>{selectedRecord.title}</h2><pre className="record-body">{selectedRecord.contentMarkdown}</pre><div className="drawer-actions"><button className="button secondary" onClick={() => openEditRecord(selectedRecord)}>기록 수정</button><button className="button danger-quiet" onClick={() => void deleteRecord(selectedRecord)}>기록 삭제</button>{!selectedRecord.tags?.includes("learning-note") && <button className="button primary" onClick={() => { setStudioRecordIds(ids => ids.includes(selectedRecord.id) ? ids : [...ids, selectedRecord.id]); setSelectedRecord(null); setPage("studio") }}>경력기술서 근거로 선택</button>}</div></aside></div>

  return <div className="app-shell">
    <div className="app-main">
      <div className="app-hud">
        <header className="topbar"><button type="button" className={`player-hud ${page === "profile" ? "selected" : ""}`} onClick={() => setPage("profile")} aria-label="내 플레이어 프로필 열기"><span className="top-player-sprite"><PlayerSprite /></span><span className="top-player-details"><small>PLAYER · LV.{completedCareerStages + 1}</small><strong>{profile.displayName || "프로필 입력"}</strong><span>기록 {experienceRecords.length} · 단계 {quests.length}</span><i className="player-progress"><b style={{ width: `${completedCareerStages / careerStages.length * 100}%` }} /></i></span><span className="profile-open-mark">↗</span></button><div className="topbar-right"><button className="brand hud-brand" onClick={() => setPage("home")}><span className="brand-mark">R</span><span>RecallNote</span></button><button className="button primary" onClick={openNewRecord}>＋ 새 기록</button></div></header>
      </div>      {(error || notice) && <div className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice("") }}>닫기</button></div>}
      {page === "agent" && <main className="page inner-page agent-page">
        <button className="back-link" onClick={() => setPage("home")}>← 홈</button>
        <div className="page-title"><div><p className="eyebrow">NPC SESSION · {profile.useCase === "LEARNING" ? "LEARNING ROADMAP" : "CAREER STATEMENT"}</p><h1>리콜 가이드와 시작하기</h1><p>기록을 목록에서 조립하지 않아도 괜찮아요. 경험을 이야기하면 필요한 내용을 함께 정리합니다.</p></div><span className="workshop-stamp">GUIDED QUEST</span></div>
        {!agentSession ? <form className="agent-capture-card" onSubmit={startAgentSession}>
          <div className="npc-avatar"><PlayerSprite /></div>
          <div className="npc-bubble"><p className="eyebrow">리콜 가이드</p><h2>{profile.useCase === "LEARNING" ? "무엇을 배우고 싶나요?" : "어떤 경험을 정리해볼까요?"}</h2><p>{profile.useCase === "LEARNING" ? "배우고 싶은 주제와 지금 알고 있는 내용을 편하게 적어주세요." : "문제, 내가 한 일, 결과를 완벽한 형식 없이 자유롭게 들려주세요."}</p></div>
          <p className="eyebrow">02 · 자유 입력</p><p className="muted-copy">아는 항목만 채워도 괜찮아요. 아래 양식과 자유 입력을 함께 쓰거나 하나만 사용하세요.</p>
          <div className="career-template-grid">{(profile.useCase === "LEARNING" ? ["배우고 싶은 주제", "현재 수준", "학습 목표", "주당 학습 가능 시간", "원하는 결과물"] : ["프로젝트 / 경험", "기간", "내 역할", "문제와 목표", "내가 한 행동", "결과와 확인 방법"]).map(label => <label className="field-label" key={label}>{label}<textarea rows={2} value={captureFields[label] ?? ""} onChange={event => setCaptureFields(current => ({ ...current, [label]: event.target.value }))} placeholder="선택 사항 · 자유롭게 적어주세요" /></label>)}</div>
          <label className="field-label">제목 <span className="label-hint">선택 사항</span><input value={agentTitle} onChange={event => setAgentTitle(event.target.value)} placeholder={profile.useCase === "LEARNING" ? "예: Spring Security 학습" : "예: 협력사 권한 오류 수정"} /></label>
          <label className="field-label">{profile.useCase === "LEARNING" ? "학습 재료" : "경험 이야기"}<textarea className="large-textarea" rows={6} value={agentCapture} onChange={event => setAgentCapture(event.target.value)} placeholder={profile.useCase === "LEARNING" ? "배우고 싶은 것, 현재 수준, 프로젝트에서 막힌 부분을 자유롭게 적어주세요." : "어떤 문제가 있었고, 내가 무엇을 했으며, 결과를 어떻게 확인했는지 자유롭게 적어주세요."} /></label>
          <div className="form-actions"><button type="button" className="button secondary" onClick={() => setPage("home")}>나중에 하기</button><button type="submit" className="button primary" disabled={agentBusy || (!agentCapture.trim() && !Object.values(captureFields).some(value => value.trim()))}>{agentBusy ? "대화 준비 중…" : "NPC와 정리 시작하기 →"}</button></div>
        </form> : <section className="agent-dialogue-card">
          <div className="agent-dialogue-header"><div className="npc-avatar small"><PlayerSprite /></div><div><p className="eyebrow">리콜 가이드</p><strong>{agentSession.npc.message}</strong></div><span className="status-pill active">{agentSession.state === "PROPOSAL_PENDING" ? "결과 확인" : "대화 중"}</span></div>
          <div className="agent-card-list">{agentSession.cards.map(card => <article className={`agent-card agent-card-${card.type.toLowerCase()}`} key={card.id}><p className="eyebrow">{card.type === "EVIDENCE" ? "원본 근거 확인" : card.type === "PROPOSAL" ? "AI 제안" : "확인할 내용"}</p><h2>{card.title}</h2>{card.type === "PROPOSAL" && card.value != null && typeof card.value === "object" && <div className="agent-proposal-preview"><strong>{String((card.value as Record<string, unknown>).title ?? "")}</strong><p>{String((card.value as Record<string, unknown>).description ?? "")}</p><ol>{Array.isArray((card.value as Record<string, unknown>).steps) && ((card.value as Record<string, unknown>).steps as unknown[]).map((step, index) => <li key={index}>{String(step)}</li>)}</ol><p className="completion-box"><strong>완료 기준</strong><br />{String((card.value as Record<string, unknown>).completionCriteria ?? "")}</p></div>}
              {card.type === "CONFIRMATION" && <pre className="record-body">{String(card.value ?? "")}</pre>}
              {card.type === "EVIDENCE" && <><blockquote>{String(card.value ?? "")}</blockquote>{card.sourceRefs?.map(source => <small key={`${source.recordId}-${source.recordVersion}`}>원본 기록 v{source.recordVersion}</small>)}</>}
              {card.type !== "PROPOSAL" && <div className="agent-card-options">{card.options?.map(option => <button className="button secondary" key={option.id} disabled={agentBusy || (option.requiresText && !agentFreeText[card.id]?.trim())} onClick={() => void answerAgentCard(card, agentFreeText[card.id] && option.requiresText ? agentFreeText[card.id].trim() : option.id)}>{option.label}</button>)}</div>}
              {card.allowFreeText && <div className="agent-free-text"><textarea rows={4} value={agentFreeText[card.id] ?? ""} onChange={event => setAgentFreeText(current => ({ ...current, [card.id]: event.target.value }))} placeholder="직접 입력할 내용" /><button className="button primary" disabled={agentBusy || !agentFreeText[card.id]?.trim()} onClick={() => void answerAgentCard(card, agentFreeText[card.id].trim())}>답변 보내기</button></div>}
              {card.type === "PROPOSAL" && <><label className="field-label">결과물 · Markdown 편집<textarea className="draft-editor" rows={18} value={reviewMarkdown} onChange={event => setReviewMarkdown(event.target.value)} /></label><p className="muted-copy">원본과 내용을 확인해 주세요. 승인하면 편집한 결과물이 저장됩니다.</p><div className="form-actions"><button className="button secondary" disabled={agentBusy} onClick={() => setPage("home")}>보류</button><button className="button secondary" disabled={agentBusy} onClick={() => void rejectAgentResult()}>거절하고 다시 입력</button><button className="button primary" disabled={agentBusy || !reviewMarkdown.trim()} onClick={() => void approveAgentSession()}>이 결과 승인하기</button></div></>}

            </article>)}</div>
        </section>}
      </main>}
      {page === "profile" && <main className="page inner-page profile-page">
        <div className="page-title"><div><p className="eyebrow">PLAYER PROFILE</p><h1>첫 모험의 Epic을 선택하세요</h1><p>프로필은 경력기술서 작성과 학습 제안을 개인화하는 데 사용됩니다.</p></div></div>
        <div className="profile-layout">
          <section className="profile-character-card"><span className="profile-level">LV. {String(completedCareerStages + 1).padStart(2, "0")}</span><div className="profile-character-scene"><PlayerSprite /><span className="profile-class">MEMORY ALCHEMIST</span></div><div className="profile-character-stats"><span><small>경험 기록</small><b>{experienceRecords.length}</b></span><span><small>학습 노트</small><b>{learningNotes.length}</b></span><span><small>작성 단계</small><b>{quests.length}</b></span></div><div className="profile-xp"><div><small>CAREER QUEST</small><b>{completedCareerStages}/{careerStages.length} 단계</b></div><i><b style={{ width: `${completedCareerStages / careerStages.length * 100}%` }} /></i></div></section>
          <form className="profile-form" onSubmit={savePlayerProfile}><div className="profile-form-heading"><div><p className="eyebrow">PLAYER PROFILE</p><h2>{profile.displayName || "모험가"}</h2></div><span className="profile-online">PROFILE</span></div><p className="eyebrow">01 · EPIC 선택</p><p className="profile-form-intro">먼저 어떤 결과물을 만들지 선택해 주세요. 선택에 따라 NPC의 질문과 제안이 달라집니다.</p>
            <div className="use-case-picker"><button type="button" className={`use-case-option ${profile.useCase === "CAREER" ? "selected" : ""}`} onClick={() => setProfile({ ...profile, useCase: "CAREER" })}><strong>경력기술서 초안</strong><small>경험을 성과 중심의 문장과 작성 단계로 정리</small></button><button type="button" className={`use-case-option ${profile.useCase === "LEARNING" ? "selected" : ""}`} onClick={() => setProfile({ ...profile, useCase: "LEARNING" })}><strong>학습 로드맵</strong><small>경험과 목표를 다음 학습 단계로 연결</small></button></div>
            <label className="field-label">표시 이름<input value={profile.displayName} onChange={event => setProfile({ ...profile, displayName: event.target.value })} placeholder="예: 김리콜" /></label>
            {profile.useCase === "CAREER" ? <><label className="field-label">현재 역할<input value={profile.occupation} onChange={event => setProfile({ ...profile, occupation: event.target.value })} placeholder="예: 백엔드 개발자" /></label><label className="field-label">목표 직무 또는 작성 목적<input value={profile.currentGoal} onChange={event => setProfile({ ...profile, currentGoal: event.target.value })} placeholder="예: 새로운 팀으로 이직" /></label><label className="field-label">경력 요약<textarea rows={4} value={profile.experienceSummary} onChange={event => setProfile({ ...profile, experienceSummary: event.target.value })} placeholder="연차, 주요 분야, 해온 일을 간단히 적어보세요." /></label><label className="field-label">관심 기술 <span className="label-hint">쉼표로 구분</span><input value={profileInterests} onChange={event => setProfileInterests(event.target.value)} placeholder="예: Spring Boot, 접근성, 데이터" /></label></> : <><label className="field-label">현재 학습 수준<input value={profile.occupation} onChange={event => setProfile({ ...profile, occupation: event.target.value })} placeholder="예: 기본 개념을 아는 초급" /></label><label className="field-label">학습 목표<input value={profile.currentGoal} onChange={event => setProfile({ ...profile, currentGoal: event.target.value })} placeholder="예: 실제 프로젝트에 적용하기" /></label><label className="field-label">배우고 싶은 주제<textarea rows={4} value={profile.experienceSummary} onChange={event => setProfile({ ...profile, experienceSummary: event.target.value })} placeholder="어떤 주제를 어떤 이유로 배우고 싶은지 적어보세요." /></label><label className="field-label">관심 분야 <span className="label-hint">쉼표로 구분</span><input value={profileInterests} onChange={event => setProfileInterests(event.target.value)} placeholder="예: 보안, 테스트, 시스템 설계" /></label></>}
            <p className="profile-ai-note">이 정보는 AI 제안의 맥락으로만 사용됩니다. 경력 성과는 저장된 원본 기록으로 확인합니다.</p><div className="form-actions"><button type="button" className="button secondary" onClick={() => setPage("home")}>취소</button><button type="submit" className="button primary" disabled={busy}>{busy ? "저장 중…" : "저장하고 입력 시작하기 →"}</button></div>
          </form>
        </div>
      </main>}
      {page === "home" && <main className="page home-dashboard">
        <section className="dashboard-search-section"><form className="search-bar dashboard-search" onSubmit={runSearch}><Icon>{"⌕"}</Icon><input value={query} onChange={event => setQuery(event.target.value)} placeholder="어떤 경험을 탐색할까요?" aria-label="기록 검색"/><button className="search-submit" type="submit">탐색 <span>→</span></button></form></section>

        <section className="career-journey-card">
          <div className="career-journey-top"><div><p className="eyebrow">QUEST LOG · 01</p><h2>{profile.useCase === "LEARNING" ? "학습 로드맵 만들기" : "경력기술서 초안 만들기"}</h2><p>{epic?.completionCriteria ?? "경험을 원본 근거와 함께 경력기술서로 정리합니다."}</p></div><span className="career-stage-count">{completedCareerStages}/{careerStages.length}<small>단계 완료</small></span></div>
          <div className="career-progress-track" role="progressbar" aria-label="경력기술서 진행률" aria-valuemin={0} aria-valuemax={careerStages.length} aria-valuenow={completedCareerStages}><span style={{ width: `${completedCareerStages / careerStages.length * 100}%` }} /></div>
          <div className="career-stage-list">{careerStages.map((stage, index) => <div className={`career-stage ${stage.complete ? "complete" : ""}`} key={stage.title}><i>{stage.complete ? "✓" : index + 1}</i><span>{stage.title}</span></div>)}</div>
          <div className="career-next-action"><div><p className="eyebrow">NEXT STEP</p><strong>{nextAction}</strong><small>{nextActionHint}</small></div><button className="button primary" onClick={openAgent}>{agentSession ? "NPC 대화 이어가기" : "NPC와 결과물 만들기"}<span>→</span></button></div>
          <div className="career-bonus-link"><span>{learningNotes.length ? `학습 노트 ${learningNotes.length}개 저장됨` : "선택 사항 · 학습한 내용도 남겨보세요"}</span><div className="career-utility-links"><button onClick={() => setPage("learning")}>학습 노트 열기 →</button><button onClick={() => setPage("world")}>기억 지도 →</button></div></div>
        </section>
        <section className="home-status-row" aria-label="작업 현황"><button onClick={() => setPage("archive")}><span className="status-pixel-icon">▤</span><span><small>경험 기록</small><strong>{experienceRecords.length}</strong></span><i>열기 →</i></button><button onClick={() => setPage("learning")}><span className="status-pixel-icon learning">✎</span><span><small>학습 노트</small><strong>{learningNotes.length}</strong></span><i>열기 →</i></button></section>
      </main>}

      {page === "search" && <main className="page inner-page"><div className="search-results-head"><button className="back-link" onClick={() => setPage("home")}>← 홈</button><form className="search-bar compact" onSubmit={runSearch}><Icon>⌕</Icon><input value={query} onChange={event => setQuery(event.target.value)} placeholder="기록 검색" aria-label="검색어" /><button className="search-submit" type="submit">검색</button></form></div><div className="page-title"><div><p className="eyebrow">QUICK SEARCH</p><h1>{submittedQuery ? `“${submittedQuery}” 검색 결과` : "전체 기록"}</h1><p>{searchResults.length}개의 기록이 검색되었습니다.</p></div></div>{loading ? <div className="loading-state">기록을 불러오는 중…</div> : searchResults.length ? <div className="results-layout"><div className="result-list">{searchResults.map(record => <button className="result-card" key={record.id} onClick={() => setSelectedRecord(record)}><div className="result-meta"><span className="source-pill">기록 · v{record.version}</span><span>{dateLabel(record.createdAt)}</span></div><h2>{record.title}</h2><p>{record.contentMarkdown.slice(0, 360)}</p><span className="result-open">원본 기록 보기 →</span></button>)}</div><aside className="search-assist"><span className="assist-gem">✦</span><p className="eyebrow">NEXT STEP</p><h2>찾은 경험을<br />경력기술서로 이어보세요.</h2><p>기록을 바탕으로 작성 단계를 제안하고, 원본 근거를 확인할 수 있습니다.</p><button className="button primary full-width" disabled={!experienceRecords.length || busy} onClick={() => void generateProposal()}>{busy ? "제안 만드는 중…" : "작성 단계 제안 받기 →"}</button><button className="button secondary full-width" onClick={() => setPage("studio")}>경력기술서</button></aside></div> : <EmptyState icon="⌕" title="검색 결과가 없습니다" copy="검색어를 바꾸거나 기록 보관함에 경험을 추가해 보세요." action={<><button className="button secondary" onClick={openImport}>기록 가져오기</button><button className="button primary" onClick={openNewRecord}>직접 기록하기</button></>} />}</main>}

      {page === "archive" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">RECORD ARCHIVE</p><h1>내 경험</h1><p>경력기술서의 근거가 될 프로젝트 경험과 결과를 확인합니다.</p></div><div className="title-actions"><button className="button secondary" onClick={openNewRecord}>＋ 직접 입력</button><button className="button primary" onClick={openImport}>↥ Markdown 가져오기</button></div></div><div className="archive-toolbar"><span>전체 기록 <strong>{experienceRecords.length}</strong></span><span className="toolbar-note">원본 경험을 확인하고 경력기술서 근거로 선택하세요.</span></div>{loading ? <div className="loading-state">기록을 불러오는 중…</div> : experienceRecords.length ? <div className="archive-grid">{experienceRecords.map(record => <button className="archive-card" key={record.id} onClick={() => setSelectedRecord(record)}><div className="archive-card-top"><span className="source-pill">기록 · v{record.version}</span><span>{dateLabel(record.createdAt)}</span></div><h2>{record.title}</h2><p>{record.contentMarkdown.slice(0, 230)}{record.contentMarkdown.length > 230 ? "…" : ""}</p><div className="archive-card-foot"><span>{record.tags?.length ? record.tags.join(" · ") : "Markdown 기록"}</span><span>원본 열기 →</span></div></button>)}</div> : <EmptyState icon="▤" title="아직 저장된 기록이 없어요" copy="Markdown 파일을 가져오거나 업무 경험을 직접 적어보세요." action={<><button className="button secondary" onClick={openNewRecord}>직접 기록하기</button><button className="button primary" onClick={openImport}>Markdown 가져오기</button></>} />}</main>}

      {page === "import" && <main className="page inner-page import-page"><button className="back-link" onClick={() => setPage("archive")}>← 기록 보관함</button><div className="page-title"><div><p className="eyebrow">ADD TO YOUR ARCHIVE</p><h1>기록 가져오기</h1><p>Markdown 원문을 보관함에 추가합니다. 원본 내용은 그대로 저장됩니다.</p></div></div><div className="import-tabs"><button className={importMode === "files" ? "selected" : ""} onClick={() => setImportMode("files")}>파일 가져오기</button><button className={importMode === "write" ? "selected" : ""} onClick={() => setImportMode("write")}>직접 입력</button></div><form className="import-panel" onSubmit={importMarkdown}><label className="field-label world-project-field">프로젝트 연결 <span className="label-hint">선택 사항 ? 파일은 모두 같은 프로젝트에 연결</span><input value={importProject} onChange={event => setImportProject(event.target.value)} placeholder="예: 정산 시스템" /></label>{importMode === "files" ? <><label className="drop-zone"><input type="file" accept=".md,text/markdown" multiple onChange={event => void filesChanged(event)} /><span className="drop-icon">↥</span><strong>Markdown 파일을 선택하세요</strong><small>여러 개의 .md 파일을 한 번에 가져올 수 있습니다.</small><span className="button secondary">파일 선택</span></label>{importFiles.length > 0 && <div className="selected-files"><div className="plan-heading"><strong>가져올 파일</strong><span>{importFiles.length}개</span></div>{importFiles.map(file => <div className="file-row" key={`${file.name}-${file.size}`}><span>▤</span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></div>)}</div>}</> : <><label className="field-label">제목<input value={importTitle} onChange={event => setImportTitle(event.target.value)} placeholder="예: 검색 전환 개선 회고" required /></label><label className="field-label">프로젝트 / 주제 태그 <span className="label-hint">쉼표로 구분</span><input value={tagsText} onChange={event => setTagsText(event.target.value)} placeholder="project:정산 시스템, 회고" /></label><label className="field-label">내용 <span className="label-hint">Markdown 지원</span><textarea className="large-textarea" value={importContent} onChange={event => setImportContent(event.target.value)} placeholder={"상황, 내가 한 일, 결과를 자유롭게 적어보세요.\n\n## 상황\n\n## 내가 한 일\n\n## 결과"} rows={12} required /></label></>}<div className="import-footnote"><span>ⓘ</span><p>가져온 내용은 원문 기록으로 저장됩니다. 구조화된 분석과 AI 제안은 이후 단계에서 별도로 검토할 수 있습니다.</p></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setPage("archive")}>취소</button><button type="submit" className="button primary" disabled={busy || (importMode === "files" ? !importFiles.length : !importTitle.trim() || !importContent.trim())}>{busy ? "가져오는 중…" : importMode === "files" ? `${importFiles.length || ""}개 파일 가져오기` : "기록 저장"}</button></div></form></main>}

      {page === "quests" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">03 · REVIEW & APPROVE</p><h1>결과물 검토 및 승인</h1><p>선택한 Epic: {epic?.title}</p></div><button className="button primary" onClick={openAgent}>{agentSession ? "NPC 대화 이어가기" : "새 결과물 만들기"}</button></div>
        {agentSession?.state === "PROPOSAL_PENDING" && <div className="goal-banner"><p>NPC가 만든 결과물이 검토를 기다리고 있어요.</p><button className="button primary" onClick={() => setPage("agent")}>결과물 검토하기 →</button></div>}
        <section className="proposals-section"><h2>검토할 제안</h2>{pending.map(proposal => <ProposalReviewCard key={proposal.id} proposal={proposal} busy={busy} onReject={item => void decide(item, "REJECT")} onAccept={(item, edited) => void decide(item, "ACCEPT_EDITED", edited)} onOpenRecord={id => { const record = records.find(row => row.id === id); if (record) setSelectedRecord(record) }} />)}</section>
        <h2>승인한 결과물</h2>{quests.length ? <div className="quest-grid">{quests.map(quest => <article className="quest-card-large" key={quest.id}><span className="status-pill active">승인됨</span><h2>{quest.title}</h2><pre className="record-body">{quest.resultMarkdown || quest.description}</pre><details><summary>실행 단계와 완료 기준</summary><ol>{quest.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><p>{quest.completionCriteria}</p></details><button className="button secondary" onClick={() => { const blob = new Blob([quest.resultMarkdown || quest.description], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "recallnote-result.md"; anchor.click(); URL.revokeObjectURL(url) }}>Markdown 내보내기</button></article>)}</div> : <EmptyState icon="◇" title="승인한 결과물이 없습니다" copy="NPC와 대화하고 결과물을 검토한 뒤 승인해 주세요." action={<button className="button primary" onClick={openAgent}>NPC 만나기 →</button>} />}
      </main>}

      {page === "learning" && <main className="page inner-page learning-page">
        <div className="page-title"><div><p className="eyebrow">LEARNING NOTES</p><h1>학습 노트</h1><p>경력기술서를 보완하며 새로 배운 내용과 다음에 적용할 점을 기록합니다.</p></div><div className="title-actions"><button className="button secondary" onClick={() => setPage("studio")}>경력기술서로 돌아가기</button><button className="button primary" onClick={() => { setLearningTitle(""); setLearningContent("## 배운 내용\n\n## 참고 자료\n\n## 경력기술서에 적용할 점\n") }}>＋ 학습 기록</button></div></div>
        <section className="learning-suggestions"><div className="learning-section-heading"><div><p className="eyebrow">SUGGESTED TOPICS</p><h2>경력기술서에 도움이 되는 학습 주제</h2></div><p>주제를 선택해 배운 내용을 직접 정리해 보세요.</p></div><div className="learning-topic-grid">{learningSuggestions.map(topic => <button className="learning-topic-card" key={topic.title} onClick={() => startLearningNote(topic.title)}><span>✦</span><strong>{topic.title}</strong><small>{topic.copy}</small><i>노트 작성 →</i></button>)}</div></section>
        {learningTitle && <form className="learning-editor-card" onSubmit={saveLearningNote}><div className="learning-section-heading"><div><p className="eyebrow">NEW LEARNING NOTE</p><h2>배운 내용을 기록하기</h2></div><button type="button" className="text-link" onClick={() => { setLearningTitle(""); setLearningContent("") }}>닫기</button></div><label className="field-label">주제<input value={learningTitle} onChange={event => setLearningTitle(event.target.value)} required /></label><label className="field-label">학습 내용<textarea className="large-textarea" rows={9} value={learningContent} onChange={event => setLearningContent(event.target.value)} placeholder="배운 점, 참고 자료, 경력기술서에 적용할 점을 적어보세요." required /></label><div className="form-actions"><button type="submit" className="button primary" disabled={busy || !learningContent.trim()}>{busy ? "저장 중…" : "학습 노트 저장"}</button></div></form>}
        <section className="learning-saved-section"><div className="learning-section-heading"><div><p className="eyebrow">YOUR NOTES</p><h2>저장한 학습 노트</h2></div><span>{learningNotes.length}개</span></div>{learningNotes.length ? <div className="learning-saved-list">{learningNotes.map(note => <button className="learning-saved-row" key={note.id} onClick={() => setSelectedRecord(note)}><span>✎</span><strong>{note.title}</strong><small>{dateLabel(note.createdAt)}</small><i>열기 →</i></button>)}</div> : <p className="learning-empty-copy">아직 학습 노트가 없습니다. 위 주제 중 하나를 골라 첫 노트를 만들어 보세요.</p>}</section>
      </main>}

      {page === "world" && <main className="page inner-page world-map-page">
        <div className="page-title"><div><p className="eyebrow">EXPLORE YOUR KNOWLEDGE</p><h1>기억의 세계</h1><p>기록과 퀘스트가 연결되며 나만의 지식 지도가 밝혀집니다.</p></div><button className="button secondary" onClick={openImport}>기록 가져오기</button></div>
        <KnowledgeMap records={experienceRecords} quests={quests} projects={worldProjects} onOpenRecord={id => { const record = records.find(item => item.id === id); if (record) setSelectedRecord(record) }} onOpenQuests={() => setPage("quests")} onImport={openImport} />
      </main>}

      {page === "studio" && <main className="page inner-page"><div className="page-title"><div><p className="eyebrow">CAREER STATEMENT WORKSPACE</p><h1>경력기술서 작업실</h1><p>작성 단계와 원본 근거를 모아 성과 중심의 Markdown 초안을 만듭니다.</p></div><span className="workshop-stamp">DRAFT WORKSPACE</span></div>{quests.length ? <div className="studio-layout"><section className="studio-main"><label className="field-label">작성 단계<select value={studioQuest} onChange={event => { const quest = quests.find(item => item.id === event.target.value); setStudioQuest(event.target.value); setStudioRecordIds(quest?.recordIds ?? []) }}><option value="">작성 단계를 선택하세요</option>{quests.map(quest => <option value={quest.id} key={quest.id}>{quest.title}</option>)}</select></label>{selectedQuest && <div className="studio-quest-summary"><span className="status-pill active">{selectedQuest.status === "DONE" ? "완료" : "작성 단계"}</span><h2>{selectedQuest.title}</h2><p>{selectedQuest.description}</p></div>}{selectedQuest && <CareerStatementForm fields={careerFields} onChange={setCareerFields} />}<div className="studio-evidence"><div className="plan-heading"><div><strong>근거 기록 선택</strong><small>초안에 포함할 원본 경험을 선택하세요.</small></div><span>{studioRecordIds.length}개 선택</span></div>{experienceRecords.length ? <div className="evidence-picker">{experienceRecords.map(record => <label className="evidence-pick" key={record.id}><input type="checkbox" checked={studioRecordIds.includes(record.id)} onChange={() => toggleStudioRecord(record.id)} /><span className="checkmark">✓</span><span><strong>{record.title}</strong><small>{record.contentMarkdown.slice(0, 100)}</small></span><button type="button" className="open-record-link" onClick={event => { event.preventDefault(); setSelectedRecord(record) }}>원문 보기</button></label>)}</div> : <p className="muted-copy">아직 연결할 기록이 없습니다.</p>}</div><button className="button primary" disabled={!selectedQuest || !studioRecordIds.length} onClick={buildDraft}>근거로 경력기술서 초안 만들기</button></section><aside className="studio-side"><span className="side-spark">✦</span><p className="eyebrow">EVIDENCE FIRST</p><h2>경험을<br />성과 문장으로.</h2><p>기록에서 확인할 수 있는 사실과 직접 보완할 항목을 나눠 초안을 구성합니다. 수치와 역할은 원문을 확인해 채워주세요.</p><ul><li>프로젝트와 담당 역할</li><li>문제와 내가 한 행동</li><li>측정 가능한 결과와 근거</li></ul><button className="button secondary full-width" onClick={() => setPage("quests")}>작성 단계 보기</button><button className="button secondary full-width" onClick={() => setPage("learning")}>학습 주제 살펴보기</button></aside></div> : <EmptyState icon="▧" title="먼저 작성 단계를 만들어주세요" copy="경험 기록에서 경력기술서 작성을 위한 작은 단계를 제안받을 수 있습니다." action={<button className="button primary" onClick={() => setPage("quests")}>작성 단계 만들기</button>} />}{draft && <section className="draft-panel"><div className="draft-toolbar"><div><p className="eyebrow">EDITABLE MARKDOWN</p><h2>경력기술서 초안 편집</h2></div><div className="title-actions"><button className="button secondary" onClick={() => void copyDraft()}>복사</button><button className="button primary" onClick={downloadDraft}>Markdown 내보내기</button></div></div><textarea className="draft-editor" value={draft} onChange={event => setDraft(event.target.value)} aria-label="경력기술서 초안 편집" /><p className="editor-footnote">초안은 현재 브라우저에서만 편집됩니다. 수치와 사실을 원본 기록으로 확인한 뒤 내보내세요.</p></section>}</main>}
    </div>

    <nav className="inventory-dock" aria-label="게임 메뉴">
      <div className="inventory-heading"><span>INVENTORY</span><span>메뉴 · {nav.length} SLOTS</span></div>
      <div className="icon-menu">{nav.map((item, index) => <button type="button" key={item.id} aria-current={page === item.id ? "page" : undefined} className={`icon-menu-item ${page === item.id ? "active" : ""}`} onClick={() => item.id === "agent" ? openAgent() : setPage(item.id)}><span className="slot-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="menu-icon" aria-hidden="true">{item.icon}</span><span className="menu-label">{item.label}</span>{item.id === "quests" && pending.length > 0 && <span className="menu-badge">{pending.length}</span>}</button>)}</div>
    </nav>

    {recordDetail}
    {recordEditor && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setRecordEditor(false) }}><form className="modal" onSubmit={saveRecord}><button type="button" className="modal-close" aria-label="닫기" onClick={() => setRecordEditor(false)}>×</button><p className="eyebrow">{editingRecord ? "EDIT RECORD" : "NEW RECORD"}</p><h2>{editingRecord ? "기록 수정" : "업무 경험 기록"}</h2><p className="modal-copy">원본 경험은 경력기술서 작성의 근거로 활용됩니다.</p><label className="field-label">제목<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 검색 전환 개선 프로젝트 회고" required /></label><label className="field-label">내용 <span className="label-hint">Markdown 지원</span><textarea className="large-textarea" value={content} onChange={event => setContent(event.target.value)} placeholder={"상황, 내가 한 일, 결과를 자유롭게 적어보세요.\n\n## 상황\n\n## 내가 한 일\n\n## 결과"} rows={9} required /></label><div className="modal-hint">팁 · 무엇이 문제였고, 어떻게 해결했으며, 결과를 어떻게 확인했는지 적어두면 나중에 다시 찾기 쉽습니다.</div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setRecordEditor(false)}>취소</button><button className="button primary" disabled={busy}>{busy ? "저장 중…" : editingRecord ? "변경 사항 저장" : "기록 저장"}</button></div></form></div>}
  </div>
}
