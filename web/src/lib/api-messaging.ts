export interface MessagingPlatformEnvVar {
  key: string;
  required: boolean;
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  prompt: string;
  help: string;
  url: string | null;
  is_password: boolean;
  /** Comma-separated allowlist rendered one entry per ID (absent on older backends). */
  is_list?: boolean;
  /** Plain saved value, sent only for allowlists (they are IDs, not secrets). */
  value?: string | null;
  advanced: boolean;
}

export interface MessagingPlatform {
  id: string;
  name: string;
  description: string;
  docs_url: string;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  /**
   * "connected" | "disabled" | "not_configured" | "pending_restart" |
   * "gateway_stopped" | "startup_failed" | "disconnected" | "fatal" | string
   */
  state: string;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
  home_channel: { platform: string; chat_id: string; name: string; thread_id?: string } | null;
  /**
   * Where the effective home channel comes from: `"env"` (a `*_HOME_CHANNEL`
   * .env var overrides config.yaml — the UI disables editing), `"config"`
   * (config.yaml `platforms.<id>.home_channel`), or `null` (never set).
   */
  home_channel_source?: "env" | "config" | null;
  /** The `*_HOME_CHANNEL` env var that would override this platform, if any. */
  home_channel_env?: string | null;
  /** Multiplex secondary served on the default profile's shared listener: the vendor callback URL. */
  ingress_url?: string | null;
  /** Switched off by the GATEWAY_RELAY_URL relay-exclusive rule, not by the user (absent on older backends). */
  disabled_by_relay?: boolean;
  /** Team Gateway's shared bot carries this platform: setup links an account to it. */
  relay_fronted?: boolean;
  /** The relay owns this platform outright, so a direct bot would be switched off at every start. */
  relay_exclusive?: boolean;
  whatsapp_setup?: {
    mode?: string;
    allowed_users_set?: boolean;
    home_channel_set?: boolean;
  } | null;
  weixin_setup?: {
    dm_policy?: string;
    allowed_users_set?: boolean;
  } | null;
  qqbot_setup?: {
    dm_policy?: string;
    group_policy?: string;
    group_allowed_users_set?: boolean;
  } | null;
  env_vars: MessagingPlatformEnvVar[];
}

export interface RelayLinkedAccount {
  platformUserId: string;
  handle?: string;
  displayName?: string;
  containerName?: string;
}

export interface RelayLinksResponse {
  /** "portal" when the Nous Portal access setting governs this agent: links are made there. */
  managed_by?: "portal" | "connector";
  portal_url?: string;
  platforms: { platform: string; bot_url: string | null; accounts: RelayLinkedAccount[] }[];
}

export interface RelayLinkCode {
  platform: string;
  code: string;
  /** The exact message to send the shared bot. */
  command: string;
  expires_at: string | null;
  bot_url: string | null;
}

export interface RelayLinkCodeState {
  /** pending = not redeemed yet; inactive = used or expired; refused = see reason. */
  state: "pending" | "inactive" | "refused";
  reason?: string | null;
}
