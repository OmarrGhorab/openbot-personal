import type { AgentSummary, InstalledSkill } from "@openbot/contracts/ipc";
import { ravenPstackSkill } from "@openbot/contracts/ipc";
import { Effect } from "effect";

/**
 * Whether the skill of a pstack playbook (#197) is installed for an agent on this computer. The pack
 * `pstack` installs each pstack skill as its own folder, `pstack-<name>`, so `tdd` is `pstack-tdd`. A skill
 * that is turned off or has a problem does not count. The Raven Builder agents are read first; a skill
 * that only another agent has still counts, and a Builder that cannot find it reports BLOCKED.
 */
export function pstackPlaybookInstalled(
  agents: readonly Pick<AgentSummary, "id" | "name">[],
  listSkills: (agentId: string) => Effect.Effect<InstalledSkill[], unknown>,
  playbook: string,
): Effect.Effect<boolean> {
  const wanted = ravenPstackSkill(playbook);
  const ordered = [...agents].sort(
    (left, right) => Number(/^Raven Builder\b/u.test(right.name)) - Number(/^Raven Builder\b/u.test(left.name)),
  );
  return Effect.gen(function* () {
    for (const agent of ordered) {
      const skills = yield* listSkills(agent.id).pipe(Effect.orElseSucceed((): InstalledSkill[] => []));
      if (skills.some((skill) => skill.slug === wanted && skill.enabled !== false && !skill.problem)) return true;
    }
    return false;
  });
}
