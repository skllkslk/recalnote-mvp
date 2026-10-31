export type WorldRecord = {
  id: string
  title: string
  tags?: string[]
  projectId?: string
  projectName?: string
}

export type WorldQuest = {
  id: string
  recordIds?: string[]
}

export type BusinessProjectRelation = {
  projectId: string
  name: string
  recordIds: string[]
  questIds: string[]
}

export type TileKind = "grass" | "grassAlt" | "water" | "road" | "roadCross" | "tree" | "house" | "hall" | "flower" | "bridge"
export type WorldTile = { x: number; y: number; kind: TileKind }
export type WorldNode = { id: string; x: number; y: number }
export type VillageLayout = {
  width: number
  height: number
  tiles: WorldTile[]
  recordNodes: WorldNode[]
  questNode: { x: number; y: number } | null
  buildingCount: number
}

const slug = (value: string) => value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "untitled"
const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  return result >>> 0
}

/**
 * Business graph adapter. Prefer explicit projectId when the API provides it.
 * Until then, `project:<name>` tags are treated as project membership; ordinary
 * first tags remain a temporary topic grouping. No map coordinates are written
 * into records or this relationship model.
 */
export function makeBusinessProjects(records: WorldRecord[], quests: WorldQuest[]): BusinessProjectRelation[] {
  const grouped = new Map<string, { name: string; recordIds: string[] }>()
  records.forEach(record => {
    const projectTag = record.tags?.find(tag => tag.toLocaleLowerCase().startsWith("project:"))
    const taggedName = projectTag?.slice(projectTag.indexOf(":") + 1).trim()
    const name = record.projectName?.trim() || taggedName || record.tags?.[0]?.trim() || "\uBBF8\uBD84\uB958 \uAE30\uB85D"
    const projectId = record.projectId || `project:${slug(name)}`
    const current = grouped.get(projectId) ?? { name, recordIds: [] }
    current.recordIds.push(record.id)
    grouped.set(projectId, current)
  })
  return [...grouped.entries()].map(([projectId, project]) => ({
    projectId,
    name: project.name,
    recordIds: project.recordIds,
    questIds: quests.filter(quest => quest.recordIds?.some(recordId => project.recordIds.includes(recordId))).map(quest => quest.id),
  }))
}

/** View-only tile layout. It is deterministic for a project key and stores no business data. */
export function makeVillageLayout(projectId: string, recordIds: string[], questIds: string[], width = 18, height = 14): VillageLayout {
  const seed = hash(projectId)
  const tiles: TileKind[][] = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ((x * 13 + y * 7 + seed) % 11 === 0 ? "grassAlt" : "grass")))
  const blocked = new Set<string>()
  const key = (x: number, y: number) => `${x},${y}`
  const put = (x: number, y: number, kind: TileKind) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y][x] = kind
  }

  const pondX = 2 + seed % 3
  const pondY = 2 + (seed >>> 4) % 3
  for (let y = pondY; y < pondY + 3; y += 1) for (let x = pondX; x < pondX + 4; x += 1) {
    const dx = x - (pondX + 1.5), dy = y - (pondY + 1)
    if (dx * dx / 4 + dy * dy / 2.5 <= 1.25) { put(x, y, "water"); blocked.add(key(x, y)) }
  }

  const roadColumn = 8 + (seed % 3) - 1
  for (let y = height - 1; y >= 6; y -= 1) {
    const x = roadColumn + Math.round(Math.sin((y + seed % 9) * 0.55))
    put(x, y, "road")
    blocked.add(key(x, y))
  }
  const crossingY = 7 + (seed >>> 8) % 2
  for (let x = 4; x <= 13; x += 1) { put(x, crossingY, "road"); blocked.add(key(x, crossingY)) }
  put(roadColumn, crossingY, "roadCross")

  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const edge = x < 2 || x > width - 3 || y < 1 || y > height - 2
    const nearWater = tiles[y][x] === "water" || (x < width - 1 && tiles[y][x + 1] === "water")
    const randomValue = hash(`${projectId}:${x}:${y}`) % 100
    if (edge && !blocked.has(key(x, y)) && tiles[y][x] !== "water" && randomValue < 47) { put(x, y, "tree"); blocked.add(key(x, y)) }
    else if (nearWater && tiles[y][x] !== "water" && !blocked.has(key(x, y)) && randomValue < 12) put(x, y, "bridge")
    else if (!blocked.has(key(x, y)) && tiles[y][x].startsWith("grass") && randomValue < 5) put(x, y, "flower")
  }

  const buildingSpots = [[5, 4], [8, 3], [11, 4], [4, 8], [12, 8], [6, 9], [10, 9], [2, 6], [15, 6]] as const
  const desiredBuildings = Math.min(buildingSpots.length, Math.ceil(recordIds.length / 2))
  const buildingIndexes = buildingSpots.map((_, index) => index).sort((a, b) => hash(`${projectId}:building:${a}`) - hash(`${projectId}:building:${b}`)).slice(0, desiredBuildings)
  const buildings = buildingIndexes.map((spotIndex, index) => {
    const [x, y] = buildingSpots[spotIndex]
    put(x, y, index === 0 ? "hall" : "house")
    blocked.add(key(x, y))
    return { x, y }
  })
  const hall = buildings.find(building => tiles[building.y][building.x] === "hall")
  const questNode = hall && questIds.length ? { x: Math.min(width - 1, hall.x + 1), y: hall.y } : null

  const candidates: Array<{ x: number; y: number; rank: number }> = []
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    if (!blocked.has(key(x, y)) && (tiles[y][x] === "grass" || tiles[y][x] === "grassAlt")) candidates.push({ x, y, rank: hash(`${projectId}:node:${x}:${y}`) })
  }
  candidates.sort((a, b) => a.rank - b.rank)
  const recordNodes = [...recordIds].sort((a, b) => hash(`${projectId}:${a}`) - hash(`${projectId}:${b}`)).map((id, index) => {
    const position = candidates[index]
    return position ? { id, x: position.x, y: position.y } : null
  }).filter((node): node is WorldNode => node !== null)

  return { width, height, tiles: tiles.flatMap((row, y) => row.map((kind, x) => ({ x, y, kind }))), recordNodes, questNode, buildingCount: buildings.length }
}
