# Theme-Session-Team-IMA Design Delta

> Status: proposal addendum. `docs/plan/codex` remains the canonical proposal; this document refines its template, scheduling, team-binding, and IMA boundaries without creating a second PBL state machine.

## 1. Decision

Adopt the user's **Theme Core + Session Schedule + Deep Team Binding + IMA Knowledge Integration** model as the next contract evolution. Do not replace the existing `projects`, `learning-plan`, `mastery`, `ai-tutor`, or `team-runtime` owners. Instead:

- Keep `ProjectTemplateSpec` as the governed template-version envelope.
- Make the theme and session schedule first-class fields of that envelope.
- Extend `PblTemplateTeamBinding` with a versioned role map and an IMA grant.
- Freeze the complete binding (including the IMA grant hash) in `project_binding_snapshots` before creating a formal project.
- Resolve the active session and role server-side; the browser may only render the projection.

The 16-session optics course is represented as 8 weeks x 2 sessions (60 minutes each) under the existing schedule contract. It does not create 16 new mastery objectives: the current 12 core optics objectives remain the mastery spine, while diffraction/scattering stay qualitative wave inquiry modules until a separately reviewed template version promotes them.

The draft `OPTICS_16_SESSION_SPEC` currently diverges from the server's `OPTICS_SESSION_MODULES`: the server bootstrap still publishes an 8-session/4-week schedule, while the draft publishes 16 sessions and repeats some objectives (for example `opt-theory-reflection` and practice/report objectives). This must be resolved by a versioned template migration, not by silently changing the meaning of the existing `optics-physical-inquiry:v1` bootstrap key.

## 2. Contract mapping to the current repository

The working tree now contains an untracked `packages/contracts/src/curriculum.ts` and `packages/contracts/src/index.ts` exports it. This is a useful draft of the user's v2 shape, but it is not yet part of the tracked baseline or wired to the API/template owners. The repository also has two related tracked contracts:

| New idea | Current owner/contract | Required change |
| --- | --- | --- |
| Theme Core | `ProjectTemplateSpec` in `packages/contracts/src/pbl-learning.ts` | Add a stable `theme` projection (`slug`, title, domain, driving question, age range, rubric) or define a new `ProjectTemplateThemeSpec` and embed it in `ProjectTemplateSpec`. |
| Session Schedule | `PblTemplateSchedule`, `PblLessonPlan`, `PblLessonBlock` | Add `totalSessions`, explicit `sessionIndex`, `sessionType`, gate, and optional `interactiveSpec`; derive totals from `durationWeeks * sessionsPerWeek`. |
| Curriculum generator | `packages/ai-client/src/curriculum.ts` | Keep generator logic here, but consume stable DTOs from `@qitu/contracts`; do not duplicate the contract in a new package-local shape. |
| Deep Team Binding | `PblTemplateTeamBinding` / `ProjectBindingSnapshot` | Add a versioned `roleMap` and `mcpGrant` to the binding and snapshot hash. |
| IMA grant | `TutorAgentMcpDescriptor` plus `ImaMcpClient` | Add server-owned knowledge-base scope and tool allow-list. A tool ID alone is not enough to authorize a knowledge base. |
| Dynamic interaction | `TutorReplyBlock` and `OpticsExperimentSpec` proposal | Bind every interactive block to `sessionIndex`, `objectiveId`, `specVersion`, and a server-issued action/event scope. |

If the draft `packages/contracts/src/curriculum.ts` is retained, it must be added to the tracked change set together with tests and API migration. Its `RefactoredProjectTemplateSpec` must either become the sole v2 template contract or be an explicit projection of `ProjectTemplateSpec`; the existing `pbl-learning.ts`/`ai-client` types cannot remain an independently validated second schema.

Validation rules for the new schedule are mandatory: session indexes are contiguous and unique; `totalSessions` equals `durationWeeks * sessionsPerWeek`; block minutes sum to `durationMinutes`; every objective ID exists in the frozen template; prerequisite edges point backward or to an earlier session; phase gates use the existing `GateConditionId` registry; and an `interactiveSpec` can only reference a server allow-listed tool/spec version.

## 3. Canonical data model

```ts
interface ProjectTemplateThemeSpec {
  slug: string;
  title: string;
  domain: string;
  drivingQuestion: string;
  targetAgeRange: { min: number; max: number };
  prerequisites: string[];
  safetyRequirements: string[];
  finalDeliverableType: string;
  rubricId: string;
}

interface TemplateSessionSpec {
  sessionIndex: number;
  title: string;
  phase: 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';
  sessionType: 'theory' | 'practice' | 'review';
  objectiveIds: string[];
  durationMinutes: 60 | 120;
  blocks: { review: number; theory: number; check: number; practice: number; reflect: number };
  gateCondition?: string;
  interactiveSpec?: {
    enabled: boolean;
    domainTopic: string;
    allowHypothesisPrediction: boolean;
    specVersion: string;
  };
}

interface DeepTeamBindingProjection {
  bindingId: string;
  templateVersionId: string;
  teamVersionId: string;
  roleMap: Record<string, { assistantId: string; phase: string; sessionIndexes: number[] }>;
  imaGrant: {
    serverId: 'ima-knowledge';
    knowledgeBaseIds: string[];
    allowedTools: ('ima_list_knowledge_bases' | 'ima_search_knowledge' | 'ima_list_documents' | 'ima_read_document')[];
  } | null;
  bindingHash: string;
}
```

The persisted binding must include the grant and role map in the hash. The project snapshot must include `templateVersionId`, `bindingId`, `teamVersionId`, `bindingHash`, and the immutable IMA grant projection. A missing active binding is a conflict, not a warning-only omission.

`TeamMemberAgent` must reference server-owned assistant/skill/prompt versions rather than accepting arbitrary prompt text, provider URLs, credentials, or client-selected model IDs. Model routing remains an `Agent Runtime` decision; the binding may constrain a usage purpose or approved model class, but it must not become a second credential/configuration store.

## 4. Session and role resolution

The server resolves a turn in this order:

```text
project_binding_snapshot
  -> template_version.theme + sessions[sessionIndex]
  -> current project/session state and gate evidence
  -> roleMap[phase/session]
  -> assistant runtime + IMA grant
  -> bounded TutorReplyBlock / next action
```

The client must not select a team, assistant, knowledge base, session, gate, or MCP tool by label. `sessionIndex` is a server-owned projection and is checked against the frozen template version. The existing phase-level `assignedAssistantId` remains a fallback only for legacy templates; new optics versions must provide a session role map.

## 5. IMA integration boundary

`ImaMcpClient` already provides useful transport and security properties: HTTPS/local-only endpoint validation, token length checks, bounded response size, read-tool allow-listing, and authorization before discovery and every call. The missing boundary is **knowledge-base scope**. The `/opt/qitu-ima` path is an implementation deployment detail; use the server-owned `QITU_IMA_MCP_URL` configuration and never expose a filesystem path to the browser.

Required changes before production:

1. Resolve `imaGrant` from the frozen binding, not from browser input or a free-form assistant prompt.
2. Filter the descriptor to the grant's `allowedTools` and `knowledgeBaseIds`.
3. Validate tool arguments server-side. For search/read calls, inject or verify the allowed knowledge-base IDs; reject a call that targets another base.
4. Record `knowledgeBaseId`, document/citation ID, document version, section/page when available, and an excerpt hash as bounded evidence. Do not persist full textbook passages in teacher/parent projections.
5. If IMA is unavailable, mark the turn as `knowledge_unverified` and fall back to the approved local content; never silently present an uncited model answer as textbook-backed.
6. Keep the read-only tool list. No write, filesystem, arbitrary URL, or code-execution MCP tool may enter a student binding.

The current `ImaSettingsService.canCall` authorizes assistant/agent/tool access but does not constrain knowledge-base arguments. The current `ImaMcpClient` also forwards model-supplied `tools/call` arguments. The binding-level grant and an argument validator are therefore mandatory.

## 6. Optics 16-session projection

Use the 16-session schedule as a delivery plan, not as a new state machine:

| Sessions | Phase | Owner role | IMA use | Optics evidence |
| --- | --- | --- | --- | --- |
| 1-2 | exploration | Lead Tutor | optional context lookup | observation, driving question |
| 3-8 | concept_mastery | Concept Coach | optics textbook search/read | misconception checks, theory attempts, `TheoryMastered` owner decision |
| 9-14 | guided_practice | Lab Guide | bounded formula/context lookup | prediction, controls, measurements, graphs, CER draft |
| 15-16 | deliverable_review | Review Assessor | citation verification only | report, rubric evidence, defense/reflection |

Diffraction/scattering blocks must use the previously specified `Observe -> Predict -> Manipulate -> Measure -> Explain -> Challenge -> Submit` loop. Each submission references the session, objective, experiment spec version, action ID, observation IDs, and IMA citation IDs where used. An IMA citation supports explanation; it does not itself prove student mastery.

## 7. Delivery increments

1. **Contract increment:** add and export the theme/session/interactive/grant DTOs; add schema validators and migration fixtures. Keep `ProjectTemplateSpec` backward-compatible through an explicit `specVersion`.
2. **Binding increment:** extend admin binding create/validate/activate and snapshot freeze to validate role-map coverage, IMA server/tool/base allow-lists, and grant hash stability.
3. **Session increment:** generate 4/8/16-session schedules from the same deterministic generator; persist `PlanOutline`/session teaching plans through a PostgreSQL store; derive the active session from server state.
4. **IMA increment:** pass the frozen grant into Tutor runtime, validate search/read arguments, persist bounded citation evidence, and add unavailable/permission-denied replay tests.
5. **Optics increment:** replace title matching with template-version allow-listing; add the server-owned experiment spec/action endpoint and adaptive misconception policy.
6. **Pilot increment:** run an isolated 16-session optics pilot with teacher review. Measure evidence completeness, misconception resolution, hint escalation, citation validity, latency, and safety incidents; do not claim learning-effect gains without a controlled study.

## 8. Acceptance gates

- A project cannot be created without an active template-team binding snapshot (or an explicitly governed free-project path).
- A Tutor turn cannot call IMA unless the frozen grant, assistant role, session, and actor scope all match.
- A student cannot select a knowledge base or MCP tool outside the grant.
- A citation-backed response exposes only bounded source metadata and is auditable.
- A session cannot advance `TheoryMastered`, artifact approval, or plan revision from an IMA citation or client summary alone.
- Contract, migration, role-routing, IMA argument-scope, replay/idempotency, permission, offline, and live 16-session pilot tests pass before enabling the feature flag.
