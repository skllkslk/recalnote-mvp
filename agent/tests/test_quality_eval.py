import unittest

from evals.evaluate import evaluate_result, load_cases, selected_records


class QualityEvaluationTest(unittest.TestCase):
    def test_every_fixture_selects_one_valid_project_and_uses_synthetic_records(self):
        cases = load_cases()
        self.assertEqual(len(cases), 5)
        self.assertEqual(len({case["id"] for case in cases}), 5)
        for case in cases:
            self.assertTrue(selected_records(case))

    def test_unrelated_project_claims_and_evidence_are_flagged(self):
        case = load_cases()[0]
        unrelated = case["records"][-1]
        result = {"proposals": [{"resultMarkdown": "I integrated a Vue shopping cart.", "evidence": [{"recordId": unrelated["id"], "recordVersion": 1, "excerpt": unrelated["contentMarkdown"]}]}]}
        report = evaluate_result(case, result)
        self.assertFalse(report["passed"])
        self.assertFalse(report["checks"]["only_selected_current_verbatim_evidence"])
        self.assertFalse(report["checks"]["no_fixture_specific_inventions"])

    def test_supported_non_numeric_achievement_passes(self):
        case = load_cases()[1]
        record = selected_records(case)[0]
        result = {"proposals": [{"resultMarkdown": "Fixed the permission check and added a regression test verifying 403 for an unauthorized user.", "evidence": [{"recordId": record["id"], "recordVersion": record["version"], "excerpt": record["contentMarkdown"]}]}]}
        self.assertTrue(evaluate_result(case, result)["passed"])
        result["proposals"][0]["resultMarkdown"] += " Improved latency by 50%."
        self.assertFalse(evaluate_result(case, result)["passed"])

    def test_only_insufficient_evidence_case_allows_abstention(self):
        for case in load_cases():
            self.assertEqual(evaluate_result(case, {"proposals": []})["passed"], case["id"] == "insufficient-personal-evidence")
            self.assertFalse(evaluate_result(case, {})["passed"])

    def test_duplicate_passages_do_not_satisfy_multiple_passage_requirement(self):
        case = load_cases()[-1]
        record = selected_records(case)[0]
        evidence = {"recordId": record["id"], "recordVersion": record["version"], "excerpt": record["contentMarkdown"][:240]}
        result = {"proposals": [{"resultMarkdown": "Checked invoice ownership and added regression tests for 403.", "evidence": [evidence, evidence]}]}
        self.assertFalse(evaluate_result(case, result)["checks"]["enough_distinct_passages"])


if __name__ == "__main__":
    unittest.main()
