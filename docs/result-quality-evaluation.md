# Result quality evaluation

The synthetic fixtures in `agent/evals/career_cases.json` cover mixed projects, outcomes without
numeric metrics, insufficient personal evidence, confirmed role corrections, and multiple passages
from one record. They contain no imported personal records.

## Offline checks

From `agent/`, run `python -m unittest discover -s tests -v`.
This verifies scope, excerpt integrity, supplement handling and the evaluation checks themselves.
It does **not** demonstrate the current OpenAI model's writing quality.

To assess saved model responses, provide a JSON object keyed by the five fixture IDs, with each
value being the complete generation response (`proposals`, including `evidence`):

```powershell
python -m evals.evaluate --responses path/to/responses.json --output artifacts/quality-report.json
```

## Opt-in live evaluation

Set `AGENT_MODE=openai`, `OPENAI_API_KEY`, and `INTERNAL_API_KEY` in the process environment using
your existing secret-management mechanism, then run from `agent/`:

```powershell
python -m evals.evaluate --live --output artifacts/quality-report.json
```

This makes five generation requests; the existing correction retry can cause a second provider
call for a request. The report contains the synthetic results, individual checks and PASS/REVIEW
statuses. Exit status is nonzero if any case needs review. No keys are written into the report.
The runner bypasses the browser and database; database evidence persistence is tested separately.

## Human review

Automated checks are lexical and structural signals, not a semantic grounding guarantee. A valid
excerpt can coexist with an unsupported sentence, and a forbidden phrase can appear in a denial.
Review every result against its selected originals and confirmed supplement, assessing:

1. Does each personal achievement follow from those sources, rather than profile or team ownership?
2. Are unrelated projects and technologies excluded?
3. Are actions and verification concrete, without invented metrics or vague template projects?
4. Do corrections narrow personal ownership and preserve the original context?
5. Are all necessary passages visible in evidence and absent as internal IDs in Markdown?

The insufficient-evidence fixture allows an empty proposal. A nonempty result must identify missing
facts instead of claiming personal delivery. Record the model, date, failed checks, human findings
and the chosen follow-up before treating a new prompt/model as a quality improvement.
