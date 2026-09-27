export type TwitchLoginStage =
  | "starting"
  | "awaiting_user"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export interface TwitchLoginPayload {
  stage: TwitchLoginStage;
  user_code: string | null;
  verification_uri: string | null;
  progress: number | null;
  expires_in: number | null;
  error: string | null;
}
