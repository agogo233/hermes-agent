import { useCallback, useEffect, useMemo, useState } from "react";
import { QrCode, Save } from "lucide-react";
import * as QRCode from "qrcode";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { api } from "@/lib/api";
import type {
  QqbotOnboardingStartResponse,
  WeixinOnboardingStartResponse,
} from "@/lib/api";

const WEIXIN_DM_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "pairing", label: "DM pairing" },
  { value: "open", label: "Allow all DMs" },
  { value: "allowlist", label: "Only allowed users" },
  { value: "disabled", label: "Disable DMs" },
];

const QQBOT_DM_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "pairing", label: "DM pairing" },
  { value: "open", label: "Allow all DMs" },
  { value: "allowlist", label: "Only allowed users" },
];

const QQBOT_GROUP_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "disabled", label: "Disable groups" },
  { value: "allowlist", label: "Only allowed groups" },
  { value: "open", label: "Allow all groups" },
];

function formatExpiry(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function isTerminalQROnboardingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b410\b/.test(message) && /\b(expired|gone)\b/i.test(message);
}

type QrSetup = WeixinOnboardingStartResponse | QqbotOnboardingStartResponse;

interface QrOnboardingPanelProps {
  applyPlatform: "weixin" | "qqbot";
  onChanged: () => Promise<void>;
  onRestartNeeded: () => void;
  setRestartNeeded: (needed: boolean) => void;
  showToast: (message: string, type: "success" | "error") => void;
  hasSavedConfig?: boolean;
  configuredValue?: string;
  groupConfiguredValue?: string;
  /** Whether a home channel was already adopted via a previous QR pairing. */
  homeChannelSet?: boolean;
}

export function QrOnboardingPanel({
  applyPlatform,
  onChanged,
  onRestartNeeded,
  setRestartNeeded,
  showToast,
  hasSavedConfig,
  configuredValue,
  groupConfiguredValue,
  homeChannelSet,
}: QrOnboardingPanelProps) {
  const isWeixin = applyPlatform === "weixin";
  const dmPolicyOptions = isWeixin ? WEIXIN_DM_POLICY_OPTIONS : QQBOT_DM_POLICY_OPTIONS;
  const [setup, setSetup] = useState<QrSetup | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "starting" | "waiting" | "connected" | "applying"
  >("idle");
  const [dmPolicy, setDmPolicy] = useState(dmPolicyOptions[0].value);
  const [allowedUsers, setAllowedUsers] = useState("");
  const [groupPolicy, setGroupPolicy] = useState("disabled");
  const [groupAllowedUsers, setGroupAllowedUsers] = useState("");
  const [homeChannel, setHomeChannel] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!setup && phase === "idle" && configuredValue) {
      setDmPolicy(configuredValue);
    }
  }, [configuredValue, phase, setup]);

  useEffect(() => {
    if (!setup && phase === "idle") {
      const saved = groupConfiguredValue ?? "";
      setGroupPolicy(
        QQBOT_GROUP_POLICY_OPTIONS.some((opt) => opt.value === saved)
          ? saved
          : "disabled",
      );
    }
  }, [groupConfiguredValue, phase, setup]);

  // Secondary-edit backfill: a previously adopted home channel is re-checked
  // when the panel opens (before any new pairing starts). Unchecking it and
  // saving sends home_channel=false, which clears the persisted home.
  useEffect(() => {
    if (!setup && phase === "idle" && homeChannelSet) {
      setHomeChannel(true);
    }
  }, [homeChannelSet, phase, setup]);

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

  const getStatus = useCallback(
    (pairingId: string) =>
      isWeixin
        ? api.getWeixinOnboardingStatus(pairingId)
        : api.getQqbotOnboardingStatus(pairingId),
    [isWeixin],
  );

  useEffect(() => {
    if (!setup || phase !== "waiting") return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await getStatus(setup.pairing_id);
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
          setError(status.error || "Setup failed.");
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
        const expired = Number.isFinite(expiresAt) && Date.now() >= expiresAt;
        if (isTerminalQROnboardingError(pollError) || expired) {
          setSetup(null);
          setQrDataUrl("");
          setPhase("idle");
          setError("QR setup expired. Start a new setup to try again.");
          return;
        }
        setError(`Still waiting. Retrying: ${String(pollError)}`);
        timeout = setTimeout(poll, 2000);
      }
    };

    timeout = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [phase, setup, getStatus, updateQr]);

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
      const res = isWeixin
        ? await api.startWeixinOnboarding()
        : await api.startQqbotOnboarding();
      setSetup(res);
      if (res.qr_payload) {
        await updateQr(res.qr_payload);
      }
      if (res.status === "error") {
        setError(res.error || "Setup failed.");
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
        if (isWeixin) {
          await api.cancelWeixinOnboarding(setup.pairing_id);
        } else {
          await api.cancelQqbotOnboarding(setup.pairing_id);
        }
      } catch {
        // local cleanup still wins
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
      const body = {
        dm_policy: dmPolicy,
        allowed_users: allowedUsers,
        ...(isWeixin
          ? {}
          : { group_policy: groupPolicy, group_allowed_users: groupAllowedUsers }),
        home_channel: homeChannel,
      };
      const result = isWeixin
        ? await api.applyWeixinOnboarding(setup.pairing_id, body)
        : await api.applyQqbotOnboarding(setup.pairing_id, body);
      resetSetup();
      if (result.restart_started) {
        showToast(
          isWeixin ? "Weixin saved; gateway restarting…" : "QQ Bot saved; gateway restarting…",
          "success",
        );
        setRestartNeeded(false);
        setTimeout(() => void onChanged(), 4000);
        void watchRestartOutcome();
      } else {
        onRestartNeeded();
        const detail = result.restart_error ? `: ${result.restart_error}` : "";
        showToast(
          `${isWeixin ? "Weixin" : "QQ Bot"} saved; gateway restart failed${detail}`,
          "error",
        );
      }
      await onChanged();
    } catch (applyError) {
      setPhase("connected");
      setError(String(applyError));
    }
  };

  const expiresIn = useMemo(
    () => (setup ? formatExpiry(setup.expires_at) : ""),
    // tick keeps the memo fresh without recalculating on every render branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, tick],
  );
  const setupHelp =
    phase === "connected" || phase === "applying"
      ? `${isWeixin ? "Weixin" : "QQ Bot"} is linked but Hermes is not listening yet. Save and restart the gateway to finish setup.`
      : "Scan the QR code with your phone to begin setup.";
  const setupStatusLabel = setup?.status ?? "waiting";
  const pairingBusy = ["starting", "waiting", "applying"].includes(phase);

  return (
    <div className="rounded-sm border border-border bg-background/35 p-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="uppercase"
            onClick={() => void start()}
            disabled={pairingBusy}
            prefix={phase === "starting" ? <Spinner /> : <QrCode className="h-4 w-4" />}
          >
            {phase === "starting" ? "Starting…" : "Scan with QR"}
          </Button>
          {hasSavedConfig && (
            <span className="text-xs text-muted-foreground">
              Existing settings are configured.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid gap-1.5">
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              DM policy
            </span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={dmPolicy}
              onChange={(event) => setDmPolicy(event.target.value)}
              disabled={phase === "waiting" || phase === "applying"}
            >
              {dmPolicyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {(dmPolicy === "allowlist" || dmPolicy === "pairing") && (
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor={`${applyPlatform}-allowed-users`}>
                {isWeixin ? "Allowed user IDs" : "Allowed OpenIDs"}
              </Label>
              <Input
                id={`${applyPlatform}-allowed-users`}
                value={allowedUsers}
                onChange={(event) => setAllowedUsers(event.target.value)}
                disabled={phase === "waiting" || phase === "applying"}
                placeholder={
                  isWeixin
                    ? "comma-separated user IDs"
                    : "comma-separated OpenIDs"
                }
              />
            </div>
          )}
        </div>

        {!isWeixin && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="grid gap-1.5">
              <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Group policy
              </span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={groupPolicy}
                onChange={(event) => setGroupPolicy(event.target.value)}
                disabled={phase === "waiting" || phase === "applying"}
              >
                {QQBOT_GROUP_POLICY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {groupPolicy === "allowlist" && (
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Label htmlFor={`${applyPlatform}-group-allowed-users`}>
                  Allowed group OpenIDs
                </Label>
                <Input
                  id={`${applyPlatform}-group-allowed-users`}
                  value={groupAllowedUsers}
                  onChange={(event) => setGroupAllowedUsers(event.target.value)}
                  disabled={phase === "waiting" || phase === "applying"}
                  placeholder="comma-separated group OpenIDs"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            id={`${applyPlatform}-home-channel`}
            type="checkbox"
            checked={homeChannel}
            onChange={(event) => setHomeChannel(event.target.checked)}
            disabled={phase === "waiting" || phase === "applying"}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor={`${applyPlatform}-home-channel`} className="text-sm font-normal">
            Set as home channel
          </Label>
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
                  <Badge tone="success">Connected</Badge>
                ) : (
                  <Badge tone="warning">{setupStatusLabel}</Badge>
                )}
                <Badge tone={expiresIn === "expired" ? "destructive" : "outline"}>
                  {expiresIn}
                </Badge>
              </div>

              <div className="text-sm text-muted-foreground">{setupHelp}</div>

              {(phase === "connected" || phase === "applying") && (
                <div className="grid gap-3">
                  <div className="border border-border bg-background/45 p-3 text-sm">
                    <div className="font-medium">
                      {setup.account_id
                        ? `Linked as ${setup.account_id}`
                        : `${isWeixin ? "Weixin" : "QQ Bot"} account linked`}
                    </div>
                    {setup.user_id && (
                      <div className="mt-1 text-muted-foreground">
                        User ID: {setup.user_id}
                      </div>
                    )}
                    <div className="mt-3 text-muted-foreground">
                      Save and restart the gateway, then send Hermes a message from the
                      linked account.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="uppercase"
                      onClick={() => void apply()}
                      disabled={phase === "applying"}
                      prefix={phase === "applying" ? <Spinner /> : <Save className="h-4 w-4" />}
                    >
                      {phase === "applying" ? "Saving…" : "Save and restart"}
                    </Button>
                    <Button size="sm" ghost onClick={() => void cancel()}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center gap-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`${isWeixin ? "Weixin" : "QQ Bot"} setup QR code`}
                  className="h-60 w-60 bg-white p-2"
                />
              ) : phase === "connected" || phase === "applying" ? (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 border border-border bg-background/50 p-4 text-center">
                  <Badge tone="success">Linked</Badge>
                  <div className="text-sm text-muted-foreground">
                    {setup.account_id || "Existing account"}
                  </div>
                </div>
              ) : (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-3 border border-border bg-background/50 p-4 text-center">
                  <Spinner className="text-2xl" />
                  <div className="text-xs text-muted-foreground">
                    Waiting for a QR code…
                  </div>
                </div>
              )}
              {phase === "waiting" && (
                <span className="text-center text-xs text-muted-foreground">
                  Scan with {isWeixin ? "WeChat" : "QQ"} on your phone.
                </span>
              )}
              <Button size="sm" ghost onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
