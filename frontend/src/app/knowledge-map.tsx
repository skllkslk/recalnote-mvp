"use client"

import { useMemo } from "react"
import type { BusinessProjectRelation, WorldQuest, WorldRecord } from "./memory-world-model"

type KnowledgeMapProps = {
  records: WorldRecord[]
  quests: WorldQuest[]
  projects: BusinessProjectRelation[]
  onOpenRecord: (id: string) => void
  onOpenQuests: () => void
  onImport: () => void
}

type Point = { x: number; y: number }
const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  return result >>> 0
}

export function KnowledgeMap({ records, quests, projects, onOpenRecord, onOpenQuests, onImport }: KnowledgeMapProps) {
  const graph = useMemo(() => {
    const centers = new Map<string, Point>()
    projects.forEach((project, index) => {
      const angle = (index / Math.max(projects.length, 1)) * Math.PI * 2 - Math.PI / 2
      const radius = projects.length === 1 ? 0 : 205
      centers.set(project.projectId, { x: 500 + Math.cos(angle) * radius, y: 310 + Math.sin(angle) * radius * .72 })
    })
    const positions = new Map<string, Point>()
    projects.forEach(project => {
      const center = centers.get(project.projectId)!
      const members = records.filter(record => project.recordIds.includes(record.id))
      members.forEach((record, index) => {
        const angle = (index / Math.max(members.length, 1)) * Math.PI * 2 + (hash(record.id) % 628) / 100
        const radius = 45 + (hash(`${record.id}:r`) % 30)
        positions.set(record.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius })
      })
    })
    const unplaced = records.filter(record => !positions.has(record.id))
    unplaced.forEach((record, index) => {
      const angle = (index / Math.max(unplaced.length, 1)) * Math.PI * 2
      positions.set(record.id, { x: 500 + Math.cos(angle) * 85, y: 310 + Math.sin(angle) * 60 })
    })
    const questPositions = quests.map((quest, index) => {
      const linked = quest.recordIds?.map(id => positions.get(id)).filter((point): point is Point => Boolean(point)) ?? []
      if (linked.length) return { quest, point: { x: linked.reduce((sum, point) => sum + point.x, 0) / linked.length, y: linked.reduce((sum, point) => sum + point.y, 0) / linked.length - 66 } }
      const angle = (index / Math.max(quests.length, 1)) * Math.PI * 2
      return { quest, point: { x: 500 + Math.cos(angle) * 90, y: 310 + Math.sin(angle) * 70 } }
    })
    return { positions, questPositions, centers }
  }, [projects, quests, records])

  if (!records.length) return <div className="knowledge-empty"><span>✧</span><h2>아직 밝혀진 기억이 없어요</h2><p>Markdown 기록을 가져오면 주제별 별자리로 펼쳐집니다. 퀘스트를 기록과 연결하면 지도에 새로운 길이 생겨요.</p><button className="button primary" onClick={onImport}>기록 가져오기</button></div>

  return <section className="knowledge-map-shell">
    <header className="knowledge-map-header"><div><p className="eyebrow">EXPLORE YOUR KNOWLEDGE</p><h2>기억의 지도</h2><p>기록은 별이 되고, 연결된 퀘스트는 별자리 사이의 길이 됩니다.</p></div><div className="knowledge-stats"><span><b>{records.length}</b> 기억</span><span><b>{projects.length}</b> 주제</span><span><b>{quests.length}</b> 퀘스트</span><button onClick={onOpenQuests}>퀘스트 보기 ↗</button></div></header>
    <div className="knowledge-map-viewport"><svg className="knowledge-map" viewBox="0 0 1000 620" role="group" aria-label="기록과 퀘스트의 연결 지도">
      <defs><radialGradient id="nebula"><stop stopColor="#31416b" stopOpacity=".55"/><stop offset="1" stopColor="#11182b" stopOpacity="0"/></radialGradient><filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <rect width="1000" height="620" fill="#0c1222"/><ellipse cx="500" cy="310" rx="480" ry="270" fill="url(#nebula)"/>
      {Array.from({ length: 72 }, (_, index) => { const x = hash(`sx${index}`) % 980 + 10; const y = hash(`sy${index}`) % 600 + 10; return <circle key={`star-${index}`} cx={x} cy={y} r={hash(`sr${index}`) % 12 / 10 + .5} fill="#b9c7ef" opacity={.2 + (hash(`so${index}`) % 60) / 100}/> })}
      {projects.map(project => { const center = graph.centers.get(project.projectId)!; return <g key={project.projectId}><circle cx={center.x} cy={center.y} r="112" fill="none" stroke="#65739b" strokeOpacity=".13" strokeDasharray="2 9"/><text x={center.x} y={center.y - 104} className="map-cluster-label">{project.name}</text></g> })}
      {quests.flatMap(quest => (quest.recordIds ?? []).map(id => { const source = graph.positions.get(id); const target = graph.questPositions.find(item => item.quest.id === quest.id)?.point; return source && target ? <line key={`${quest.id}-${id}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="map-quest-link"/> : null }))}
      {records.map(record => { const point = graph.positions.get(record.id)!; return <g key={record.id} className="map-record-node" role="button" tabIndex={0} aria-label={`기록 열기: ${record.title}`} onClick={() => onOpenRecord(record.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onOpenRecord(record.id) }}><circle cx={point.x} cy={point.y} r="19" className="record-node-halo"/><circle cx={point.x} cy={point.y} r="8" className="record-node-core" filter="url(#glow)"/><text x={point.x} y={point.y + 31} className="map-node-label">{record.title.length > 16 ? `${record.title.slice(0, 15)}…` : record.title}</text></g> })}
      {graph.questPositions.map(({ quest, point }) => <g key={quest.id} className="map-quest-node" role="button" tabIndex={0} aria-label={`퀘스트 보기: ${quest.title}`} onClick={onOpenQuests} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onOpenQuests() }}><path d={`M ${point.x} ${point.y - 12} L ${point.x + 11} ${point.y} L ${point.x} ${point.y + 12} L ${point.x - 11} ${point.y} Z`} filter="url(#glow)"/><text x={point.x} y={point.y + 29} className="map-node-label">{quest.title.length > 16 ? `${quest.title.slice(0, 15)}…` : quest.title}</text></g>)}
      <g className="map-you-marker"><circle cx="500" cy="310" r="4"/><text x="500" y="329">YOU ARE HERE</text></g>
    </svg></div>
    <footer className="knowledge-map-footer"><span><i className="map-legend-record"/> 기록</span><span><i className="map-legend-quest"/> 퀘스트</span><span><i className="map-legend-link"/> 퀘스트 근거 연결</span><small>현재 기록의 태그와 프로젝트, 퀘스트 근거를 바탕으로 배치합니다.</small></footer>
  </section>
}
