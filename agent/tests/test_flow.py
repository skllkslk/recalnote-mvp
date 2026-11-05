import asyncio
import os
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
