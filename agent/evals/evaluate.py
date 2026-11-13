"""Evaluate saved or opt-in live results; lexical checks are review signals, not semantic proof."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import sys

from app.main import GenerateRequest, generate, project_groups

CASES = Path(__file__).with_name("career_cases.json")


def load_cases():
    return json.loads(CASES.read_text(encoding="utf-8"))


def selected_records(case):
    requested = set(case["targetRecordIds"])
    options = [{str(record["id"]) for record in group["records"]} for group in project_groups(case["records"])]
    if requested not in options:
        raise ValueError(f"Invalid target group in fixture {case['id']}")
    return [record for record in case["records"] if str(record["id"]) in requested] + case.get("supplementRecords", [])


def evaluate_result(case, result):
    records = {str(record["id"]): record for record in selected_records(case)}
    if not isinstance(result, dict) or "proposals" not in result or not isinstance(result["proposals"], list):
        return {"caseId": case["id"], "passed": False, "checks": {"generation_response_present": False}}
    proposals = result.get("proposals", [])
    if not proposals:
        return {"caseId": case["id"], "passed": bool(case.get("allowEmpty")), "checks": {"usable_result_or_explicit_abstention": bool(case.get("allowEmpty"))}}
    body = "\n".join(proposal.get("resultMarkdown", "") for proposal in proposals)
    evidence = [item for proposal in proposals for item in proposal.get("evidence", [])]
    cited = {item.get("recordId") for item in evidence}
    checks = {
        "one_nonempty_result": len(proposals) == 1 and bool(body.strip()),
        "no_internal_source_ids": re.search(r"source-\d+-\d+", body) is None,
        "only_selected_current_verbatim_evidence": bool(evidence) and all(
            item.get("recordId") in records
            and item.get("recordVersion") == records[item["recordId"]]["version"]
            and bool(item.get("excerpt", "").strip())
            and item["excerpt"] in records[item["recordId"]]["contentMarkdown"] for item in evidence),
        "required_records_cited": set(case.get("requiredEvidenceRecordIds", [])).issubset(cited),
        "concrete_concepts_present": all(any(term.casefold() in body.casefold() for term in alternatives) for alternatives in case.get("requiredConcepts", [])),
        "no_fixture_specific_inventions": not any(term.casefold() in body.casefold() for term in case.get("forbiddenPhrases", [])),
        "enough_distinct_passages": len({(item.get("recordId"), item.get("excerpt")) for item in evidence}) >= case.get("minimumEvidencePassages", 1),
    }
    return {"caseId": case["id"], "passed": all(checks.values()), "checks": checks}


async def run_live(cases):
    # No credentials are loaded from files or printed. This path incurs provider charges.
    if os.getenv("AGENT_MODE") != "openai" or not os.getenv("OPENAI_API_KEY") or not os.getenv("INTERNAL_API_KEY"):
        raise ValueError("Live evaluation requires AGENT_MODE=openai, OPENAI_API_KEY and INTERNAL_API_KEY")
    results = {}
    for case in cases:
        results[case["id"]] = await generate(GenerateRequest(
            runId="eval-" + case["id"], userContext=case["userContext"],
            epic={"title": "Evidence-based career statement"}, records=selected_records(case),
            answers={"role": case["role"], "facts-check": "confirm", "source-check": "confirm"},
        ), os.environ["INTERNAL_API_KEY"])
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--responses", type=Path, help="Saved JSON map from case IDs to generation responses; no network calls")
    mode.add_argument("--live", action="store_true", help="Explicitly call OpenAI for the synthetic fixtures")
    parser.add_argument("--output", type=Path, required=True, help="Write the full responses and checks for human review")
    args = parser.parse_args()
    cases = load_cases()
    responses = asyncio.run(run_live(cases)) if args.live else json.loads(args.responses.read_text(encoding="utf-8"))
    reports = [evaluate_result(case, responses.get(case["id"], {})) for case in cases]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"reports": reports, "responses": responses}, ensure_ascii=False, indent=2), encoding="utf-8")
    for report in reports:
        failures = ", ".join(name for name, passed in report["checks"].items() if not passed)
        print(f"{report['caseId']}: {'PASS' if report['passed'] else 'REVIEW'} {failures}")
    return 0 if all(report["passed"] for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
