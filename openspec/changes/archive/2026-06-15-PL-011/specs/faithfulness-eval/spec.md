## ADDED Requirements

### Requirement: Run produces a per-paper blind-grade bundle

The system SHALL provide a `run` command that, given a set of arXiv ids (a comma
list or a file with one id per line) and an output directory, runs the pipeline
(`orchestrator.runOnce`) for each id and writes, per paper, a bundle that places
the SOURCE (the paper's abstract and a full-text excerpt) ahead of the candidate
output (the structured DIGEST and the styled POST body), so a human can grade
each post for faithfulness against its source.

#### Scenario: Running N papers produces a bundle per paper

- **WHEN** `run` is invoked over a set of N arXiv ids with an output directory
- **THEN** the system runs the pipeline for each id and writes one bundle per
  successfully-run paper, each bundle containing that paper's source, its digest,
  and its styled post body

#### Scenario: A paper whose pipeline fails is skipped, not fatal

- **WHEN** the pipeline call for one id throws while others succeed
- **THEN** the failed id is recorded and excluded, and bundles are still produced
  for the remaining papers

### Requirement: Run emits a blank human grades template

The system SHALL, alongside the bundles, write a single blank grades template
with one row per successfully-run paper, each row carrying the paper's arXiv id
and empty cells for a human to fill: the total number of claims and the number of
those claims that are hallucinated or unsupported.

#### Scenario: The template has one fillable row per paper

- **WHEN** `run` completes over a set of arXiv ids
- **THEN** a grades template is written with a header and exactly one blank row
  per paper that produced a bundle, ready for a human to fill in the claim counts

### Requirement: Grading is human and blind, never auto-graded

The system SHALL NOT assign faithfulness grades itself. The `run` command SHALL
only prepare the bundle and the blank template; the claim counts SHALL be
supplied by a human grader. No stage of the harness SHALL call an LLM to judge
whether a claim is supported.

#### Scenario: The harness assigns no grades

- **WHEN** `run` completes
- **THEN** every grade cell in the template is empty, awaiting human input, and
  no claim has been auto-classified as supported or hallucinated

### Requirement: Score computes the aggregate hallucination rate from human grades

The system SHALL provide a `score` command that reads a human-filled grades file
and computes the aggregate hallucination rate as the claim-weighted ratio
`sum(claims_hallucinated) / sum(claims_total)` across the sample, and SHALL
report the per-paper rate and the aggregate rate.

#### Scenario: The aggregate rate is claim-weighted

- **WHEN** `score` reads grades where one paper has 2 of 2 claims unsupported and
  another has 0 of 18 unsupported
- **THEN** the reported aggregate rate is 2 / 20 = 10%, not the unweighted mean of
  the two per-paper rates

#### Scenario: A sample with zero total claims does not divide by zero

- **WHEN** `score` reads grades whose total claim count across all papers is zero
- **THEN** the aggregate rate is reported as 0 and the verdict is PASS, with no
  division-by-zero error

### Requirement: Score reports a PASS/FAIL verdict against the Layer-0 gate

The system SHALL compare the aggregate hallucination rate against the Layer-0
go/no-go gate of 10% and report PASS when the rate is less than or equal to 10%
and FAIL when it exceeds 10%.

#### Scenario: At the gate PASSes and just over it FAILs

- **WHEN** the aggregate rate is exactly 10%
- **THEN** the verdict is PASS
- **WHEN** the aggregate rate is above 10%
- **THEN** the verdict is FAIL

### Requirement: The harness is dependency-injected and offline-testable

The system SHALL allow the pipeline runner used by `run` to be injected so the
harness can run entirely offline — against a fake runner returning canned source,
digest, and post — with no network, no real database, and no LLM, and SHALL
default the runner to the real `orchestrator.runOnce` when none is supplied. The
rate-computation and bundle-building logic SHALL be importable as pure functions
for unit testing.

#### Scenario: Run executes offline with an injected fake runner

- **WHEN** `run` is invoked with an injected fake runner returning canned bundles
- **THEN** the bundles and the blank grades template are produced without any
  network access, real database, or LLM call, and the fake runner is invoked once
  per arXiv id
