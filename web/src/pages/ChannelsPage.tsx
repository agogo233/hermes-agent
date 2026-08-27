import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  Info,
  PlugZap,
  QrCode,
  Radio,
  RotateCw,
  Save,
  Settings2,
  WifiOff,
  X,
} from "lucide-react";
import * as QRCode from "qrcode";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Card, CardContent } from "@nous-research/ui/ui/components/card";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { api } from "@/lib/api";
import type {
  MessagingPlatform,
  MessagingPlatformEnvVar,
  MessagingPlatformUpdate,
  TelegramOnboardingStartResponse,
  WhatsAppOnboardingStartResponse,
  WeixinOnboardingStartResponse,
  QqbotOnboardingStartResponse,
} from "@/lib/api";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { usePageHeader } from "@/contexts/usePageHeader";
import { cn, themedBody } from "@/lib/utils";
import { useI18n } from "@/i18n";

// State → badge mapping. The backend emits a small, fixed vocabulary plus
// whatever the live gateway runtime reports (connected/disconnected/fatal).
const STATE_BADGE: Record<
  string,
  { tone: "success" | "warning" | "destructive" | "secondary" | "outline"; labelKey: string }
> = {
  connected: { tone: "success", labelKey: "stateConnected" },
  pending_restart: { tone: "warning", labelKey: "statePendingRestart" },
  gateway_stopped: { tone: "warning", labelKey: "stateGatewayStopped" },
  startup_failed: { tone: "destructive", labelKey: "stateStartupFailed" },
  disconnected: { tone: "warning", labelKey: "stateDisconnected" },
  not_configured: { tone: "outline", labelKey: "stateNotConfigured" },
  disabled: { tone: "secondary", labelKey: "stateDisabled" },
  fatal: { tone: "destructive", labelKey: "stateError" },
};

function stateBadge(state: string, tChannels: any) {
  const entry = STATE_BADGE[state];
  if (!entry) return { tone: "outline" as const, label: state };
  const label = tChannels?.[entry.labelKey] ?? state;
  return { tone: entry.tone, label };
}

const TELEGRAM_USER_ID_RE = /^\d+$/;
const TELEGRAM_BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;
const SLACK_MEMBER_ID_RE = /^[UW][A-Z0-9]{2,}$/;
const SLACK_TOKEN_PREFIXES: Record<string, string> = {
  SLACK_BOT_TOKEN: "xoxb-",
  SLACK_APP_TOKEN: "xapp-",
};

function validateMessagingEnvField(field: MessagingPlatformEnvVar, value: string, tChannels: any): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (field.key === "TELEGRAM_BOT_TOKEN" && !TELEGRAM_BOT_TOKEN_RE.test(trimmed)) {
    return tChannels?.validateTelegramBotToken ?? "Paste the complete token from @BotFather.";
  }

  if (field.key === "TELEGRAM_ALLOWED_USERS") {
    const invalid = trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .find((part) => !TELEGRAM_USER_ID_RE.test(part));
    if (invalid) {
      return (tChannels?.validateTelegramUserId ?? `${invalid} is not a numeric Telegram user ID.`)
        .replace("{invalid}", invalid);
    }
  }

  const expectedPrefix = SLACK_TOKEN_PREFIXES[field.key];
  if (expectedPrefix && !trimmed.startsWith(expectedPrefix)) {
    return (tChannels?.validateSlackPrefix ?? `${field.prompt || field.key} must start with ${expectedPrefix}`)
      .replace("{field}", field.prompt || field.key)
      .replace("{expectedPrefix}", expectedPrefix);
  }

  if (field.key === "SLACK_ALLOWED_USERS") {
    // Mirror the gateway's parse (gateway/platforms/slack.py): drop empty
    // entries so a trailing/interior comma isn't rejected here. "*" is the
    // allow-all wildcard the gateway honors.
    const parts = trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid = parts.find((part) => part !== "*" && !SLACK_MEMBER_ID_RE.test(part));
    if (invalid) {
      return (tChannels?.validateSlackMemberId ?? `${invalid} does not look like a Slack member ID.`)
        .replace("{invalid}", invalid);
    }
  }

  return null;
}

function formatExpiry(expiresAt: string, tChannels: any): { label: string; isExpired: boolean } {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return { label: tChannels?.expired ?? "expired", isExpired: true };
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return { label: `${minutes}:${rest.toString().padStart(2, "0")}`, isExpired: false };
}

function isTerminalTelegramOnboardingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b410\b/.test(message) && /\b(expired|claimed|gone)\b/i.test(message);
}

function isTerminalWhatsAppOnboardingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b410\b/.test(message) && /\b(expired|gone)\b/i.test(message);
}

function normalizeWhatsAppMode(mode: unknown): "bot" | "self-chat" | null {
  return mode === "bot" || mode === "self-chat" ? mode : null;
}

function isTerminalQROnboardingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b410\b/.test(message) && /\b(expired|gone)\b/i.test(message);
}

const WEIXIN_DM_POLICY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "pairing", labelKey: "dmPairing" },
  { value: "open", labelKey: "dmAllowAll" },
  { value: "allowlist", labelKey: "dmAllowlisted" },
  { value: "disabled", labelKey: "dmDisable" },
];

const QQBOT_DM_POLICY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "pairing", labelKey: "dmPairing" },
  { value: "open", labelKey: "dmAllowAll" },
  { value: "allowlist", labelKey: "dmAllowlisted" },
];

interface QrOnboardingPanelProps {
  onChanged: () => Promise<void>;
  onRestartNeeded: () => void;
  setRestartNeeded: (needed: boolean) => void;
  showToast: (message: string, type: "success" | "error") => void;
  dmPolicyOptions: { value: string; labelKey: string }[];
  connectedLabel: string;
  connectedHelp: string;
  applyPlatform: string;
  applySuccessMessage: string;
  applyFailMessage: (detail: string) => string;
  connectedDetail?: string;
  hasSavedConfig?: boolean;
  configuredValue?: string;
}

function QrOnboardingPanel({
  onChanged,
  onRestartNeeded,
  setRestartNeeded,
  showToast,
  dmPolicyOptions,
  connectedLabel,
  connectedHelp,
  applyPlatform,
  applySuccessMessage,
  applyFailMessage,
  connectedDetail,
  hasSavedConfig,
  configuredValue,
}: QrOnboardingPanelProps) {
  const { t } = useI18n();
  const tCh = t.channels;
  const [setup, setSetup] = useState<
    | (WeixinOnboardingStartResponse & { pairing_id: string; status: string; qr_payload?: string | null; expires_at: string; account_id?: string | null; user_id?: string | null; error?: string | null })
    | (QqbotOnboardingStartResponse & { pairing_id: string; status: string; qr_payload?: string | null; expires_at: string; account_id?: string | null; user_id?: string | null; error?: string | null })
    | null
  >(null);
  // Discriminated union: only one of these will be set at a time.
  const _setup = setup as
    | WeixinOnboardingStartResponse
    | QqbotOnboardingStartResponse
    | null;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "starting" | "waiting" | "connected" | "applying"
  >("idle");
  const [dmPolicy, setDmPolicy] = useState(dmPolicyOptions[0].value);
  const [allowedUsers, setAllowedUsers] = useState("");
  const [homeChannel, setHomeChannel] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!_setup && phase === "idle" && configuredValue) {
      setDmPolicy(configuredValue);
    }
  }, [configuredValue, phase, _setup]);

  const updateQr = useCallback(async (payload?: string | null) => {
    if (!payload) return;
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 3,
        width: 240,
      });
      setQrDataUrl(dataUrl);
    } catch {
      // ignore render failure
    }
  }, []);

  const statusFn = applyPlatform === "weixin" ? api.getWeixinOnboardingStatus : api.getQqbotOnboardingStatus;

  useEffect(() => {
    if (!_setup || phase !== "waiting") return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await statusFn(_setup.pairing_id);
        if (cancelled) return;
        setSetup(status as typeof _setup);
        if (status.qr_payload && status.qr_payload !== _setup.qr_payload) {
          await updateQr(status.qr_payload);
        }
        if (cancelled) return;
        if (status.status === "connected") {
          setPhase("connected");
          setError("");
          return;
        }
        if (status.status === "error") {
          setError(status.error || tCh?.qrSetupFailed);
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          return;
        }
        setError("");
        timeout = setTimeout(poll, 1500);
      } catch (pollError) {
        if (cancelled) return;
        const expiresAt = Date.parse(_setup.expires_at);
        const expired = Number.isFinite(expiresAt) && Date.now() >= expiresAt;
        if (isTerminalQROnboardingError(pollError) || expired) {
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          setError(tCh?.qrExpired);
          return;
        }
        setError((tCh?.qrWaitingRetry ?? `Still waiting. Retrying: ${pollError}`).replace("{pollError}", String(pollError)));
        timeout = setTimeout(poll, 2000);
      }
    };

    timeout = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [phase, _setup, statusFn, updateQr]);

  useEffect(() => {
    if (!_setup) return;
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [_setup]);

  const resetSetup = () => {
    setSetup(null);
    setQrDataUrl("");
    setPhase("idle");
    setError("");
  };

  const start = async () => {
    setPhase("starting");
    setError("");
    setQrDataUrl("");
    try {
      const res = applyPlatform === "weixin"
        ? await api.startWeixinOnboarding()
        : await api.startQqbotOnboarding();
      setSetup(res as typeof _setup);
      if ((res as any).qr_payload) {
        await updateQr((res as any).qr_payload);
      }
      if ((res as any).status === "error") {
        setError((res as any).error || tCh?.qrSetupFailed);
        setSetup(null);
        setPhase("idle");
      } else {
        setPhase((res as any).status === "connected" ? "connected" : "waiting");
      }
    } catch (startError) {
      setPhase("idle");
      setError(String(startError));
    }
  };

  const cancel = async () => {
    if (_setup) {
      try {
        const fn = applyPlatform === "weixin" ? api.cancelWeixinOnboarding : api.cancelQqbotOnboarding;
        await fn(_setup.pairing_id);
      } catch { /* local cleanup wins */ }
    }
    resetSetup();
  };

  const watchRestartOutcome = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const st = await api.getActionStatus("gateway-restart", 5);
        if (st.running) continue;
        if (st.exit_code !== 0 && st.exit_code !== null) {
          onRestartNeeded();
          showToast(
            (tCh?.restartFailedManual ?? `Gateway restart failed (exit ${st.exit_code}) — restart manually`).replace("{exit_code}", String(st.exit_code)),
            "error",
          );
        }
        return;
      } catch { /* transient */ }
    }
  };

  const applyFn = applyPlatform === "weixin" ? api.applyWeixinOnboarding : api.applyQqbotOnboarding;

  const apply = async () => {
    if (!_setup) return;
    setPhase("applying");
    setError("");
    try {
      const body = { dm_policy: dmPolicy, allowed_users: allowedUsers, home_channel: homeChannel };
      const result = await applyFn(_setup.pairing_id, body);
      resetSetup();
      if ((result as any).restart_started) {
        showToast(applySuccessMessage, "success");
        setRestartNeeded(false);
        setTimeout(() => void onChanged(), 4000);
        void watchRestartOutcome();
      } else {
        onRestartNeeded();
        const detail = (result as any).restart_error ? `: ${(result as any).restart_error}` : "";
        showToast(applyFailMessage(detail), "error");
      }
      await onChanged();
    } catch (applyError) {
      setPhase("connected");
      setError(String(applyError));
    }
  };

  const { label: expiresIn, isExpired } = useMemo(
    () => (_setup ? formatExpiry(_setup.expires_at, tCh) : { label: "", isExpired: false }),
    // tick keeps the memo fresh without recalculating on every render branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_setup, tick, tCh],
  );

  const setupHelp =
    phase === "connected" || phase === "applying"
      ? (tCh?.qrHelpConnected ?? `${connectedHelp} — save and restart the gateway to finish.`)
        .replace("{connectedHelp}", connectedHelp)
      : tCh?.qrHelpWaiting ?? "Scan the QR code with your phone to begin setup.";

  const setupStatusLabel = _setup?.status ?? "waiting";

  return (
    <div className="rounded-sm border border-border bg-background/35 p-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="uppercase"
            onClick={() => void start()}
            disabled={phase === "starting" || phase === "waiting" || phase === "applying"}
            prefix={phase === "starting" ? <Spinner /> : <QrCode className="h-4 w-4" />}
          >
            {phase === "starting" ? (tCh?.qrStartButtonPending ?? "Starting…") : (tCh?.qrStartButton ?? "Scan with QR")}
          </Button>
          {hasSavedConfig && (
             <span className="text-xs text-muted-foreground">
               {(tCh?.qrExistingConfig ?? "Existing settings are configured.")
                 .replace("{platform}", applyPlatform)}
             </span>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid gap-1.5">
             <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
               {tCh?.qrDmPolicy ?? "DM policy"}
             </span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={dmPolicy}
              onChange={(e) => setDmPolicy(e.target.value)}
              disabled={phase === "waiting" || phase === "applying"}
            >
               {dmPolicyOptions.map((opt) => (
                 <option key={opt.value} value={opt.value}>{(tCh as any)?.[opt.labelKey] ?? opt.value}</option>
               ))}
            </select>
          </div>
          {(dmPolicy === "allowlist" || dmPolicy === "pairing") && (
            <div className="grid min-w-0 flex-1 gap-1.5">
               <label htmlFor={`${applyPlatform}-allowed-users`} className="text-xs">
                 {applyPlatform === "weixin" ? (tCh?.qrAllowedUserIds ?? "Allowed user IDs") : (tCh?.qrAllowedOpenIds ?? "Allowed OpenIDs")}
               </label>
              <Input
                id={`${applyPlatform}-allowed-users`}
                value={allowedUsers}
                onChange={(e) => setAllowedUsers(e.target.value)}
                disabled={phase === "waiting" || phase === "applying"}
                 placeholder={applyPlatform === "weixin" ? (tCh?.qrPlaceholderUserIds ?? "comma-separated user IDs") : (tCh?.qrPlaceholderOpenIds ?? "comma-separated OpenIDs")}
              />
            </div>
          )}
        </div>

        {_setup && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={homeChannel}
              onChange={(e) => setHomeChannel(e.target.checked)}
              disabled={phase === "waiting" || phase === "applying"}
            />
             {tCh?.qrHomeChannel ?? "Use me as the home channel"}
          </label>
        )}

        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {_setup && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {phase === "connected" || phase === "applying" ? (
                  <Badge tone="success">{tCh?.qrBadgeConnected ?? "Connected"}</Badge>
                ) : (
                  <Badge tone="warning">{setupStatusLabel}</Badge>
                )}
                <Badge tone={isExpired ? "destructive" : "outline"}>
                  {expiresIn}
                </Badge>
              </div>

              <div className="text-sm text-muted-foreground">{setupHelp}</div>

              {phase === "waiting" && (
                <div className="text-xs text-muted-foreground">
                  {applyPlatform === "weixin"
                    ? (tCh?.qrWaitWeChat ?? "Scan with WeChat. After confirmation, choose your DM policy above and save.")
                    : (tCh?.qrWaitQQ ?? "Scan with QQ. After confirmation, choose your DM policy above and save.")}
                </div>
              )}

              {(phase === "connected" || phase === "applying") && (
                <div className="grid gap-3">
                  <div className="border border-border bg-background/45 p-3 text-sm">
                    <div className="font-medium">{connectedLabel}</div>
                    {connectedDetail && (
                      <div className="mt-1 text-muted-foreground">{connectedDetail}</div>
                    )}
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>{tCh?.qrStepSave ?? "Save and restart the gateway."}</li>
                      <li>{tCh?.qrStepMessage ?? "Send Hermes a message from your phone."}</li>
                    </ol>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="uppercase"
                      onClick={() => void apply()}
                      disabled={phase === "applying"}
                      prefix={phase === "applying" ? <Spinner /> : <Save className="h-4 w-4" />}
                    >
                      {phase === "applying" ? (tCh?.qrSaveButtonPending ?? "Saving…") : (tCh?.qrSaveButton ?? "Save and restart")}
                    </Button>
                    <Button size="sm" ghost onClick={() => void cancel()}>
                      {tCh?.qrCancelButton ?? "Cancel"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center gap-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={applyPlatform === "weixin" ? (tCh?.qrAltWeChat ?? "WeChat setup QR code") : (tCh?.qrAltQQ ?? "QQ setup QR code")}
                  className="h-60 w-60 bg-white p-2"
                />
              ) : phase === "connected" || phase === "applying" ? (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 border border-border bg-background/50 p-4 text-center">
                  <Badge tone="success">{tCh?.qrBadgeLinked ?? "Linked"}</Badge>
                  <span className="text-xs text-muted-foreground">{tCh?.qrLinkedSaveToFinish ?? "Save to finish setup"}</span>
                </div>
              ) : (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 border border-dashed border-border bg-background/30 p-4 text-center text-xs text-muted-foreground">
                  <QrCode className="h-8 w-8 opacity-40" />
                  <span>{tCh?.qrQRWillAppear ?? "QR will appear here"}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <Badge tone={isExpired ? "destructive" : "outline"}>
                  {expiresIn}
                </Badge>
                {phase === "waiting" && <Badge tone="warning">{tCh?.qrBadgeWaiting ?? "waiting"}</Badge>}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" ghost onClick={() => void cancel()}>
                  {tCh?.qrCancelButton ?? "Cancel"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const [platforms, setPlatforms] = useState<MessagingPlatform[]>([]);
  const [envPath, setEnvPath] = useState("~/.hermes/.env");
  const [gatewayStartCommand, setGatewayStartCommand] = useState(
    "hermes gateway start",
  );
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const tCh = t.channels;
  const { setEnd } = usePageHeader();

  // Config modal state
  const [editing, setEditing] = useState<MessagingPlatform | null>(null);
  const [draftEnv, setDraftEnv] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const closeEdit = useCallback(() => {
    setEditing(null);
    setFieldErrors({});
  }, []);
  const editModalRef = useModalBehavior({ open: editing !== null, onClose: closeEdit });

  // Per-card busy + restart-needed tracking
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const gatewayRunning = platforms.length > 0 && platforms[0].gateway_running;

  const load = useCallback(() => {
    return api
      .getMessagingPlatforms()
      .then((res) => {
        setPlatforms(res.platforms);
        setEnvPath(res.env_path || "~/.hermes/.env");
        setGatewayStartCommand(res.gateway_start_command || "hermes gateway start");
      })
      .catch((e) => showToast(tCh?.loadError ?? `Error: ${e}`, "error"));
  }, [showToast, tCh]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const openConfig = (platform: MessagingPlatform) => {
    const initial: Record<string, string> = {};
    platform.env_vars.forEach((v) => {
      initial[v.key] = "";
    });
    setDraftEnv(initial);
    setFieldErrors({});
    setEditing(platform);
  };

  const handleSave = async () => {
    if (!editing) return;
    // Only send fields the user actually filled in — leaving a field blank
    // preserves the existing value rather than clobbering it.
    const env: Record<string, string> = {};
    Object.entries(draftEnv).forEach(([k, v]) => {
      if (v.trim()) env[k] = v.trim();
    });
    if (Object.keys(env).length === 0) {
      showToast(tCh?.saveNothingToSave ?? "Nothing to save — fill in at least one field.", "error");
      return;
    }
    const missing = editing.env_vars.filter(
      (v) => v.required && !v.is_set && !env[v.key],
    );
    if (missing.length > 0) {
      const fieldLabel = missing[0].prompt || missing[0].key;
      showToast((tCh?.saveFieldRequired ?? "{field} is required").replace("{field}", fieldLabel), "error");
      return;
    }
    const nextFieldErrors: Record<string, string> = {};
    editing.env_vars.forEach((field) => {
      const message = validateMessagingEnvField(field, draftEnv[field.key] || "", tCh);
      if (message) nextFieldErrors[field.key] = message;
    });
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      showToast(tCh?.saveFixFields ?? "Fix the highlighted fields before saving.", "error");
      return;
    }
    setSaving(true);
    try {
      const body: MessagingPlatformUpdate = { env, enabled: true };
      await api.updateMessagingPlatform(editing.id, body);
      showToast((tCh?.saveSuccess ?? "{name} saved").replace("{name}", editing.name), "success");
      setEditing(null);
      setRestartNeeded(true);
      await load();
    } catch (e) {
      showToast((tCh?.saveFailed ?? "Failed to save: {error}").replace("{error}", String(e)), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (platform: MessagingPlatform) => {
    const next = !platform.enabled;
    setTogglingId(platform.id);
    try {
      await api.updateMessagingPlatform(platform.id, { enabled: next });
      setPlatforms((prev) =>
        prev.map((p) =>
          p.id === platform.id
            ? { ...p, enabled: next, state: next ? "pending_restart" : "disabled" }
            : p,
        ),
      );
      setRestartNeeded(true);
    } catch (e) {
      showToast((tCh?.toggleError ?? `Error: ${e}`).replace("{error}", String(e)), "error");
    } finally {
      setTogglingId(null);
    }
  };

  const handleTest = async (platform: MessagingPlatform) => {
    setTestingId(platform.id);
    try {
      const res = await api.testMessagingPlatform(platform.id);
      showToast((tCh?.testSuccess ?? "{name}: {message}").replace("{name}", platform.name).replace("{message}", res.message), res.ok ? "success" : "error");
    } catch (e) {
      showToast((tCh?.testError ?? `Error: ${e}`).replace("{error}", String(e)), "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await api.restartGateway();
      showToast(tCh?.restartSuccess ?? "Gateway restarting…", "success");
      setRestartNeeded(false);
      // Give the gateway a moment to come up, then refresh status.
      setTimeout(() => void load(), 4000);
    } catch (e) {
      showToast((tCh?.restartFailed ?? "Failed to restart: {error}").replace("{error}", String(e)), "error");
    } finally {
      setRestarting(false);
    }
  };

  useLayoutEffect(() => {
    setEnd(
      <Button
        className="uppercase"
        size="sm"
        onClick={handleRestart}
        disabled={restarting}
        prefix={restarting ? <Spinner /> : <RotateCw className="h-4 w-4" />}
      >
        {restarting ? (tCh?.headerRestarting ?? "Restarting…") : (tCh?.headerRestart ?? "Restart gateway")}
      </Button>,
    );
    return () => setEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEnd, restarting]);

  const configured = useMemo(
    () => platforms.filter((p) => p.configured).length,
    [platforms],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="text-2xl text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Toast toast={toast} />

      {/* Restart banner */}
      {restartNeeded && (
        <Card className="border-warning/50">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <span>
                {tCh?.bannerRestartNeeded ?? "Changes are saved. Restart the gateway for them to take effect."}
              </span>
            </div>
            <Button
              size="sm"
              className="uppercase shrink-0"
              onClick={handleRestart}
              disabled={restarting}
              prefix={restarting ? <Spinner /> : <RotateCw className="h-4 w-4" />}
            >
              {restarting ? (tCh?.bannerRestartNowPending ?? "Restarting…") : (tCh?.bannerRestartNow ?? "Restart now")}
            </Button>
          </CardContent>
        </Card>
      )}

      {!gatewayRunning && !restartNeeded && (
        <Card className="border-border">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4 shrink-0" />
              <span>
                {(tCh?.bannerGatewayNotRunning ?? "The gateway is not running. Configure channels here, then start the gateway with {cmd} (or the Restart button above).")
                  .replace("{cmd}", gatewayStartCommand)}
              </span>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {(tCh?.bannerSummary ?? "{n} of {total} channels configured. Credentials are written to {envPath}; the gateway connects each enabled channel on its next restart.")
          .replace("{n}", String(configured))
          .replace("{total}", String(platforms.length))
          .replace("{envPath}", envPath)}
      </p>

      {/* Config modal */}
      {editing && (
        <div
          ref={editModalRef}
          className={cn(
            "fixed inset-0 z-[100] flex min-h-dvh items-start justify-center overflow-y-auto bg-background/85 px-4",
            "pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]",
            "sm:items-center sm:p-4",
          )}
          onClick={(e) => e.target === e.currentTarget && setEditing(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="channel-config-title"
        >
          <div
            className={cn(
              themedBody,
              "relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col border border-border bg-card shadow-2xl sm:max-h-[90dvh]",
            )}
          >
            <Button
              ghost
              size="icon"
              onClick={() => setEditing(null)}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label={tCh?.configCloseAria ?? "Close"}
            >
              <X />
            </Button>

            <header className="p-5 pb-3 border-b border-border">
              <h2
                id="channel-config-title"
                className="font-mondwest text-display text-base tracking-wider"
              >
                {editing.id === "telegram"
                  ? (tCh?.configTitleTelegram ?? "Use your own Telegram bot")
                  : (tCh?.configTitleOther ?? `Configure ${editing.name}`).replace("{name}", editing.name)}
              </h2>
              {editing.docs_url && (
                <a
                  href={editing.docs_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {editing.id === "telegram" ? (tCh?.configBotFatherGuide ?? "BotFather guide") : (tCh?.configGuideLink ?? "Setup guide")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </header>

            <div className="grid gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
              {editing.id === "telegram" && (
                <div className="grid gap-3 text-sm text-muted-foreground">
                  <p>
                    {tCh?.configTelegramIntro ?? "Connect a bot you already own, or create one in Telegram before filling in this form."}
                  </p>
                  <ol className="grid list-decimal gap-1.5 pl-5">
                    <li>
                      {tCh?.configTelegramStep1 ?? "Open @BotFather, send /newbot, and follow its prompts."}
                    </li>
                    <li>{tCh?.configTelegramStep2 ?? "Copy the complete bot token BotFather gives you."}</li>
                    <li>
                      {tCh?.configTelegramStep3 ?? "Message @userinfobot to find your numeric Telegram user ID, then add it below for immediate access."}
                    </li>
                  </ol>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {tCh?.configTelegramOpenBotFather ?? "Open @BotFather"} <ExternalLink className="h-3 w-3" />
                    </a>
                    <a
                      href="https://t.me/userinfobot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {tCh?.configTelegramFindUserId ?? "Find my user ID"} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="text-xs">
                    {tCh?.configTelegramBlankNote ?? "You can leave allowed users blank. Hermes will then send new DM users a code that you approve from the Pairing page."}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {editing.description}
              </p>
              {editing.env_vars.map((field: MessagingPlatformEnvVar) => (
                <div className="grid gap-1.5" key={field.key}>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`field-${field.key}`}>
                      {field.prompt || field.key}
                      {field.required ? " *" : ""}
                    </Label>
                    {field.help && (
                      <span
                        aria-label={field.help}
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        role="img"
                        title={field.help}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  {field.description && (
                    <span className="text-xs text-muted-foreground">
                      {field.description}
                    </span>
                  )}
                  <Input
                    id={`field-${field.key}`}
                    type={field.is_password ? "password" : "text"}
                    className="text-base leading-6 sm:text-xs sm:leading-4"
                     placeholder={
                       field.is_set
                         ? field.redacted_value || (tCh?.configFieldPlaceholderSet ?? "•••••• (set — leave blank to keep)")
                         : field.key
                     }
                    value={draftEnv[field.key] ?? ""}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setDraftEnv((prev) => ({ ...prev, [field.key]: nextValue }));
                      setFieldErrors((prev) => {
                        if (!prev[field.key]) return prev;
                        const next = { ...prev };
                        delete next[field.key];
                        return next;
                      });
                    }}
                  />
                  {fieldErrors[field.key] && (
                    <span className="text-xs text-destructive">
                      {fieldErrors[field.key]}
                    </span>
                  )}
                </div>
              ))}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button
                  ghost
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setEditing(null)}
                 >
                   {tCh?.configCancelButton ?? "Cancel"}
                 </Button>
                 <Button
                   className="w-full uppercase sm:w-auto"
                   size="sm"
                   onClick={handleSave}
                   disabled={saving}
                   prefix={saving ? <Spinner /> : undefined}
                 >
                   {saving ? (tCh?.configSaveButtonPending ?? "Saving…") : (tCh?.configSaveButton ?? "Save & enable")}
                 </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Platform list */}
      <div className="grid gap-3">
        {platforms.map((platform) => {
          const badge = stateBadge(platform.state, tCh);
          const busy = togglingId === platform.id;
          const StateIcon =
            platform.state === "connected"
              ? CheckCircle2
              : platform.state === "fatal" || platform.state === "startup_failed"
                ? AlertTriangle
                : Radio;
          return (
            <Card key={platform.id} className="border-border">
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <StateIcon
                      className={cn(
                        "h-5 w-5 shrink-0 mt-0.5",
                        platform.state === "connected"
                          ? "text-success"
                          : platform.state === "fatal" ||
                              platform.state === "startup_failed"
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mondwest normal-case text-sm font-medium">
                          {platform.name}
                        </span>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {platform.description}
                      </span>
                      {platform.error_message && (
                        <span className="text-xs text-destructive">
                          {platform.error_message}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                    <div className="flex items-center gap-1.5">
                      {busy ? (
                        <Spinner className="text-sm" />
                      ) : (
                         <Switch
                           checked={platform.enabled}
                           onCheckedChange={() => void handleToggle(platform)}
                           aria-label={(platform.enabled
                             ? (tCh?.cardDisable ?? "Disable {name}").replace("{name}", platform.name)
                             : (tCh?.cardEnable ?? "Enable {name}").replace("{name}", platform.name))}
                         />
                      )}
                    </div>
                    <Button
                      ghost
                      size="sm"
                      onClick={() => handleTest(platform)}
                      disabled={testingId === platform.id}
                      prefix={
                        testingId === platform.id ? (
                          <Spinner />
                        ) : (
                          <PlugZap className="h-4 w-4" />
                        )
                      }
                     >
                       {tCh?.cardTest ?? "Test"}
                     </Button>
                     {platform.id !== "telegram" && (
                       <Button
                         size="sm"
                         className="uppercase"
                         onClick={() => openConfig(platform)}
                         prefix={<Settings2 className="h-4 w-4" />}
                       >
                         {tCh?.cardConfigure ?? "Configure"}
                       </Button>
                    )}
                  </div>
                </div>
                {platform.id === "telegram" && (
                  <TelegramOnboardingPanel
                    onManualSetup={() => openConfig(platform)}
                    onChanged={load}
                    onRestartNeeded={() => setRestartNeeded(true)}
                    platform={platform}
                    setRestartNeeded={setRestartNeeded}
                    showToast={showToast}
                  />
                )}
                {platform.id === "whatsapp" && (
                  <WhatsAppOnboardingPanel
                    onChanged={load}
                    onRestartNeeded={() => setRestartNeeded(true)}
                    platform={platform}
                    setRestartNeeded={setRestartNeeded}
                    showToast={showToast}
                  />
                )}
                {platform.id === "weixin" && (
                  <QrOnboardingPanel
                    onChanged={load}
                    onRestartNeeded={() => setRestartNeeded(true)}
                    setRestartNeeded={setRestartNeeded}
                    showToast={showToast}
                    dmPolicyOptions={WEIXIN_DM_POLICY_OPTIONS}
                     connectedLabel={tCh?.wechatConnectedLabel ?? "WeChat account linked"}
                     connectedHelp={tCh?.wechatConnectedHelp ?? "Your WeChat iLink bot is ready"}
                     applyPlatform="weixin"
                     applySuccessMessage={tCh?.wechatApplySuccess ?? "WeChat saved; gateway restarting…"}
                     applyFailMessage={(detail) => (tCh?.wechatApplyFail ?? "WeChat saved; gateway restart failed{detail}").replace("{detail}", detail)}
                     connectedDetail={tCh?.wechatConnectedDetail ?? "iLink bot identity (…@im.bot)"}
                    hasSavedConfig={Boolean(platform.weixin_setup)}
                    configuredValue={platform.weixin_setup?.dm_policy}
                  />
                )}
                {platform.id === "qqbot" && (
                  <QrOnboardingPanel
                    onChanged={load}
                    onRestartNeeded={() => setRestartNeeded(true)}
                    setRestartNeeded={setRestartNeeded}
                    showToast={showToast}
                    dmPolicyOptions={QQBOT_DM_POLICY_OPTIONS}
                     connectedLabel={tCh?.qqConnectedLabel ?? "QQ Bot linked"}
                     connectedHelp={tCh?.qqConnectedHelp ?? "Your QQ Bot application is ready"}
                     applyPlatform="qqbot"
                     applySuccessMessage={tCh?.qqApplySuccess ?? "QQ Bot saved; gateway restarting…"}
                     applyFailMessage={(detail) => (tCh?.qqApplyFail ?? "QQ Bot saved; gateway restart failed{detail}").replace("{detail}", detail)}
                     connectedDetail={tCh?.qqConnectedDetail ?? "QQ Bot app identity"}
                    hasSavedConfig={Boolean(platform.qqbot_setup)}
                    configuredValue={platform.qqbot_setup?.dm_policy}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function WhatsAppOnboardingPanel({
  onChanged,
  onRestartNeeded,
  platform,
  setRestartNeeded,
  showToast,
}: {
  onChanged: () => Promise<void>;
  onRestartNeeded: () => void;
  platform: MessagingPlatform;
  setRestartNeeded: (needed: boolean) => void;
  showToast: (message: string, type: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const tCh = t.channels;
  const configuredMode = useMemo(
    () => normalizeWhatsAppMode(platform.whatsapp_setup?.mode),
    [platform.whatsapp_setup?.mode],
  );
  const [setup, setSetup] = useState<WhatsAppOnboardingStartResponse | null>(
    null,
  );
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "starting" | "waiting" | "connected" | "applying"
  >("idle");
  const [mode, setMode] = useState<"bot" | "self-chat">(
    configuredMode ?? "bot",
  );
  const [allowedUsers, setAllowedUsers] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!setup && phase === "idle" && configuredMode) {
      setMode(configuredMode);
    }
  }, [configuredMode, phase, setup]);

  const updateQr = useCallback(async (payload?: string | null) => {
    if (!payload) return;
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 3,
      width: 240,
    });
    setQrDataUrl(dataUrl);
  }, []);

  useEffect(() => {
    if (!setup || phase !== "waiting") return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await api.getWhatsAppOnboardingStatus(setup.pairing_id);
        if (cancelled) return;
        setSetup(status);
        if (status.qr_payload && status.qr_payload !== setup.qr_payload) {
          await updateQr(status.qr_payload);
        }
        if (cancelled) return;
        if (status.status === "connected") {
          setPhase("connected");
          setError("");
          return;
        }
        if (status.status === "error") {
          setError(status.error || tCh?.whatsappSetupFailed);
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          return;
        }
        setError("");
        timeout = setTimeout(poll, 1500);
      } catch (pollError) {
        if (cancelled) return;
        const expiresAt = Date.parse(setup.expires_at);
        const expired =
          Number.isFinite(expiresAt) && Date.now() >= expiresAt;
        if (isTerminalWhatsAppOnboardingError(pollError) || expired) {
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          setError(tCh?.whatsappQRExpired);
          return;
        }
        setError((tCh?.whatsappWaitingRetry ?? `Still waiting for WhatsApp. Retrying after: ${pollError}`).replace("{pollError}", String(pollError)));
        timeout = setTimeout(poll, 2000);
      }
    };

    timeout = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [phase, setup, updateQr]);

  useEffect(() => {
    if (!setup) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [setup]);

  const resetSetup = () => {
    setSetup(null);
    setQrDataUrl("");
    setPhase("idle");
    setError("");
  };

  const start = async () => {
    setPhase("starting");
    setError("");
    setQrDataUrl("");
    try {
      const res = await api.startWhatsAppOnboarding({
        mode,
        allowed_users: allowedUsers,
      });
      setSetup(res);
      if (res.qr_payload) {
        await updateQr(res.qr_payload);
      }
      if (res.status === "error") {
        setError(res.error || tCh?.whatsappSetupFailed);
        setSetup(null);
        setPhase("idle");
      } else {
        setPhase(res.status === "connected" ? "connected" : "waiting");
      }
    } catch (startError) {
      setPhase("idle");
      setError(String(startError));
    }
  };

  const cancel = async () => {
    if (setup) {
      try {
        await api.cancelWhatsAppOnboarding(setup.pairing_id);
      } catch {
        /* local cleanup still wins */
      }
    }
    resetSetup();
  };

  const watchRestartOutcome = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const st = await api.getActionStatus("gateway-restart", 5);
        if (st.running) continue;
        if (st.exit_code !== 0 && st.exit_code !== null) {
          onRestartNeeded();
          showToast(
            `Gateway restart failed (exit ${st.exit_code}) — restart manually`,
            "error",
          );
        }
        return;
      } catch {
        // transient fetch error; keep polling
      }
    }
  };

  const apply = async () => {
    if (!setup) return;
    setPhase("applying");
    setError("");
    try {
      const result = await api.applyWhatsAppOnboarding(setup.pairing_id, {
        mode,
        allowed_users: allowedUsers,
      });
      resetSetup();
       if (result.restart_started) {
         showToast(t.channels.whatsappApplySuccess, "success");
         setRestartNeeded(false);
         setTimeout(() => void onChanged(), 4000);
         void watchRestartOutcome();
       } else {
         onRestartNeeded();
         const detail = result.restart_error ? `: ${result.restart_error}` : "";
         showToast(t.channels.whatsappApplyFail.replace("{detail}", detail), "error");
       }
      await onChanged();
    } catch (applyError) {
      setPhase("connected");
      setError(String(applyError));
    }
  };

  const { label: expiresIn, isExpired } = useMemo(
    () => (setup ? formatExpiry(setup.expires_at, tCh) : { label: "", isExpired: false }),
    // tick keeps the memo fresh without recalculating on every render branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, tick, tCh],
  );
  const setupStatusLabel =
    setup?.status === "installing"
      ? (tCh?.whatsappStatusPreparing ?? "preparing")
      : setup?.status === "starting"
        ? (tCh?.whatsappStatusStarting ?? "starting")
        : (tCh?.whatsappStatusWaiting ?? "waiting");
  const setupHelp =
    phase === "connected" || phase === "applying"
      ? (tCh?.whatsappHelpApplying ?? "WhatsApp is linked but Hermes is not listening yet. Save and restart the gateway to finish setup.")
      : setup?.status === "installing"
        ? (tCh?.whatsappHelpInstalling ?? "Preparing the WhatsApp bridge. The QR code will appear here when it is ready.")
        : setup?.status === "starting"
          ? (tCh?.whatsappHelpStarting ?? "Starting the WhatsApp pairing bridge. The QR code will appear here when it is ready.")
          : (tCh?.whatsappHelpWaiting ?? "Open WhatsApp on your phone, then go to Linked Devices and scan from there. This QR is not a browser URL.");
  const linkedAccountLabel = setup?.account_phone
    ? `+${setup.account_phone}`
    : setup?.account_name || setup?.account_id || "";
  const linkedAccountDetail =
    setup?.account_phone || setup?.account_id
      ? (tCh?.whatsappLinkedDetailPhone ?? "This is the WhatsApp account Hermes is now logged into.")
      : (tCh?.whatsappLinkedDetailDefault ?? "Hermes is logged into the WhatsApp account that scanned the QR code.");
  const linkedAccountChatUrl = setup?.account_phone
    ? `https://wa.me/${setup.account_phone}`
    : "";
  const messageInstruction =
    mode === "self-chat"
      ? (tCh?.whatsappInstructionSelfChat ?? "After the restart, open Message Yourself on the linked account and send Hermes a message.")
      : (tCh?.whatsappInstructionBot ?? "After the restart, start a chat from another WhatsApp account with the linked account and send Hermes a message.");
  const hasSavedAllowedUsers = Boolean(platform.whatsapp_setup?.allowed_users_set);
  const pairingInstruction =
    mode === "self-chat" && !allowedUsers.trim()
      ? hasSavedAllowedUsers
        ? (tCh?.whatsappPairingKeepAllowlist ?? "Hermes will keep the saved WhatsApp allowlist.")
        : (tCh?.whatsappPairingSelfChat ?? "Self-chat mode will allow the linked account automatically when you save.")
      : !allowedUsers.trim() && hasSavedAllowedUsers
        ? (tCh?.whatsappPairingKeepAllowlist ?? "Hermes will keep the saved WhatsApp allowlist.")
        : (tCh?.whatsappPairingDefault ?? "If no allowed numbers were entered, Hermes replies with a pairing code. Approve it from the dashboard Pairing page.");

  return (
    <div className="rounded-sm border border-border bg-background/35 p-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="uppercase"
            onClick={() => void start()}
            disabled={phase === "starting" || phase === "waiting" || phase === "applying"}
            prefix={phase === "starting" ? <Spinner /> : <QrCode className="h-4 w-4" />}
          >
            {phase === "starting" ? (tCh?.whatsappStartButtonPending ?? "Starting…") : (tCh?.whatsappStartButton ?? "Pair with QR")}
          </Button>
          {platform.configured && (
             <span className="text-xs text-muted-foreground">
               {tCh?.whatsappExistingConfig ?? "Existing WhatsApp settings are configured."}
             </span>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid gap-1.5">
             <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
               {tCh?.whatsappMode ?? "Mode"}
             </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                outlined={mode !== "bot"}
                onClick={() => setMode("bot")}
                disabled={phase === "waiting" || phase === "applying"}
              >
                 {tCh?.whatsappModeBot ?? "Bot"}
              </Button>
              <Button
                size="sm"
                outlined={mode !== "self-chat"}
                onClick={() => setMode("self-chat")}
                disabled={phase === "waiting" || phase === "applying"}
              >
                 {tCh?.whatsappModeSelfChat ?? "Self-chat"}
              </Button>
            </div>
          </div>
          <div className="grid min-w-0 flex-1 gap-1.5">
             <Label htmlFor="whatsapp-allowed-users">{tCh?.whatsappAllowedNumbers ?? "Allowed WhatsApp numbers"}</Label>
            <Input
              id="whatsapp-allowed-users"
              value={allowedUsers}
              onChange={(event) => setAllowedUsers(event.target.value)}
              disabled={phase === "waiting" || phase === "applying"}
               placeholder={tCh?.whatsappNumbersPlaceholder ?? "15551234567,15557654321"}
            />
          </div>
        </div>

        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {setup && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {phase === "connected" || phase === "applying" ? (
                  <Badge tone="success">{tCh?.whatsappLinkedBadge ?? "Linked"}</Badge>
                ) : (
                  <Badge tone="warning">{setupStatusLabel}</Badge>
                )}
                <Badge tone={isExpired ? "destructive" : "outline"}>
                  {expiresIn}
                </Badge>
              </div>

              <div className="text-sm text-muted-foreground">{setupHelp}</div>

              {phase === "waiting" && (
                <div className="text-xs text-muted-foreground">
                  {tCh?.whatsappUnknownNote ?? "After saving, unknown DMs use Hermes pairing codes unless their number is already allowed."}
                </div>
              )}

              {(phase === "connected" || phase === "applying") && (
                <div className="grid gap-3">
                  <div className="border border-border bg-background/45 p-3 text-sm">
                    <div className="font-medium">
                      {linkedAccountLabel
                        ? (tCh?.whatsappLinkedLabel ?? "Linked as {name}").replace("{name}", linkedAccountLabel)
                        : (tCh?.whatsappLinkedDetailDefault ?? "WhatsApp device linked")}
                    </div>
                    <div className="mt-1 text-muted-foreground">{linkedAccountDetail}</div>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>{tCh?.qrStepSave ?? "Save and restart the gateway."}</li>
                      <li>{messageInstruction}</li>
                      <li>{pairingInstruction}</li>
                    </ol>
                    {linkedAccountChatUrl && (
                      <a
                        className="mt-3 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                        href={linkedAccountChatUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tCh?.whatsappOpenChatLink ?? "Open chat link"}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="uppercase"
                      onClick={() => void apply()}
                      disabled={phase === "applying"}
                      prefix={phase === "applying" ? <Spinner /> : <Save className="h-4 w-4" />}
                    >
                      {phase === "applying" ? (tCh?.whatsappSaveButtonPending ?? "Saving…") : (tCh?.whatsappSaveButton ?? "Save and restart")}
                    </Button>
                    <Button size="sm" ghost onClick={() => void cancel()}>
                      {tCh?.whatsappCancelButton ?? "Cancel"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center gap-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={tCh?.qrAltWhatsApp ?? "WhatsApp setup QR code"}
                  className="h-60 w-60 bg-white p-2"
                />
              ) : phase === "connected" || phase === "applying" ? (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 border border-border bg-background/50 p-4 text-center">
                  <Badge tone="success">{tCh?.whatsappLinkedBadge ?? "Linked"}</Badge>
                  <div className="text-sm text-muted-foreground">
                    {linkedAccountLabel || (tCh?.whatsappLinkedSessionFound ?? "Existing WhatsApp session found")}
                  </div>
                </div>
              ) : (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-3 border border-border bg-background/50 p-4 text-center">
                  <Spinner className="text-2xl" />
                  <div className="text-xs text-muted-foreground">
                    {tCh?.whatsappQRWillAppear ?? "Waiting for WhatsApp to provide a QR code…"}
                  </div>
                </div>
              )}
              {phase === "waiting" && (
                <span className="text-center text-xs text-muted-foreground">
                  {tCh?.whatsappScanInstruction ?? "Scan with WhatsApp Linked Devices, not the camera app."}
                </span>
              )}
              <Button size="sm" ghost onClick={() => void cancel()}>
                {tCh?.whatsappCancelButton ?? "Cancel"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TelegramOnboardingPanel({
  onManualSetup,
  onChanged,
  onRestartNeeded,
  platform,
  setRestartNeeded,
  showToast,
}: {
  onManualSetup: () => void;
  onChanged: () => Promise<void>;
  onRestartNeeded: () => void;
  platform: MessagingPlatform;
  setRestartNeeded: (needed: boolean) => void;
  showToast: (message: string, type: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const tCh = t.channels;
  const [setup, setSetup] = useState<TelegramOnboardingStartResponse | null>(
    null,
  );
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "starting" | "waiting" | "ready" | "applying"
  >("idle");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [allowedIds, setAllowedIds] = useState<string[]>([]);
  const [detectedOwnerId, setDetectedOwnerId] = useState<string | null>(null);
  const [newAllowedId, setNewAllowedId] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!setup || phase !== "waiting") return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await api.getTelegramOnboardingStatus(setup.pairing_id);
        if (cancelled) return;
        if (status.status === "ready") {
          setPhase("ready");
          setBotUsername(status.bot_username ?? null);
          setError("");
          if (
            status.owner_user_id &&
            TELEGRAM_USER_ID_RE.test(status.owner_user_id)
          ) {
            setDetectedOwnerId(status.owner_user_id);
            setAllowedIds([status.owner_user_id]);
          }
          return;
        }
        setError("");
        timeout = setTimeout(poll, 2000);
      } catch (pollError) {
        if (cancelled) return;

        const expiresAt = Date.parse(setup.expires_at);
        const expired =
          Number.isFinite(expiresAt) && Date.now() >= expiresAt;
        if (isTerminalTelegramOnboardingError(pollError) || expired) {
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          setError(tCh?.telegramQRExpired);
          return;
        }

        setError((tCh?.telegramWaitingRetry ?? `Still waiting for Telegram. Retrying after: ${pollError}`).replace("{pollError}", String(pollError)));
        timeout = setTimeout(poll, 2000);
      }
    };

    timeout = setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [phase, setup]);

  useEffect(() => {
    if (!setup) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [setup]);

  const resetSetup = () => {
    setSetup(null);
    setQrDataUrl("");
    setPhase("idle");
    setBotUsername(null);
    setAllowedIds([]);
    setDetectedOwnerId(null);
    setNewAllowedId("");
    setError("");
  };

  const start = async () => {
    setPhase("starting");
    setError("");
    setBotUsername(null);
    setAllowedIds([]);
    setDetectedOwnerId(null);
    setNewAllowedId("");
    try {
      const res = await api.startTelegramOnboarding({ bot_name: "Hermes Agent" });
      const dataUrl = await QRCode.toDataURL(res.qr_payload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 224,
      });
      setSetup(res);
      setQrDataUrl(dataUrl);
      setPhase("waiting");
    } catch (startError) {
      setPhase("idle");
      setError(String(startError));
    }
  };

  const cancel = async () => {
    if (setup) {
      try {
        await api.cancelTelegramOnboarding(setup.pairing_id);
      } catch {
        /* local cleanup still wins */
      }
    }
    resetSetup();
  };

  const addAllowedId = () => {
    const trimmed = newAllowedId.trim();
    if (!TELEGRAM_USER_ID_RE.test(trimmed)) {
      setError(tCh?.telegramInvalidUserId);
      return;
    }
    setError("");
    setAllowedIds((ids) => (ids.includes(trimmed) ? ids : [...ids, trimmed]));
    setNewAllowedId("");
  };

  // restart_started only means the `hermes gateway restart` child spawned —
  // not that the restart will succeed (e.g. systemd linger missing, service
  // manager failure). Poll the action status briefly and surface a non-zero
  // exit via the manual-restart banner. Note: in no-service installs the
  // child becomes the foreground gateway and never exits, so "still running
  // when the window closes" counts as success.
  const watchRestartOutcome = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const st = await api.getActionStatus("gateway-restart", 5);
        if (st.running) continue;
        if (st.exit_code !== 0 && st.exit_code !== null) {
          onRestartNeeded();
          showToast(
            (tCh?.restartFailedManual ?? `Gateway restart failed (exit ${st.exit_code}) — restart manually`).replace("{exit_code}", String(st.exit_code)),
            "error",
          );
        }
        return;
      } catch {
        // transient fetch error; keep polling
      }
    }
  };

  const apply = async () => {
    if (!setup) return;
    if (allowedIds.length === 0) {
      setError(tCh?.telegramNeedUserId);
      return;
    }
    setPhase("applying");
    setError("");
    try {
      const result = await api.applyTelegramOnboarding(setup.pairing_id, {
        allowed_user_ids: allowedIds,
      });
      resetSetup();
      if (result.restart_started) {
        showToast(tCh?.telegramSavedRestarting ?? "Telegram saved; gateway restarting…", "success");
        setRestartNeeded(false);
        setTimeout(() => void onChanged(), 4000);
        void watchRestartOutcome();
      } else if (result.restart_started === undefined && result.needs_restart) {
        try {
          await api.restartGateway();
          showToast(tCh?.telegramSavedRestarting ?? "Telegram saved; gateway restarting…", "success");
          setRestartNeeded(false);
          setTimeout(() => void onChanged(), 4000);
        } catch (restartError) {
          onRestartNeeded();
          showToast((tCh?.telegramSavedRestartFailed ?? "Telegram saved; gateway restart failed: {detail}").replace("{detail}", String(restartError)), "error");
        }
      } else {
        onRestartNeeded();
        const detail = result.restart_error ? `: ${result.restart_error}` : "";
        showToast((tCh?.telegramSavedRestartFailed ?? "Telegram saved; gateway restart failed{detail}").replace("{detail}", detail), "error");
      }
      await onChanged();
    } catch (applyError) {
      setPhase("ready");
      setError(String(applyError));
    }
  };

  const { label: expiresIn, isExpired } = useMemo(
    () => (setup ? formatExpiry(setup.expires_at, tCh) : { label: "", isExpired: false }),
    // tick keeps the memo fresh without recalculating on every render branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, tick, tCh],
  );

  return (
    <div className="rounded-sm border border-border bg-background/35 p-4">
      <div className="grid gap-1">
        <span className="font-mondwest text-sm text-foreground">
          {tCh?.telegramChooseMethod ?? "Choose how to connect your Telegram bot"}
        </span>
        <span className="text-xs text-muted-foreground">
          {tCh?.telegramMethodDesc ?? "Both options connect a bot you control and save its credentials only to this Hermes installation."}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-border">
        <div className="grid content-start gap-3 sm:pr-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase text-foreground">
              {tCh?.telegramQuickSetup ?? "Quick setup"}
            </span>
            <Badge tone="success">{tCh?.telegramRecommended ?? "recommended"}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {tCh?.telegramQuickDesc ?? "Scan a QR code and confirm in Telegram. Hermes creates the bot and detects your Telegram user ID automatically."}
          </p>
          <Button
            size="sm"
            className="w-fit uppercase"
            onClick={() => void start()}
            disabled={phase !== "idle"}
            prefix={phase === "starting" ? <Spinner /> : <QrCode className="h-4 w-4" />}
          >
            {phase === "starting" ? (tCh?.telegramQuickButtonPending ?? "Starting…") : (tCh?.telegramQuickButton ?? "Create with QR")}
          </Button>
        </div>

        <div className="grid content-start gap-3 border-t border-border pt-4 sm:border-t-0 sm:pl-4 sm:pt-0">
          <span className="text-xs font-medium uppercase text-foreground">
            {tCh?.telegramOwnBot ?? "Use your own bot"}
          </span>
          <p className="text-xs text-muted-foreground">
            {tCh?.telegramOwnBotDesc ?? "Create a bot with @BotFather, or connect one you already have, by entering its token and choosing who can use it."}
          </p>
          <Button
            size="sm"
            outlined
            className="w-fit uppercase"
            onClick={onManualSetup}
            disabled={phase !== "idle"}
            prefix={<Bot className="h-4 w-4" />}
          >
            {tCh?.telegramManualButton ?? "Manual setup"}
          </Button>
        </div>
      </div>

      {platform.configured && (
        <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {tCh?.telegramExistingConfig ?? "Telegram credentials are already configured. A new QR setup or bot token will replace the current bot when you save."}
        </div>
      )}

      {phase !== "idle" && (
        <div className="mt-4 border-t border-border pt-4">
          <span className="text-xs text-muted-foreground">
            {tCh?.telegramMethodLock ?? "Finish or cancel the current QR setup before switching methods."}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {setup && qrDataUrl && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid gap-3">
            {(phase === "ready" || phase === "applying") && (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">{tCh?.telegramBadgeReady ?? "Ready"}</Badge>
                  {botUsername && (
                    <span className="font-courier text-sm text-muted-foreground">
                      @{botUsername}
                    </span>
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {tCh?.telegramAllowedUsers ?? "Allowed users"}
                      </span>
                      {detectedOwnerId && allowedIds.includes(detectedOwnerId) && (
                        <Badge tone="success">{tCh?.telegramOwnerDetected ?? "owner detected"}</Badge>
                      )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allowedIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="inline-flex items-center gap-1 border border-border px-2 py-1 font-courier text-xs text-foreground hover:border-destructive/50"
                        onClick={() =>
                          setAllowedIds((ids) =>
                            ids.filter((existing) => existing !== id),
                          )
                        }
                      >
                        {id}
                        <X className="h-3 w-3" />
                      </button>
                    ))}
                    {allowedIds.length === 0 && (
                        <span className="text-sm text-muted-foreground">
                          {tCh?.telegramAddUserId ?? "Add at least one Telegram user ID."}
                        </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={newAllowedId}
                    onChange={(event) => setNewAllowedId(event.target.value)}
                    placeholder={tCh?.telegramUserIdPlaceholder ?? "Telegram user ID"}
                    className="font-courier"
                  />
                  <Button size="sm" outlined onClick={addAllowedId} prefix={<Check />}>
                    {tCh?.telegramAddButton ?? "Add"}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="uppercase"
                    onClick={() => void apply()}
                    disabled={phase === "applying"}
                    prefix={phase === "applying" ? <Spinner /> : <Save className="h-4 w-4" />}
                  >
                    {phase === "applying" ? (tCh?.telegramSaveButtonPending ?? "Saving…") : (tCh?.telegramSaveButton ?? "Save and restart")}
                  </Button>
                  <Button size="sm" ghost onClick={() => void cancel()}>
                    {tCh?.telegramCancelButton ?? "Cancel"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-3">
            <img
              src={qrDataUrl}
              alt={tCh?.telegramQRAlt ?? "Telegram setup QR code"}
              className="h-56 w-56 bg-white p-2"
            />
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <Badge tone={isExpired ? "destructive" : "outline"}>
                {expiresIn}
              </Badge>
              {phase === "waiting" && <Badge tone="warning">{tCh?.telegramBadgeWaiting ?? "waiting"}</Badge>}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href={setup.deep_link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 border border-border px-3 text-xs uppercase text-foreground hover:border-foreground/40"
              >
                <ExternalLink className="h-4 w-4" />
                {tCh?.telegramOpenTelegram ?? "Open Telegram"}
              </a>
              <Button size="sm" ghost onClick={() => void cancel()}>
                {tCh?.telegramCancelButton ?? "Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
