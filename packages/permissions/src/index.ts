import type { Role } from '@qitu/contracts';

export interface AccessContext {
  actorId: string;
  actorRoles: readonly Role[];
}

export interface ResourceOwner {
  ownerId: string;
}

/**
 * This is a pure policy seam. Database-backed authorization belongs in the API
 * access layer and must resolve guardian links / mentor assignments first.
 */
export function hasRole(context: AccessContext, role: Role): boolean {
  return context.actorRoles.includes(role);
}

export function canReadOwnedResource(context: AccessContext, resource: ResourceOwner): boolean {
  return context.actorId === resource.ownerId;
}
