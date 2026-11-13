import asyncio
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.main import GenerateRequest, InterpretRequest, generate, interpret


class AgentFlowTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"INTERNAL_API_KEY": "test-key", "AGENT_MODE": "mock"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.record = {"id": "record-1", "version": 1, "title": "권한 오류 수정", "contentMarkdown": "권한 로직을 수정하고 회귀 테스트를 추가했다."}

    def interpret(self, answers=None, use_case="CAREER"):
        return asyncio.run(interpret(InterpretRequest(sessionId="session", useCase=use_case, records=[self.record], answers=answers or {}), "test-key"))

    def test_career_starts_with_role_question(self):
        self.assertEqual([c["id"] for c in self.interpret()["cards"]], ["role"])

    def test_learning_starts_with_level_question(self):
        self.assertEqual([c["id"] for c in self.interpret(use_case="LEARNING")["cards"]], ["learning-level"])

    def test_answer_requires_fact_confirmation_before_evidence(self):
        result = self.interpret({"role": "debug"})
        self.assertEqual(result["cards"][0]["type"], "CONFIRMATION")
        self.assertIn(self.record["contentMarkdown"], result["cards"][0]["value"])

    def test_confirmed_facts_lead_to_source_check(self):
        result = self.interpret({"role": "debug", "facts-check": "confirm"})
        self.assertEqual(result["cards"][0]["id"], "source-check")
        self.assertEqual(result["cards"][0]["sourceRefs"][0]["recordId"], "record-1")

    def test_declined_evidence_and_fact_edits_request_new_record(self):
        for answers in ({"source-check": "none"}, {"source-check": "replace"}, {"facts-check": "edit"}):
            with self.subTest(answers=answers):
                result = self.interpret(answers)
                self.assertEqual(result["cards"][0]["id"], "additional-context")

    def test_both_modes_generate_result_body_with_source(self):
        for use_case in ("CAREER", "LEARNING"):
            with self.subTest(use_case=use_case):
                result = asyncio.run(generate(GenerateRequest(runId="run", useCase=use_case, userContext={}, epic={}, records=[self.record], answers={"role": "직접 오류를 수정함", "learning-level": "처음 접함"}), "test-key"))
                proposal = result["proposals"][0]
                self.assertTrue(proposal["resultMarkdown"].startswith("# "))
                self.assertEqual(proposal["evidence"][0]["recordId"], "record-1")
                self.assertIn("직접 오류를 수정함" if use_case == "CAREER" else "처음 접함", proposal["resultMarkdown"])

    def test_no_records_produces_no_proposals(self):
        result = asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}), "test-key"))
        self.assertEqual(result["proposals"], [])

    def test_openai_resolves_selected_source_and_uses_selected_model(self):
        from agents import Agent
        from app.main import SourceSelectionOutput
        valid = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        proposal = valid["proposals"][0]
        proposal.pop("evidence")
        proposal["evidenceSourceIds"] = ["source-1-1", "unknown-source", "source-1-1"]
        runner = AsyncMock(return_value=types.SimpleNamespace(final_output=SourceSelectionOutput(proposals=[proposal])))
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "gpt-4.1-mini"}), \
             patch("agents.Runner.run", runner), patch("agents.Agent", wraps=Agent) as agent_class:
            result = asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record]), "test-key"))
        self.assertEqual(agent_class.call_args.kwargs["model"], "gpt-4.1-mini")
        self.assertEqual(len(result["proposals"][0]["evidence"]), 1)
        self.assertEqual(result["proposals"][0]["resultMarkdown"], proposal["resultMarkdown"])
        self.assertEqual(result["proposals"][0]["evidence"][0], {
            "recordId": self.record["id"], "recordVersion": self.record["version"],
            "excerpt": self.record["contentMarkdown"],
        })
        self.assertEqual(runner.await_count, 1)

    def test_openai_failure_logs_metadata_without_private_exception_text(self):
        runner = AsyncMock(side_effect=RuntimeError("private prompt and secret key"))
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), \
             patch("agents.Runner.run", runner), self.assertLogs("uvicorn.error", level="ERROR") as logs:
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record]), "test-key"))
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(caught.exception.detail, "OpenAI generation failed")
        self.assertIn("RuntimeError", logs.output[0])
        self.assertNotIn("private prompt", logs.output[0])

    def test_openai_selected_chunk_preserves_original_whitespace_and_record(self):
        import json
        from app.main import SourceSelectionOutput
        original = "가" * 240 + "원문  공백\r\n다음 줄\t끝"
        selected = {"id": "record-2", "version": 7, "title": "두 번째 기록", "contentMarkdown": original}
        valid = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        proposal = valid["proposals"][0]
        proposal.pop("evidence")
        proposal["evidenceSourceIds"] = ["source-2-2"]
        runner = AsyncMock(return_value=types.SimpleNamespace(final_output=SourceSelectionOutput(proposals=[proposal])))
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), patch("agents.Runner.run", runner):
            result = asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record, selected]), "test-key"))
        evidence = result["proposals"][0]["evidence"]
        self.assertEqual(evidence, [{"recordId": "record-2", "recordVersion": 7, "excerpt": original[240:]}])
        prompt = runner.await_args.args[1].split("\nSelect relevant sourceId", 1)[0]
        self.assertEqual(json.loads(prompt)["records"][-1]["excerpt"], evidence[0]["excerpt"])

    def test_openai_can_cite_results_at_end_of_long_record(self):
        import json
        from app.main import SourceSelectionOutput
        original = "Background " * 700 + "RESULT: regression tests passed after fixing authorization."
        record = {**self.record, "contentMarkdown": original}
        valid = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        proposal = valid["proposals"][0]
        proposal.pop("evidence")

        async def select_result(agent, prompt):
            sources = json.loads(prompt.split("\nSelect relevant sourceId", 1)[0])["records"]
            self.assertLessEqual(sum(len(source["excerpt"]) for source in sources), 4800)
            selected = next(source for source in sources if "regression tests passed" in source["excerpt"])
            return types.SimpleNamespace(final_output=SourceSelectionOutput(proposals=[{
                **proposal, "evidenceSourceIds": [selected["sourceId"]],
            }]))

        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), patch("agents.Runner.run", side_effect=select_result):
            result = asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[record]), "test-key"))
        excerpt = result["proposals"][0]["evidence"][0]["excerpt"]
        self.assertIn("regression tests passed", excerpt)
        self.assertIn(excerpt, original)

    def test_openai_never_substitutes_a_record_for_an_unknown_source(self):
        from app.main import SourceSelectionOutput
        valid = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        proposal = valid["proposals"][0]
        proposal.pop("evidence")
        proposal["evidenceSourceIds"] = ["invented-source"]
        runner = AsyncMock(return_value=types.SimpleNamespace(final_output=SourceSelectionOutput(proposals=[proposal])))
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), patch("agents.Runner.run", runner):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record]), "test-key"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(runner.await_count, 2)

    def test_openai_requires_key(self):
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": ""}):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}), "test-key"))
        self.assertEqual(caught.exception.status_code, 503)

    def test_openai_retries_unknown_source_then_returns_grounded_result(self):
        from app.main import SourceSelectionOutput
        valid = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        proposal = valid["proposals"][0]
        proposal.pop("evidence")
        proposal["evidenceSourceIds"] = ["source-1-1"]
        output = SourceSelectionOutput(proposals=[proposal])
        invalid = output.model_copy(deep=True)
        invalid.proposals[0].evidenceSourceIds = ["invented-source"]
        runner = AsyncMock(side_effect=[types.SimpleNamespace(final_output=invalid), types.SimpleNamespace(final_output=output)])
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), patch("agents.Runner.run", runner):
            result = asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record]), "test-key"))
        self.assertEqual(runner.await_count, 2)
        self.assertEqual(result["proposals"][0]["evidence"][0]["excerpt"], self.record["contentMarkdown"])
        self.assertIn("unknown_source_id", runner.await_args_list[1].args[1])
        self.assertIn("invented-source", runner.await_args_list[1].args[1])

    def test_evidence_rejections_distinguish_id_version_and_excerpt(self):
        from app.main import ProposalOutput, _filter_proposals
        result = asyncio.run(generate(GenerateRequest(runId="mock", userContext={}, epic={}, records=[self.record]), "test-key"))
        output = ProposalOutput(proposals=result["proposals"])
        template = output.proposals[0].evidence[0]
        output.proposals[0].evidence = [
            template.model_copy(update={"recordId": "unknown"}),
            template.model_copy(update={"recordVersion": 99}),
            template.model_copy(update={"excerpt": " "}),
            template.model_copy(update={"excerpt": "invented private quote"}),
        ]
        rejected = {}
        self.assertEqual(_filter_proposals(output, [self.record], rejected), [])
        self.assertEqual(rejected, {"unknown_record_id": 1, "record_version_mismatch": 1,
                                    "blank_excerpt": 1, "excerpt_not_in_source": 1})

    def test_openai_persistent_empty_result_returns_422_instead_of_success(self):
        from app.main import SourceSelectionOutput
        runner = AsyncMock(return_value=types.SimpleNamespace(final_output=SourceSelectionOutput()))
        with patch.dict(os.environ, {"AGENT_MODE": "openai", "OPENAI_API_KEY": "test-key"}), patch("agents.Runner.run", runner):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(generate(GenerateRequest(runId="run", userContext={}, epic={}, records=[self.record]), "test-key"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(runner.await_count, 2)

    def test_gemini_mode_returns_schema_validated_and_current_evidence(self):
        response_text = '''{"proposals":[{"title":"Gemini 결과","description":"설명","steps":["기록을 확인한다","결과를 정리한다"],"completionCriteria":"검증 가능","rationale":"근거 기반","resultMarkdown":"# 결과","evidence":[{"recordId":"record-1","recordVersion":1,"excerpt":"권한 로직"},{"recordId":"stale-record","recordVersion":1,"excerpt":"제외"}]}]}'''

        class FakeResponse:
            text = response_text

        class FakeModels:
            def generate_content(self, **kwargs):
                self.kwargs = kwargs
                return FakeResponse()

        class FakeClient:
            def __init__(self, **kwargs):
                self.models = FakeModels()

        fake_genai = types.ModuleType("google.genai")
        fake_genai.Client = FakeClient
        fake_types = types.ModuleType("google.genai.types")
        fake_types.GenerateContentConfig = lambda **kwargs: kwargs
        fake_google = types.ModuleType("google")
        fake_google.genai = fake_genai

        with patch.dict(os.environ, {"AGENT_MODE": "gemini", "GEMINI_API_KEY": "test-gemini-key"}), \
             patch.dict(sys.modules, {"google": fake_google, "google.genai": fake_genai, "google.genai.types": fake_types}):
            result = asyncio.run(generate(GenerateRequest(
                runId="run", userContext={}, epic={}, records=[self.record]
            ), "test-key"))

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(len(result["proposals"]), 1)
        self.assertEqual(result["proposals"][0]["evidence"][0]["recordId"], "record-1")
        self.assertEqual(len(result["proposals"][0]["evidence"]), 1)


if __name__ == "__main__":
    unittest.main()
