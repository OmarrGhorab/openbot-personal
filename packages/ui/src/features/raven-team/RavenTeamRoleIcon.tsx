import type { AvatarHue } from "@openbot/contracts/ipc";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { SupportedAvatarSilhouetteId } from "../../bloub-avatar";

/**
 * The agent shape of each built-in role, as the design draws it: the Architect is a cloud, the Builder
 * a squircle, the Reviewer a triangle, Quality a circle and the Editor a capsule. A role of a copied
 * template gets a hexagon. The shape names the role, so it is the same on every job.
 */
const ROLE_SHAPES: Readonly<Record<string, { shape: SupportedAvatarSilhouetteId; hue: AvatarHue }>> = {
  architect: { shape: "nuage", hue: 245 },
  builder: { shape: "squircle", hue: 215 },
  reviewer: { shape: "triangle", hue: 55 },
  quality: { shape: "cercle", hue: 150 },
  editor: { shape: "capsule", hue: 30 },
};

const OTHER_ROLE = { shape: "hexagone", hue: 185 } as const;

export function RavenTeamRoleIcon(props: { roleId: string; class?: string }) {
  const look = () => (Object.hasOwn(ROLE_SHAPES, props.roleId) ? ROLE_SHAPES[props.roleId] : undefined) ?? OTHER_ROLE;
  return (
    <AgentAvatar
      seed={`raven-team-role-${props.roleId}`}
      shape={look().shape}
      hue={look().hue}
      url={null}
      motion="idle"
      class={`raven-team-role-icon ${props.class ?? ""}`}
    />
  );
}
