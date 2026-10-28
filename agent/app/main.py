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
    rationale: str = ""
    evidence: list[Evidence] = Field(default_factory=list)

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
            "Create at most one practical quest proposal for the given epic, grounded only in supplied records. "
            "Return JSON with title, description, rationale, and evidence array containing recordId, recordVersion, excerpt. "
            "If no relevant evidence exists, return {\"proposals\": []}."),
            output_type=ProposalOutput)
        result = await Runner.run(agent, f"Epic: {req.epic}\nRecords:\n{snippets}\nReturn JSON only.")
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
    if req.records:
        r = req.records[0]
        proposals.append({"clientProposalId": "candidate-1", "title": f"Review: {r['title']}",
                          "description": f"Summarize the learning and next action from this record for the epic: {req.epic.get('title', '')}.",
                          "rationale": "Grounded in the user's saved record.",
                          "evidence": [{"recordId": r["id"], "recordVersion": r["version"],
                                        "excerpt": r["contentMarkdown"][:240]}]})
    return {"runId": req.runId, "status": "SUCCEEDED", "proposals": proposals, "warnings": []}
