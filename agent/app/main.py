import os
from typing import Any
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="RecallNote Agent API", docs_url=None, redoc_url=None)

class GenerateRequest(BaseModel):
    runId: str
    userContext: dict[str, Any]
    epic: dict[str, Any]
    records: list[dict[str, Any]] = Field(default_factory=list)
    existingQuests: list[dict[str, Any]] = Field(default_factory=list)

class Evidence(BaseModel):
    recordId: str
    recordVersion: int
    excerpt: str

class Proposal(BaseModel):
    title: str
    description: str
    steps: list[str] = Field(min_length=2, max_length=5)
    completionCriteria: str
    rationale: str = ""
    evidence: list[Evidence] = Field(min_length=1)

class ProposalOutput(BaseModel):
    proposals: list[Proposal] = Field(default_factory=list)

@app.get("/health/live")
def live(): return {"status": "UP"}

@app.get("/health/ready")
def ready(): return {"status": "UP", "mode": os.getenv("AGENT_MODE", "mock")}

@app.post("/internal/v1/quest-proposals/generate")
async def generate(req: GenerateRequest, x_internal_api_key: str | None = Header(default=None)):
    expected = os.getenv("INTERNAL_API_KEY", "")
    if not expected or x_internal_api_key != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
    if os.getenv("AGENT_MODE", "mock").lower() == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise HTTPException(status_code=503, detail="OpenAI API is not configured")
        from agents import Agent, Runner
        snippets = "\n".join(f"[{r['id']} v{r['version']}] {r['title']}: {r['contentMarkdown'][:1200]}" for r in req.records)
        agent = Agent(name="RecallNote quest planner", instructions=(
            "The top-level epic is completing a career statement. Create at most one practical, achievable subquest that advances that career statement, grounded only in supplied records. "
            "Write in the language used by the records. The description states the intended outcome. "
            "Focus steps on identifying the project context and the user's role, clarifying the problem and actions, and expressing verifiable outcomes as a concise career statement bullet. "
            "Give 2-5 concrete steps starting with action verbs, and an observable completionCriteria. "
            "Avoid generic reflection tasks, invented facts or metrics, and duplicating existing quests. "
            "Cite at least one supplied record with its exact recordId and recordVersion and a short verbatim excerpt. "
            "If no relevant evidence exists, return {\"proposals\": []}."),
            output_type=ProposalOutput)
        result = await Runner.run(agent, f"User context: {req.userContext}\nEpic: {req.epic}\nExisting quests: {req.existingQuests}\nRecords:\n{snippets}\nReturn structured output.")
        output = result.final_output
        allowed = {str(r["id"]): r for r in req.records}
        proposals = []
        for proposal in output.proposals:
            evidence = [ev.model_dump() for ev in proposal.evidence
                        if ev.recordId in allowed and ev.recordVersion == allowed[ev.recordId]["version"]]
            if evidence:
                proposals.append({**proposal.model_dump(exclude={"evidence"}), "evidence": evidence})
        return {"runId": req.runId, "status": "SUCCEEDED", "proposals": proposals, "warnings": []}
    proposals = []
    existing_titles = {str(q.get("title", "")).strip().casefold() for q in req.existingQuests}
    candidate = next((r for r in req.records
                      if f"{r['title']} 경력기술서 항목 만들기".casefold() not in existing_titles), None)
    if candidate:
        r = candidate
        proposals.append({"clientProposalId": "candidate-1", "title": f"{r['title']} 경력기술서 항목 만들기",
                          "description": f"원본 경험에서 프로젝트 맥락과 맡은 역할, 해결한 문제와 실행한 행동을 정리하고 확인 가능한 성과를 경력기술서 문장으로 구성한다. 목표: {req.epic.get('completionCriteria', '')}",
                          "steps": ["기록에서 프로젝트 맥락과 본인의 역할 및 책임을 찾는다.", "해결할 문제와 직접 실행한 행동을 구분해 정리한다.", "원문으로 확인 가능한 결과를 골라 성과 중심의 경력기술서 문장으로 다듬는다."],
                          "completionCriteria": "역할, 문제, 행동, 검증 가능한 결과가 원본 기록과 연결된 경력기술서 항목으로 정리되어 있다.",
                          "rationale": "저장된 경험 기록을 경력기술서의 근거와 작성 단계로 바꿨습니다.",
                          "evidence": [{"recordId": r["id"], "recordVersion": r["version"],
                                        "excerpt": r["contentMarkdown"][:240]}]})
    return {"runId": req.runId, "status": "SUCCEEDED", "proposals": proposals, "warnings": []}
