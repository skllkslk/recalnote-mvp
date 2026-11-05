"""Run only against compose.flow-test.yaml (isolated database, fixed port 18081)."""
import json
import unittest
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class MvpFlowTest(unittest.TestCase):
    def setUp(self):
        self.user = "flow-test-" + uuid.uuid4().hex

    def api(self, path, body=None, method=None, status=200):
        request = Request("http://127.0.0.1:18081/api/v1" + path,
                          data=json.dumps(body).encode() if body is not None else None,
                          method=method or ("POST" if body is not None else "GET"),
                          headers={"Content-Type": "application/json", "X-Authenticated-User": self.user})
        try:
            response = urlopen(request, timeout=100)
        except HTTPError as error:
            response = error
        with response:
            data = response.read()
            self.assertEqual(response.status, status, data.decode())
            return json.loads(data) if data else None

    def turn(self, session, card, value):
        return self.api(f"/agent-sessions/{session['sessionId']}/turns", {"cardId": card, "value": value})

    def ready(self, use_case="CAREER", title=None):
        session = self.api("/agent-sessions", {"useCase": use_case, "title": title or uuid.uuid4().hex, "contentMarkdown": "권한 오류를 수정하고 회귀 테스트를 추가했다."})
        session = self.turn(session, "learning-level" if use_case == "LEARNING" else "role", "프로젝트 경험 있음")
        session = self.turn(session, "facts-check", "confirm")
        return self.turn(session, "source-check", "confirm")

    def test_both_epics_generate_reviewable_persisted_results(self):
        for use_case in ("CAREER", "LEARNING"):
            with self.subTest(use_case=use_case):
                profile = self.api("/users/me/profile", {"useCase": use_case, "displayName": "테스트 모험가"}, method="PUT")
                self.assertTrue(profile["onboardingCompleted"])
                self.assertEqual(self.api("/epics/active")["useCase"], use_case)
                session = self.ready(use_case)
                self.assertEqual(session["state"], "PROPOSAL_PENDING")
                self.assertTrue(session["cards"][0]["value"]["resultMarkdown"])
                latest = self.api("/agent-sessions/latest")
                self.assertEqual(latest["sessionId"], session["sessionId"])
                result = "# 직접 편집한 " + use_case + " 결과물"
                approved = self.api(f"/agent-sessions/{session['sessionId']}/approve", {"editedResultMarkdown": result})
                quest = next(q for q in self.api("/quests") if q["id"] == approved["result"]["questId"])
                self.assertEqual(quest["resultMarkdown"], result)
                self.assertTrue(quest["recordIds"])
                self.assertEqual(self.api(f"/agent-sessions/{session['sessionId']}")["state"], "APPROVED")
                self.api(f"/agent-sessions/{session['sessionId']}/approve", {}, status=409)
                self.api(f"/agent-sessions/{session['sessionId']}/turns", {"cardId": "role", "value": "debug"}, status=409)

    def test_declined_evidence_requires_new_record_and_new_confirmation(self):
        session = self.api("/agent-sessions", {"contentMarkdown": "처음 입력한 내용"})
        session = self.turn(session, "role", "debug")
        session = self.turn(session, "facts-check", "confirm")
        session = self.turn(session, "source-check", "none")
        self.assertEqual(session["cards"][0]["id"], "additional-context")
        self.assertEqual(self.api("/quest-proposals"), [])
        self.assertEqual(self.api("/quests"), [])
        session = self.turn(session, "additional-context", "직접 오류를 분석하고 테스트를 추가했다.")
        self.assertEqual(session["cards"][0]["type"], "CONFIRMATION")
        session = self.turn(session, "facts-check", "confirm")
        session = self.turn(session, "source-check", "confirm")
        proposal = session["cards"][0]["value"]
        self.assertEqual(proposal["evidence"][0]["excerpt"], "직접 오류를 분석하고 테스트를 추가했다.")
        self.assertEqual(self.api("/quests"), [])
        self.api(f"/agent-sessions/{session['sessionId']}/reject", {})
        self.assertEqual(self.api(f"/agent-sessions/{session['sessionId']}")["state"], "REJECTED")

    def test_record_changes_block_approval_and_other_users_cannot_read_session(self):
        session = self.ready()
        evidence = session["cards"][0]["value"]["evidence"][0]
        self.api(f"/records/{evidence['recordId']}", {"title": "수정됨", "contentMarkdown": "원본 내용 변경"}, method="PUT")
        self.api(f"/agent-sessions/{session['sessionId']}/approve", {}, status=409)
        self.assertEqual(self.api("/quests"), [])
        self.user = "other-user-" + uuid.uuid4().hex
        self.api(f"/agent-sessions/{session['sessionId']}", status=404)


if __name__ == "__main__":
    unittest.main()
