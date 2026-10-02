import { registration } from "./schemas";
const id = { type: "string", minLength: 1, maxLength: 30 };
const name = { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" };
const revision = { type: "integer", minimum: 1 };
export const householdParams = {
  type: "object",
  required: ["id"],
  properties: { id },
};
export const householdNameBody = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name },
};
export const householdRenameBody = {
  ...householdNameBody,
  required: ["name", "revision"],
  properties: { name, revision },
};
export const householdRevisionBody = {
  type: "object",
  additionalProperties: false,
  required: ["revision"],
  properties: { revision },
};
export const householdRevisionQuery = householdRevisionBody;
export const memberParams = {
  type: "object",
  required: ["id", "userId"],
  properties: { id, userId: id },
};
export const roleBody = {
  type: "object",
  additionalProperties: false,
  required: ["role", "revision"],
  properties: {
    role: { type: "string", enum: ["OWNER", "ADMIN", "EDITOR", "VIEWER"] },
    revision,
  },
};
export const invitationBody = {
  type: "object",
  additionalProperties: false,
  required: ["email", "role", "revision"],
  properties: {
    email: registration.properties.email,
    role: { type: "string", enum: ["ADMIN", "EDITOR", "VIEWER"] },
    revision,
  },
};
export const invitationParams = {
  type: "object",
  required: ["id", "invitationId"],
  properties: { id, invitationId: id },
};
export const invitationToken = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      pattern: "^[a-f0-9]{64}$",
    },
  },
};
export const invitationRegistration = {
  ...invitationToken,
  required: ["token", "name", "email", "password"],
  properties: {
    ...invitationToken.properties,
    name: registration.properties.name,
    email: registration.properties.email,
    password: registration.properties.password,
  },
};
