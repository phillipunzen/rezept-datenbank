export interface ChatgptAccountSummary {
  id: string;
  email: string;
  label: string;
  connected: boolean;
  active: boolean;
  blocked: boolean;
  creditsConfirmed: boolean;
}
export interface ChatgptStatus {
  enabled: boolean;
  secureOrigin: boolean;
  creditsDisabledConfirmed: boolean;
  accounts: ChatgptAccountSummary[];
}
export interface ChatgptModel { slug: string; displayName: string }
