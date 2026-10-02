export type HouseholdRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export interface HouseholdMember {
  userId: string;
  name: string;
  email?: string;
  role: HouseholdRole;
  createdAt: string;
}
export interface HouseholdInvitation {
  id: string;
  email: string;
  role: HouseholdRole;
  expiresAt: string;
  createdAt: string;
}
export interface HouseholdDetail {
  id: string;
  name: string;
  revision: number;
  role: HouseholdRole;
  canManage: boolean;
  members: HouseholdMember[];
  invitations: HouseholdInvitation[];
}
export interface InvitationPreview {
  householdName: string;
  email: string;
  role: HouseholdRole;
  expiresAt: string;
}
export const isManager = (role: HouseholdRole) =>
  role === "OWNER" || role === "ADMIN";
