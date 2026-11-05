import os
from typing import Any
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="RecallNote Agent API", docs_url=None, redoc_url=None)

class GenerateRequest(BaseModel):
    runId: str
    useCase: str = "CAREER"
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

class InterpretRequest(BaseModel):
    sessionId: str
    useCase: str = "CAREER"
    userContext: dict[str, Any] = Field(default_factory=dict)
    records: list[dict[str, Any]] = Field(default_factory=list)
    answers: dict[str, Any] = Field(default_factory=dict)

class CardOption(BaseModel):
    id: str
    label: str
    requiresText: bool = False

class DynamicCard(BaseModel):
    type: str
    id: str
    title: str
    options: list[CardOption] = Field(default_factory=list)
    allowFreeText: bool = False
    required: bool = True
    value: str | None = None
    sourceRefs: list[Evidence] = Field(default_factory=list)

class InterpretOutput(BaseModel):
    sessionId: str
    state: str
    message: str
    cards: list[DynamicCard] = Field(default_factory=list)

@app.get("/health/live")
def live(): return {"status": "UP"}

@app.get("/health/ready")
def ready(): return {"status": "UP", "mode": os.getenv("AGENT_MODE", "mock")}

@app.post("/internal/v1/agent-sessions/interpret")
async def interpret(req: InterpretRequest, x_internal_api_key: str | None = Header(default=None)):
    expected = os.getenv("INTERNAL_API_KEY", "")
    if not expected or x_internal_api_key != expected:
        raise HTTPException(status_code=401, detail="unauthorized")

    use_case = req.useCase.upper()
    record = req.records[0] if req.records else None
    evidence = []
    if record:
        evidence = [Evidence(recordId=str(record["id"]), recordVersion=int(record["version"]), excerpt=str(record.get("contentMarkdown", ""))[:240])]

    if use_case == "LEARNING":
        message = "좋아요. 이 학습 목표를 실행 가능한 단계로 바꿔볼게요. 현재 수준을 알려주세요."
        cards = [DynamicCard(type="CHOICE", id="learning-level", title="현재 주제 수준은 어느 정도인가요?", options=[
            CardOption(id="beginner", label="처음 접해요"),
            CardOption(id="basic", label="기본 개념은 알아요"),
            CardOption(id="project", label="프로젝트에 사용해봤어요"),
            CardOption(id="advanced", label="문제 해결 경험이 있어요"),
            CardOption(id="free_text", label="직접 입력할게요", requiresText=True)], allowFreeText=True)]
    else:
        message = "좋아요. 이 경험을 경력기술서에 사용할 수 있도록 정리해볼게요. 어떤 역할에 가까운지 알려주세요."
        cards = [DynamicCard(type="CHOICE", id="role", title="이 경험에서 가장 가까운 역할은 무엇인가요?", options=[
            CardOption(id="build", label="기능을 개발했어요"),
            CardOption(id="debug", label="문제를 분석하고 수정했어요"),
            CardOption(id="test", label="테스트와 검증을 했어요"),
            CardOption(id="multiple", label="여러 역할을 맡았어요"),
            CardOption(id="free_text", label="직접 입력할게요", requiresText=True)], allowFreeText=True)]
    if evidence:
        cards.append(DynamicCard(type="EVIDENCE", id="source-check", title="이 원본 기록을 근거로 사용해도 될까요?", value=evidence[0].excerpt, sourceRefs=evidence, options=[CardOption(id="confirm", label="이 근거를 사용할게요"), CardOption(id="replace", label="다른 기록을 찾을게요"), CardOption(id="none", label="근거 없음")]))
    return InterpretOutput(sessionId=req.sessionId, state="NEEDS_INPUT", message=message, cards=cards).model_dump()

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
        goal = "a career statement" if req.useCase.upper() == "CAREER" else "a practical learning roadmap"
        agent = Agent(name="RecallNote quest planner", instructions=(
            f"The top-level goal is completing {goal}. Create at most one practical, achievable subquest that advances that goal, grounded only in supplied records. "
            "Write in the language used by the records. The description states the intended outcome. "
            "Use the user's occupation, current goal, experience summary, and interests to tailor wording and learning context when relevant; never treat profile details as evidence of work outcomes. "
            "For CAREER, focus steps on identifying the project context and the user's role, clarifying the problem and actions, and expressing verifiable outcomes as a concise career statement bullet. For LEARNING, focus steps on a measurable learning objective, practice, and a way to verify understanding. "
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
    suffix = "학습 로드맵 만들기" if req.useCase.upper() == "LEARNING" else "경력기술서 항목 만들기"
    candidate = next((r for r in req.records
                      if f"{r['title']} {suffix}".casefold() not in existing_titles), None)
    if candidate:
        r = candidate
        if req.useCase.upper() == "LEARNING":
            title = f"{r['title']} 학습 로드맵 만들기"
            description = f"기록에서 확인한 경험을 바탕으로 다음 학습 목표와 실습 단계를 정리한다. 목표: {req.epic.get('completionCriteria', '')}"
            steps = ["기록에서 더 이해해야 할 개념과 현재 수준을 정리한다.", "핵심 개념을 작은 실습이나 질문으로 확인한다.", "프로젝트 또는 실제 상황에 적용해 이해한 내용을 기록한다."]
            criteria = "학습 목표와 이해 여부를 확인할 수 있는 실습 결과가 원본 기록과 연결되어 있다."
            rationale = "저장된 경험을 다음 학습 단계와 확인 가능한 실습으로 바꿨습니다."
        else:
            title = f"{r['title']} 경력기술서 항목 만들기"
            description = f"원본 경험에서 프로젝트 맥락과 맡은 역할, 해결한 문제와 실행한 행동을 정리하고 확인 가능한 성과를 경력기술서 문장으로 구성한다. 목표: {req.epic.get('completionCriteria', '')}"
            steps = ["기록에서 프로젝트 맥락과 본인의 역할 및 책임을 찾는다.", "해결할 문제와 직접 실행한 행동을 구분해 정리한다.", "원문으로 확인 가능한 결과를 골라 성과 중심의 경력기술서 문장으로 다듬는다."]
            criteria = "역할, 문제, 행동, 검증 가능한 결과가 원본 기록과 연결된 경력기술서 항목으로 정리되어 있다."
            rationale = "저장된 경험 기록을 경력기술서의 근거와 작성 단계로 바꿨습니다."
        proposals.append({"clientProposalId": "candidate-1", "title": title,
                          "description": description, "steps": steps,
                          "completionCriteria": criteria,
                          "rationale": rationale,
                          "evidence": [{"recordId": r["id"], "recordVersion": r["version"],
                                        "excerpt": r["contentMarkdown"][:240]}]})
    return {"runId": req.runId, "status": "SUCCEEDED", "proposals": proposals, "warnings": []}
