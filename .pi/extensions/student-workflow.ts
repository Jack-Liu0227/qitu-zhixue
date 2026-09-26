/**
 * Registers the student-side workflow slash commands.
 *
 * Same mechanism pi-herdr-agents uses for /plan: the command injects the
 * workflow skill text into the parent session as a user message, and the parent
 * session runs the orchestration through `subagent()` calls. The extension does
 * not spawn anything itself.
 *
 *   /student-module <today|inspiration|tutor-ui|projects|works> [extra brief]
 *   /tutor-engine   <pedagogy|context|api|escalation|curriculum|all> [extra brief]
 *   /learning-plan  <interest> [extra brief]   (preset: tutor-engine, slice=curriculum)
 *
 * Auto-discovered from .pi/extensions/ once the project is trusted.
 * Reload with /reload inside Pi after editing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface WorkflowSpec {
  /** First name is the documented command; the rest are aliases. */
  readonly names: readonly [string, ...string[]];
  readonly description: string;
  /** Absolute path to the workflow skill. */
  readonly skillPath: string;
  /** Sent when the user supplies no argument. */
  readonly noArgOpening: string;
  /** Fixes the workflow slice up front, skipping the Phase 0 slice question. */
  readonly presetSlice?: string;
}

const WORKFLOWS: readonly WorkflowSpec[] = [
  {
    names: ["student-module", "student-feature", "sm"],
    description:
      "Develop one student-center module end-to-end: <today|inspiration|tutor-ui|projects|works>",
    skillPath: fileURLToPath(
      new URL("../skills/student-module/SKILL.md", import.meta.url),
    ),
    noArgOpening:
      "The user did not name a module. Ask which student-center module to build " +
      "(today / inspiration / tutor-ui / projects / works) and confirm scope in " +
      "this session, then continue the workflow from Phase 0.",
  },
  {
    names: ["tutor-engine", "tutor", "te"],
    description:
      "Build the heuristic AI tutor engine: <pedagogy|context|api|escalation|curriculum|all>",
    skillPath: fileURLToPath(
      new URL("../skills/tutor-engine/SKILL.md", import.meta.url),
    ),
    noArgOpening:
      "The user did not name a slice. Ask which tutor-engine slice to build " +
      "(pedagogy / context / api / escalation / curriculum / all) and confirm " +
      "scope in this session, then continue the workflow from Phase 0.",
  },
  {
    names: ["learning-plan", "lp"],
    description:
      "Build the interest-to-plan capability: interest -> 4/8 week, 1-hour-session, theory-before-practice plan",
    skillPath: fileURLToPath(
      new URL("../skills/tutor-engine/SKILL.md", import.meta.url),
    ),
    noArgOpening:
      "The user did not state an interest. Ask what the child wants to build " +
      "(for example a simple Python game) and whether the plan should run 4 or " +
      "8 weeks, then continue.",
    presetSlice: "curriculum",
  },
];

/** Strip the YAML frontmatter: the parent only needs the procedure body. */
function loadSkillBody(path: string): string {
  const raw = readFileSync(path, "utf8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "").trim();
}

export default function studentWorkflowExtension(pi: ExtensionAPI) {
  for (const workflow of WORKFLOWS) {
    const primary = workflow.names[0];

    const handler = async (
      args: string,
      ctx: { ui: { notify(message: string, kind?: string): void } },
    ) => {
      let body: string;
      try {
        body = loadSkillBody(workflow.skillPath);
      } catch (error) {
        ctx.ui.notify(
          `Could not read the workflow skill at ${workflow.skillPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        );
        return;
      }

      const task = args.trim();
      const opening = task ? task : workflow.noArgOpening;
      const slice = workflow.presetSlice
        ? `\n\nScope is already fixed: run this workflow with slice \`${workflow.presetSlice}\`. ` +
          "Do not ask which slice to build. Still run Phase 0 to write brief.json and " +
          "still stop at confirm gate A before Phase 3."
        : "";

      pi.sendUserMessage(
        `<skill name="${primary}" location="${workflow.skillPath}">\n${body}\n</skill>\n\n${opening}${slice}`,
      );
    };

    for (const name of workflow.names) {
      pi.registerCommand(name, {
        description:
          name === primary
            ? workflow.description
            : `${workflow.description} (alias of /${primary})`,
        handler,
      });
    }
  }
}
