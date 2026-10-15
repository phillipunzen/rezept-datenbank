export interface ChatgptAccountSummary {
  id: string;
  email: string;
  label: string;
  connected: boolean;
  active: boolean;
  blocked: boolean;
  creditsConfirmed: boolean;
  provider?: "oauth" | "device";
}
export interface ChatgptStatus {
  enabled: boolean;
  secureOrigin: boolean;
  creditsDisabledConfirmed: boolean;
  accounts: ChatgptAccountSummary[];
  canManageShared?: boolean;
  shared?: {
    enabled: boolean;
    connected: boolean;
    blocked: boolean;
    creditsConfirmed: boolean;
    provider: "device" | null;
    ownAccountId: string | null;
  };
}
export interface ChatgptModel { slug: string; displayName: string }
export interface ChatgptDeviceStatus {
  id: string;
  status: "PENDING" | "COMPLETE" | "FAILED" | "CANCELLED" | "EXPIRED";
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
}
