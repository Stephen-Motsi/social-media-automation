import type { Role } from "@prisma/client";

export function isStaffRole(role?: string | null) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function canAccessOwnedRecord(viewer: { id: string; role: Role }, ownerId: string | null) {
  return isStaffRole(viewer.role) || ownerId === viewer.id;
}

export function canPublishToAccount(author: { id: string; role: Role }, ownerId: string | null) {
  return ownerId === author.id || (ownerId === null && isStaffRole(author.role));
}
