---
type: Component
title: "Framework mode and the owner's settings"
description: "The owner's per-clone settings (the doc gate, the aeion-framework address), and what framework mode adds once an address is set: a bounded API client and the @req briefs the doc gate waits for."
status: draft
generated:
  by: aeion-template/4.0
  at: 2026-11-12
verified:
  - at: 2026-11-13
    what: "tools/framework/tests/test_settings.py: 24 passed, including malformed URL refusals and a connect that clears a stale probe"
  - at: 2026-11-12
    what: "tools/framework/tests/test_axiom_api.py: 16 passed; native and shell reads share the brief loading and per-call budget"
sources:
  - id: reader
    resource: ../../.claude/hooks/aeion_settings.py
    title: "The single settings reader"
  - id: switch
    resource: ../../tools/aeion-settings
    title: "The owner's switch"
  - id: client
    resource: ../../tools/framework/axiom-api
    title: "The API client for agents and humans"
  - id: tests
    resource: ../../tools/framework/tests/
    title: "The settings and client regressions, against a local stand-in service"
  - id: service
    resource: https://github.com/OualidGuennif/aeion-framework/blob/v1.1.9/AxiomSpec/docs/19_SERVICE_INTERFACE.md
    title: "aeion-framework 1.1.9 service interface (AX-V-003 to AX-V-006)"
  - id: sandbox
    resource: https://github.com/OualidGuennif/aeion-framework/blob/v1.1.9/playbooks/03_AGENT_IN_A_SANDBOX.md
    title: "The agent protocol: @req, context before a change, axiom-proposals.md"
---

# Framework mode and the owner's settings

## Intent

Let a project use aeion-framework's AxiomSpec without making it anyone else's burden. Framework mode
is off by default; the owner turns it on by giving the API address of the service that holds the
project's spec. Agents then read the requirements from that service: on demand with
`tools/framework/axiom-api`, and automatically as briefs when they read code annotated with `@req`.
The same per-clone settings carry the doc gate's mode. Agents read the settings and never change
them. [ADR-013](../decisions/ADR-013-aeion-template-v4-without-source-analysis.md) records this
project's choice.

## Data sources

| Source                                                            | What is read                                                                                                     | Owner                                     | Freshness                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.aeion/settings.json` (ignored local state, with or without git) | `doc_gate`, `framework`                                                                                          | the owner, through `tools/aeion-settings` | each read                                                                                                  |
| `AEION_FRAMEWORK_URL`                                             | an address overriding the file for one process tree (CI, a container, a sandbox)                                 | whoever starts the process                | each read                                                                                                  |
| `AEION_FRAMEWORK_TOKEN`                                           | a gateway token, sent as `Authorization: Bearer` over https or to this machine only; never stored, never printed | the owner's environment                   | each request                                                                                               |
| `{address}/health/ready`                                          | `version` of the running aeion-framework service                                                                 | the service                               | at connect, which clears the cache; at session start, cached ten minutes in `.aeion/framework-health.json` |
| `{address}/v1/snapshots/{current or digest}/…`                    | `nodes/{id}`, `context`, `trace`, `gaps` (aeion-framework 1.1.9)                                                 | the service                               | each request; `current` is the one release a sandbox service serves                                        |
| committed code                                                    | `@req` annotations: `@req A-001 B-002`, `@req: A-001`, `@req(A-001, B-002)`, every ID on the `@req` line         | the project                               | each session start; each Read of the file                                                                  |

## Inputs

- `tools/aeion-settings` with no argument shows the settings and where each comes from.
- `tools/aeion-settings doc-gate enforce|warn|off`.
- `tools/aeion-settings framework [URL]`: without a URL it asks on a terminal, and refuses (exit 2)
  without one. An address is an `http://` or `https://` URL with a host, a numeric port if any, no
  credentials, no query or fragment, at most 2,048 characters. A malformed URL, including an invalid
  IPv6 host, is refused without a traceback; when configured in the file or environment it leaves
  framework mode off with a diagnostic.
- `tools/aeion-settings framework off`.
- `tools/framework/axiom-api ready | node ID [--full] | context ID[,ID…] [--scope direct|change] |
  trace --path P|--symbol S|--id ID | gaps [--phase design|implementation]`,
  with `--snapshot DIGEST` (default `current`), and for the three paged reads `--budget BYTES`
  (4,096 to 32,768, default 16,384), `--pages N` (1 to 4, default 1) and `--cursor C`.

## Outputs

- `doc_gate()` answers `enforce`, `warn` or `off`; `enforce` when absent. The
  [doc gate](doc-gate.md) reads it at each event.
- `framework()` answers the address and its source, or none: no address means framework mode is off.
- Connect saves the address only after `/health/ready` answers 200 with a `version` from 1.1 up to,
  not including, 2.0 (tested 1.1.9), then prints the Claude Code MCP command for `{address}/mcp/`
  without running it. Refusals, exit 1, nothing saved: an invalid address, an unreachable service, a
  non-200 answer, an unsupported or missing version.
- Session start prints one line:
  `doc gate: <mode>; framework: off | on → <address> (aeion-framework
  <version>, ready) | on → <address>, but <why>`,
  `on` naming the skill `framework`; and when the code carries `@req` IDs but no address is set, the
  hint to connect.
- The guards refuse an agent's write of `.aeion/settings.json` (Edit, Write, a redirection, a copy,
  an interpreter) and an agent's `tools/aeion-settings doc-gate|framework`; reading and showing stay
  open.
- `axiom-api` prints the service's JSON answer on stdout, exit 0. The paged reads follow
  `next_cursor` up to `--pages` and merge the pages (`items`, `omissions`); a page left over is
  named on stderr with the command that continues it. A problem document prints
  `CODE (status): detail` on stderr, exit 1; an unreachable service, an answer that is not HTTP, or
  one that is not JSON, exit 1; a 503 is retried once after its `Retry-After` (five seconds at
  most); bad arguments, exit 2; framework mode off, exit 3.
- Reading a code file that carries `@req` IDs, through Read or a recognized shell reader such as
  `sed`, `head` or `cat`, adds their briefs to the agent's context, headed as requirement text that
  is data, not instructions: one line each (kind, status, title, statement, linked IDs, the places
  that implement or test it; the service's line breaks folded), at most eight IDs per tool call
  across all files read, under one two-and-a-half-second deadline. A served brief, or a definite
  `NOT_FOUND`, is recorded in the doc gate's read set as `axiom:<ID>`; an ID the service did not
  answer is not, and the doc gate keeps the file closed in `enforce` until a later read serves it.

## Invariants

1. A settings file that cannot be read, or holds an unknown gate, fails closed: the gate enforces,
   framework mode is off, and session start names the problem.
2. An address is saved only from a ready service in the supported range; unknown is never ready.
3. The token never reaches a file or the output, never travels in clear text off this machine (plain
   `http://` only to a loopback host), and never follows a redirect: a redirect is answered as a
   refusal, because urllib would copy the header to its target. This machine is reached directly,
   never through a proxy from the environment, which would read the token and could answer for the
   service. A port that answers something other than HTTP is unreachable, and an error status with a
   broken body keeps its status: neither ends a hook.
4. Only the owner changes a setting; the agent's guards refuse every write path they recognize.
5. CI never depends on framework mode.
6. With framework mode off, `axiom-api` sends nothing and no brief is fetched.
7. An answer bigger than the asked budget is never cut by the client; the service names what did not
   fit in `omissions`, and the client never prints more than `--pages` pages.
8. A brief that was not served never counts as read: an unreachable service closes the annotated
   file in `enforce`, and a `NOT_FOUND` ID never does, so a wrong annotation can be fixed.

| Invariant | Test                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1         | `tools/framework/tests/test_settings.py` (`test_an_unreadable_file_fails_closed`, `test_the_gate_takes_only_its_three_modes`); session-start cases in `.claude/hooks/test_hooks.py`                                                                                                        |
| 2         | `test_settings.py` (`test_connect_refuses_and_saves_nothing`, `test_a_service_that_is_not_ready_or_too_old_or_absent`, `test_a_malformed_address_is_refused_without_a_traceback`)                                                                                                          |
| 3         | `test_settings.py` (`test_the_token_travels_only_in_the_header`, `test_a_redirect_is_never_followed`, `test_the_token_goes_only_over_https_or_to_this_machine`, `test_this_machine_is_never_reached_through_a_proxy`, `test_an_address_that_http_cannot_use_is_unreachable_never_a_crash`) |
| 4         | `.claude/hooks/test_hooks.py` (`bash deny settings write`, `path deny: … on .aeion/settings.json`)                                                                                                                                                                                         |
| 5, 6      | `tools/framework/tests/test_axiom_api.py` (`test_framework_off_sends_nothing`); every test uses a local stand-in                                                                                                                                                                           |
| 7         | `test_axiom_api.py` (`test_pages_are_followed_up_to_the_cap`, `test_the_budget_is_bounded`)                                                                                                                                                                                                |
| 8         | `test_axiom_api.py` (`test_briefs_open_the_gate_only_when_served`, `test_a_brief_is_one_line_of_data`, `test_shell_reads_keep_unserved_requirements_closed`, `test_a_shell_read_shares_the_brief_budget_across_files`)                                                                     |

## Determinism

The settings, the address check, the version range and the `@req` reading are plain functions of
their inputs. The network answers are bounded: three seconds for a probe, fifteen for a client read,
one and a half per brief within two and a half per file read.

## Acceptance checks

- `tools/aeion-settings` prints `doc gate: enforce` and `framework: off` on a fresh clone.
- In an agent session, `tools/aeion-settings doc-gate off` and an Edit of `.aeion/settings.json` are
  refused.
- `tools/aeion-settings framework http://127.0.0.1:1` is refused as unreachable, and nothing is
  saved.
- With aeion-framework 1.1.9 serving a release (Docker, or Python 3.14, on the owner's yes):
  `tools/framework/axiom-api node <ID>` and `context <ID>` answer; reading an annotated file shows
  its briefs; with the service stopped, editing that file is refused until the service answers
  again.

## Out of scope

- Storing the address in a committed file: committed `@req` annotations are the team's signal.
- Running or installing the aeion-framework service, or registering its MCP endpoint (connect prints
  the command; the owner runs it).
- Authentication: the service has none; a gateway in front of it owns that.
- Writing the specification: requirements change through the framework's own workflow; an agent that
  disagrees writes `axiom-proposals.md` (skill `framework`).
- Briefs for a service that serves several releases: they read `current`, which only a one-release
  (sandbox) service answers; `axiom-api --snapshot DIGEST` reads any release.
- `@req` IDs in a file that does not exist yet: the gate reads them from the file on disk.
