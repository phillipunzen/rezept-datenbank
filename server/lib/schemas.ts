export const publicUser = {
  id: true,
  email: true,
  name: true,
  isAdmin: true,
  locale: true,
} as const;
const email = { type: "string", format: "email", maxLength: 254 };
const password = { type: "string", minLength: 12, maxLength: 128 };
const name = { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" };
export const credentials = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email,
    password: { type: "string", minLength: 1, maxLength: 128 },
  },
};
export const registration = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password", "name"],
  properties: { email, password, name, householdName: name },
};
export const setup = {
  ...registration,
  required: [...registration.required, "setupToken"],
  properties: {
    ...registration.properties,
    setupToken: { type: "string", minLength: 32, maxLength: 256 },
  },
};
export const profile = {
  type: "object",
  additionalProperties: false,
  required: ["name", "locale"],
  properties: { name, locale: { type: "string", enum: ["de", "en"] } },
};
export const changePassword = {
  type: "object",
  additionalProperties: false,
  required: ["currentPassword", "newPassword"],
  properties: {
    currentPassword: { type: "string", minLength: 1, maxLength: 128 },
    newPassword: password,
  },
};
