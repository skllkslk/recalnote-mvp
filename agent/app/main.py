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
            "Create at most one practical, achievable quest proposal for the given epic, grounded only in supplied records. "
            "Write in the language used by the records. The description states the intended outcome. "
            "Give 2-5 concrete steps starting with action verbs, and an observable completionCriteria. "
            "Avoid generic reflection tasks, invented facts, and duplicating existing quests. "
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
                      if f"{r['title']} 검증 및 재발 방지".casefold() not in existing_titles), None)
    if candidate:
        r = candidate
        proposals.append({"clientProposalId": "candidate-1", "title": f"{r['title']} 검증 및 재발 방지",
                          "description": f"기록에서 해결한 문제를 검증하고 같은 문제가 다시 발생하지 않도록 한다. 목표: {req.epic.get('completionCriteria', '')}",
                          "steps": ["기록에서 수정한 동작과 기대 결과를 확인한다.", "정상 및 오류 상황을 재현하는 검증 절차를 추가한다.", "검증을 실행하고 결과와 남은 후속 작업을 기록한다."],
                          "completionCriteria": "검증 절차가 통과하고 결과와 후속 작업이 기록에 남아 있다.",
                          "rationale": "저장된 경험 기록에서 다음 검증 행동을 도출했습니다.",
                          "evidence": [{"recordId": r["id"], "recordVersion": r["version"],
                                        "excerpt": r["contentMarkdown"][:240]}]})
    return {"runId": req.runId, "status": "SUCCEEDED", "proposals": proposals, "warnings": []}
