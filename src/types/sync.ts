export type SyncScope =
  | "CATEGORIES"
  | "PAYMENT_METHODS"
  | "ALLOWANCE"
  | "INCOME"
  | "EXPENSES"
  | "TRANSACTIONS"
  | "PROFILE"
  | "REFLECT";

export interface SyncEvent {
  id?: string | undefined;
  type: "INVALIDATE";
  scope: SyncScope;
  originClientId?: string | undefined;
  timestamp: number;
  entityId?: string | undefined;
  status?: "GENERATING" | "CHATTING" | "COMPLETED" | "IDLE" | undefined;
}
