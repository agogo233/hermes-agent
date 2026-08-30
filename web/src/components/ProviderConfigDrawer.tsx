import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Eye, EyeOff, Globe, Loader2, Save, X, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { CustomEndpoint, CustomEndpointUpdate, EnvVarInfo, ModelOptionProvider } from "@/lib/api";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Toast, useToast } from "@nous-research/ui";
import { cn, themedBody } from "@/lib/utils";
import { useModalBehavior } from "@/hooks/useModalBehavior";

function slugifyId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

interface ProviderConfigDrawerProps {
  status:
    | { mode: "nothing" }
    | { mode: "new"; provider?: string; baseUrl?: string; model?: string }
    | { mode: "edit"; endpoint: CustomEndpoint };
  onClose: () => void;
  onSaved: () => void;
}

export function ProviderConfigDrawer({ status, onClose, onSaved }: ProviderConfigDrawerProps) {
  const { toast, showToast } = useToast();
  const open = status.mode !== "nothing";
  const editingEndpoint = status.mode === "edit" ? status.endpoint : null;
  const initialProvider = status.mode === "new" ? status.provider : undefined;
  const initialBaseUrl = status.mode === "new" ? status.baseUrl : undefined;
  const initialModel = status.mode === "new" ? status.model : undefined;
  const [providers, setProviders] = useState<ModelOptionProvider[]>([]);
  const [envMap, setEnvMap] = useState<Record<string, EnvVarInfo>>({});
  const [loadingProviders, setLoadingProviders] = useState(false);

  // Form state
  const [provider, setProvider] = useState("");
  const [customProviderName, setCustomProviderName] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);

  // Test & save state
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; models: string[]; latency_ms?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  const modalRef = useModalBehavior({ open, onClose });

  // Track whether the drawer just opened (rather than providers having
  // finished loading mid-open), so the init effect below only runs on a
  // fresh open and never wipes user input when the provider catalog arrives.
  const [initNonce, setInitNonce] = useState(0);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setInitNonce((n) => n + 1);
    wasOpen.current = open;
  }, [open]);

  // Load providers + env on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProviders(true);
    Promise.all([
      api.getModelOptions().catch(() => ({ providers: [] })),
      api.getEnvVars().catch(() => ({})),
    ])
      .then(([modelOpts, envVars]) => {
        if (cancelled) return;
        const provs = modelOpts?.providers ?? [];
        setProviders(provs);
        setEnvMap(envVars);
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Initialize form from editingEndpoint or initial values. Keyed on
  // ``initNonce`` (which increments only when the drawer transitions to open)
  // so the catalog loading later never resets what the user typed.
  useEffect(() => {
    if (!open) return;
    if (editingEndpoint) {
      setProvider(editingEndpoint.id);
      setCustomProviderName(editingEndpoint.name);
      setIsCustom(true);
      setBaseUrl(editingEndpoint.base_url);
      setModel(editingEndpoint.model);
      setApiKey("");
      setMakeDefault(!!editingEndpoint.is_current);
      setTestResult(null);
      setError(null);
      setDiscoveredModels(editingEndpoint.models ?? []);
      return;
    }
    if (initialProvider) {
      // Opened from a built-in provider row — configure that known provider.
      setProvider(initialProvider);
      setCustomProviderName("");
      setIsCustom(false);
    } else {
      // Fresh custom endpoint.
      setProvider("");
      setCustomProviderName("");
      setIsCustom(true);
    }
    setBaseUrl(initialBaseUrl ?? "");
    setModel(initialModel ?? "");
    setApiKey("");
    setTestResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initNonce]);

  const effectiveProvider = isCustom ? (customProviderName.trim() || provider.trim()) : provider.trim();
  const effectiveSlug = slugifyId(effectiveProvider);

  const canSave = (() => {
    if (!effectiveProvider) return false;
    if (isCustom) {
      if (!effectiveProvider.trim() || !baseUrl.trim() || !model.trim()) return false;
      if (!effectiveSlug) return false;
    } else {
      // For built-in: at least provider + (apiKey or baseUrl or model) — allow key-only save
      if (!provider.trim()) return false;
      const hasSomething = apiKey.trim() || baseUrl.trim() || model.trim();
      if (!hasSomething) return false;
    }
    return true;
  })();

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    const targetBaseUrl = baseUrl.trim();
    const targetProvider = effectiveProvider;
    const targetKey = apiKey.trim();
    if (!targetBaseUrl) {
      setError("请先填写 API 地址（Base URL）。");
      return;
    }
    if (!targetProvider) {
      setError("请先选择或填写 Provider。");
      return;
    }
    setTesting(true);
    try {
      const data = await api.testProvider({
        provider: targetProvider,
        base_url: targetBaseUrl,
        api_key: targetKey,
        model: model.trim(),
      });
      setTestResult(data);
      if (data.models?.length) {
        setDiscoveredModels(data.models);
        if (!model.trim() && data.models.length > 0) {
          setModel(data.models[0]);
        }
      }
      if (data.ok) {
        showToast(`连接成功${data.latency_ms ? `（${data.latency_ms}ms）` : ""}${data.models?.length ? `，发现 ${data.models.length} 个模型` : ""}`, "success");
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e), models: [] });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    const targetProvider = effectiveProvider;
    const targetBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const targetKey = apiKey.trim();
    const targetModel = model.trim();

    if (!targetProvider) {
      setError("请填写 Provider 名称。");
      return;
    }

    setSaving(true);
    try {
      if (isCustom || editingEndpoint) {
        // Custom endpoint path — single atomic call
        const payload: CustomEndpointUpdate = {
          id: effectiveSlug,
          name: customProviderName.trim() || targetProvider,
          base_url: targetBaseUrl,
          model: targetModel,
          api_key: targetKey || undefined,
          make_default: makeDefault,
          discover_models: true,
          models: discoveredModels.length ? discoveredModels : undefined,
        };
        if (!payload.base_url || !payload.model) {
          setError("自定义 Provider 需填写 Base URL 和默认模型。");
          setSaving(false);
          return;
        }
        await api.saveCustomEndpoint(payload);
        showToast(editingEndpoint ? "自定义端点已更新" : "自定义端点已保存", "success");
        // Also handle credential_pool hint — informing user
        onSaved();
        onClose();
        return;
      }

      // Built-in provider path — save the key to .env, then hand the main
      // model switch (if any) to the dedicated setModelAssignment endpoint
      // (which validates the model, applies base_url, and reports aux/cron
      // impact) and only touch config.yaml for a bare base_url override.

      // Step 1: save API key via .env if provided. Resolve the env var name
      // from the loaded /api/env catalog, then fall back to convention.
      let envVarName: string | null = null;
      const lowerProvider = targetProvider.toLowerCase();
      for (const [k, v] of Object.entries(envMap)) {
        const matched =
          (v.provider && v.provider.toLowerCase() === lowerProvider) ||
          (v.provider_label && v.provider_label.toLowerCase() === lowerProvider);
        if (matched && k.toUpperCase().endsWith("_API_KEY")) {
          envVarName = k;
          break;
        }
      }
      if (!envVarName) {
        // Special-case well-known providers whose key env var doesn't follow
        // the <PROVIDER>_API_KEY convention.
        const special: Record<string, string> = {
          "openai": "OPENAI_API_KEY",
          "anthropic": "ANTHROPIC_API_KEY",
          "gemini": "GEMINI_API_KEY",
          "deepseek": "DEEPSEEK_API_KEY",
          "openrouter": "OPENROUTER_API_KEY",
          "gmi": "GMI_API_KEY",
          "xai": "XAI_API_KEY",
          "zai": "ZAI_API_KEY",
          "kimi": "KIMI_API_KEY",
          "minimax": "MINIMAX_API_KEY",
        };
        envVarName =
          special[lowerProvider] ??
          `${lowerProvider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
      }

      let envSaved = false;
      if (targetKey) {
        await api.setEnvVar(envVarName, targetKey);
        envSaved = true;
      }

      // Step 2: main model switch via the dedicated endpoint.
      if (targetModel && makeDefault) {
        try {
          await api.setModelAssignment({
            scope: "main",
            provider: targetProvider,
            model: targetModel,
            base_url: targetBaseUrl || undefined,
          });
        } catch (e) {
          // If the config write already landed and only the validation call
          // failed, tell the user the key may be saved but the model switch
          // needs a retry.
          if (envSaved) {
            showToast(
              `API Key 已保存，但模型切换失败：${e instanceof Error ? e.message : String(e)}。请重试保存。`,
              "error",
            );
          }
          throw e;
        }
      } else if (targetBaseUrl) {
        // Step 3: bare base_url override (no model switch) → providers.<slug>.
        try {
          const cfg = await api.getConfig();
          const providersCfg = (cfg.providers as Record<string, unknown> | undefined) ?? {};
          const slugKey = lowerProvider;
          const existing =
            (providersCfg[slugKey] as Record<string, unknown> | undefined) ??
            (providersCfg[targetProvider] as Record<string, unknown> | undefined) ??
            {};
          const storeKey =
            providersCfg[slugKey] !== undefined
              ? slugKey
              : providersCfg[targetProvider] !== undefined
                ? targetProvider
                : slugKey;
          await api.saveConfig({
            providers: { ...providersCfg, [storeKey]: { ...existing, base_url: targetBaseUrl } },
          });
        } catch (e) {
          if (envSaved) {
            showToast(
              `API Key 已保存，但地址配置失败：${e instanceof Error ? e.message : String(e)}。请重试保存。`,
              "error",
            );
          }
          throw e;
        }
      }

      showToast("配置已保存，新会话生效", "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-drawer-title"
    >
      <div className={cn(themedBody, "relative w-full max-w-xl max-h-[90vh] flex flex-col border border-border bg-card shadow-2xl overflow-hidden")}>
        <Button ghost size="icon" onClick={onClose} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </Button>

        <header className="p-5 pb-3 border-b border-border">
          <h2 id="provider-drawer-title" className="font-mondwest text-display text-base tracking-wider flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            {editingEndpoint ? "编辑自定义端点" : "配置模型 API"}
          </h2>
          <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
            在此配置模型的 API 地址与 Key，保存后新会话生效，已有会话需 <span className="font-mono">/new</span> 重开。Key 仅存于 <span className="font-mono">~/.hermes/.env</span>，地址存于 <span className="font-mono">config.yaml</span>。
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Provider selector */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Provider</Label>
            {editingEndpoint ? (
              <div className="flex items-center gap-2 border border-border bg-muted/30 px-3 py-2 text-sm font-mono">
                {editingEndpoint.id} <span className="text-xs text-text-tertiary">（自定义端点 ID 不可改）</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="flex-1 border border-border bg-background px-3 py-2 text-sm"
                  value={isCustom ? "__custom__" : provider}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") {
                      setIsCustom(true);
                      setProvider("");
                    } else {
                      setIsCustom(false);
                      setProvider(v);
                    }
                    setTestResult(null);
                    setError(null);
                  }}
                >
                  <option value="">— 选择 Provider —</option>
                  {providers.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} {p.slug !== p.name ? `(${p.slug})` : ""} {p.is_current ? "· 当前" : ""}
                    </option>
                  ))}
                  <option value="__custom__">自定义（兼容 OpenAI 的地址）</option>
                </select>
              </div>
            )}
            {isCustom && !editingEndpoint && (
              <Input
                placeholder="自定义 Provider 名称，如 my-llm"
                value={customProviderName}
                onChange={(e) => setCustomProviderName(e.target.value)}
                className="font-mono text-sm"
              />
            )}
            {loadingProviders && <span className="text-xs text-text-tertiary flex items-center gap-1"><Spinner className="h-3 w-3" /> 加载 Provider 列表…</span>}
          </div>

          {/* Base URL */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">API 地址（Base URL）</Label>
            <Input
              placeholder="https://api.openai.com/v1  或  http://localhost:8000/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <span className="text-xs text-text-tertiary">
              {isCustom ? "必填，指向 OpenAI 兼容的 /v1 接口前缀（不含 /models）。" : "可选，留空使用 Provider 默认地址；填写则覆盖。"}
            </span>
          </div>

          {/* API Key */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder={isCustom ? "sk-..." : "留空则不修改已保存的 Key"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono text-sm pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showKey ? "隐藏" : "显示"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <span className="text-xs text-text-tertiary">Key 仅写入 .env（0600 权限），前端不回显明文，日志已脱敏。</span>
          </div>

          {/* Model */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">默认模型 {isCustom && <span className="text-destructive">*</span>}</Label>
            <Input
              list="provider-drawer-models"
              placeholder={isCustom ? "如 gpt-4o 或 deepseek-chat" : "如 gpt-4o，留空则不切换主模型"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono text-sm"
            />
            <datalist id="provider-drawer-models">
              {discoveredModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {discoveredModels.length > 0 && <span className="text-xs text-text-tertiary">已发现 {discoveredModels.length} 个模型，可直接选择。</span>}
          </div>

          {/* Make default checkbox */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="rounded border-border" />
            <span className="text-xs">保存后设为新会话的主模型</span>
          </label>

          {/* Credential pool hint */}
          {provider && !isCustom && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              若该 Provider 已配置轮询池（auth.json），单 Key 仅作备用，运行时优先走池。需改池请用 <span className="font-mono">hermes auth</span>。
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", testResult.ok ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200" : "border-destructive/30 bg-destructive/10 text-destructive")}>
              {testResult.ok ? <Check className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div>{testResult.ok ? `连接成功${testResult.latency_ms ? ` · ${testResult.latency_ms}ms` : ""}` : testResult.message}</div>
                {testResult.models?.length ? <div className="mt-1 text-xs opacity-80 truncate">模型示例：{testResult.models.slice(0, 5).join(", ")}{testResult.models.length > 5 ? ` …（共 ${testResult.models.length}）` : ""}</div> : null}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive border border-destructive/20 bg-destructive/10 px-3 py-2 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="text-xs text-text-tertiary border-t border-border/30 pt-3 leading-relaxed">
            提示：切换主模型会重置 Prompt Cache，前缀需重发一次；已有会话不受影响，需 <span className="font-mono">/new</span> 后生效。
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border p-4 bg-muted/20">
          <Button outlined onClick={handleTest} disabled={testing || !baseUrl.trim()} className="gap-1.5">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            测试连接
          </Button>
          <div className="flex gap-2">
            <Button ghost onClick={onClose} disabled={saving}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={!canSave || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </Button>
          </div>
        </footer>
      </div>
      <Toast toast={toast} />
    </div>,
    document.body,
  );
}
