import { useEffect, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nous-research/ui/ui/components/card";
import { Checkbox } from "@nous-research/ui/ui/components/checkbox";
import { Input } from "@nous-research/ui/ui/components/input";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Toast, useToast } from "@nous-research/ui";
import { api } from "@/lib/api";
import type { CustomEndpoint, CustomEndpointUpdate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  AlertCircle,
  Check,
  Globe,
  Loader2,
  Plus,
  Save,
  Trash2,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Mirror the backend `_custom_endpoint_id` slugifier so client-side guards
 *  stay in sync. Non-ASCII-only names collapse to the empty slug, which is
 *  treated as "missing id" and gated by the form. */
function slugifyId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const EMPTY_FORM: Omit<CustomEndpointUpdate, "name" | "base_url" | "model"> & {
  name: string;
  base_url: string;
  model: string;
} = {
  id: "",
  name: "",
  base_url: "",
  model: "",
  context_length: undefined,
  discover_models: true,
  make_default: true,
  api_key: undefined,
};

function formFromEndpoint(ep: CustomEndpoint) {
  return {
    id: ep.id,
    name: ep.name,
    base_url: ep.base_url,
    model: ep.model,
    context_length: ep.context_length ?? undefined,
    discover_models: ep.discover_models,
    make_default: Boolean(ep.is_current),
    api_key: "",
  };
}

function toPayload(form: typeof EMPTY_FORM, models?: string[]): CustomEndpointUpdate {
  const ctx = Number.parseInt(String(form.context_length ?? ""), 10);
  return {
    id: (form.id ?? "").trim() || undefined,
    name: form.name.trim(),
    base_url: form.base_url.trim().replace(/\/+$/, ""),
    model: form.model.trim(),
    context_length: Number.isFinite(ctx) && ctx > 0 ? ctx : undefined,
    discover_models: form.discover_models,
    make_default: form.make_default,
    api_key: (form.api_key ?? "").trim() || undefined,
    models: models?.length ? models : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export function CustomEndpointsPanel({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const { toast, showToast } = useToast();

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CustomEndpoint | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  async function refresh() {
    const data = await api.getCustomEndpoints();
    setEndpoints(data.endpoints);
    const current =
      data.endpoints.find((ep) => ep.is_current) ?? data.endpoints[0] ?? null;
    if (current) {
      setForm(formFromEndpoint(current));
      setDiscoveredModels(current.models);
    } else {
      setForm({ ...EMPTY_FORM });
      setDiscoveredModels([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getCustomEndpoints()
      .then((data) => {
        if (cancelled) return;
        setEndpoints(data.endpoints);
        const current =
          data.endpoints.find((ep) => ep.is_current) ?? data.endpoints[0] ?? null;
        if (current) {
          setForm(formFromEndpoint(current));
          setDiscoveredModels(current.models);
        } else {
          setDiscoveredModels([]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When name changes, auto-populate the Provider ID slot only if the user
  // hasn't explicitly typed one yet — mirrors desktop UX while giving power
  // users full control over the id.
  function onNameChange(next: string) {
    setForm((cur) => {
      if (cur.id) return { ...cur, name: next };
      const slug = slugifyId(next);
      return { ...cur, name: next, id: slug };
    });
  }

  function canSave() {
    const n = form.name.trim();
    const u = form.base_url.trim();
    const m = form.model.trim();
    if (!n || !u || !m) return false;
    // CJK-name gate: slugified id is empty (pure non-ASCII name without
    // explicit ASCII Provider ID) — backend would collapse to "custom" and
    // silently overwrite an existing provider. Block save and surface a hint.
    if (!slugifyId(form.id || n)) return false;
    // Id-unique-within-list gate: another endpoint already uses this id.
    const conflicts = endpoints.some(
      (ep) => ep.id === (form.id || slugifyId(n)) && ep.id !== form.id,
    );
    if (conflicts) return false;
    return true;
  }

  async function handleSave() {
    setFormError(null);
    const payload = toPayload(form, discoveredModels);
    if (!payload.name || !payload.base_url || !payload.model) return;
    if (!slugifyId(payload.id || payload.name)) {
      setFormError(t.customEndpoints.idRequiredHint);
      return;
    }
    const conflicts = endpoints.some(
      (ep) => ep.id === slugifyId(payload.id || payload.name) && ep.id !== payload.id,
    );
    if (conflicts) {
      setFormError(t.customEndpoints.idCollisionHint);
      return;
    }

    try {
      setSaving(true);
      const response = await api.saveCustomEndpoint(payload);
      setEndpoints(response.endpoints);
      const saved = response.endpoints.find((ep) => ep.id === (payload.id || slugifyId(payload.name)));
      if (saved) {
        setForm(formFromEndpoint(saved));
        setDiscoveredModels(saved.models);
        if (saved.is_current) {
          onChanged?.();
          showToast(t.customEndpoints.endpointSavedAndActivated, "success");
          return;
        }
      }
      onChanged?.();
      showToast(t.customEndpoints.endpointSaved, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setFormError(null);
    try {
      setTesting(true);
      const response = await api.validateCustomEndpoint(toPayload(form));
      setDiscoveredModels(response.models);
      if (response.ok) {
        if (!form.model && response.models.length > 0) {
          setForm((cur) => ({ ...cur, model: response.models[0] }));
        }
        const count = response.models.length;
        showToast(
          count > 0
            ? t.customEndpoints.endpointReachable.replace("{count}", String(count))
            : t.customEndpoints.endpointReached,
          "success",
        );
      } else {
        const msg = response.reachable
          ? t.customEndpoints.validationReachableMessage
          : t.customEndpoints.validationNoReachableMessage;
        showToast(msg, "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleActivate(endpoint: CustomEndpoint) {
    setFormError(null);
    try {
      setActivating(endpoint.id);
      await api.activateCustomEndpoint(endpoint.id);
      await refresh();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setActivating(null);
    }
  }

  function startDelete(endpoint: CustomEndpoint) {
    setDeleteTarget(endpoint);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      setDeleteLoading(true);
      await api.deleteCustomEndpoint(deleteTarget.id);
      await refresh();
      setDeleteTarget(null);
      showToast(t.customEndpoints.deleteEndpointSuccess, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setDiscoveredModels([]);
    setFormError(null);
  }

  const allModelOptions = Array.from(
    new Set([...discoveredModels, form.model].filter(Boolean)),
  );
  const canSaveActual = canSave();

  return (
    <>
      <Card className="min-w-0 max-w-full">
        <CardHeader className="min-w-0 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm">
              {t.customEndpoints.title}
            </CardTitle>
            <span className="max-w-full min-w-0 text-xs text-text-secondary [overflow-wrap:anywhere]">
              {t.customEndpoints.subtitle}
            </span>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-5 pt-4">
          {initialLoading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" /> loading…
            </div>
          ) : (
            <>
          <div className="space-y-2">
            {endpoints.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                {t.customEndpoints.noEndpointsDescription}
              </div>
            ) : (
              <div className="divide-y divide-border/40 rounded-md border border-border/50">
                {endpoints.map((ep) => (
                  <div
                    key={ep.id}
                    className={cn(
                      "grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                    )}
                  >
                    <button
                      className="min-w-0 text-left"
                      type="button"
                      onClick={() => {
                        setForm(formFromEndpoint(ep));
                        setDiscoveredModels(ep.models);
                        setFormError(null);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {ep.name}
                        </span>
                        {ep.is_current && (
                          <Badge tone="secondary">
                            <Check className="mr-1 h-3 w-3" />
                            {t.customEndpoints.active}
                          </Badge>
                        )}
                        {ep.source === "direct-config" && (
                          <Badge tone="outline">
                            {t.customEndpoints.directConfigSource}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[0.7rem] text-muted-foreground">
                        {ep.base_url}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{ep.model}</span>
                        {ep.has_api_key && (
                          <span>{t.customEndpoints.keySet}</span>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <Button
                        disabled={ep.is_current || activating === ep.id}
                        size="sm"
                        outlined
                        onClick={() => void handleActivate(ep)}
                      >
                        {activating === ep.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Zap className="h-3 w-3" />
                        )}
                        {t.customEndpoints.useAsDefault}
                      </Button>
                      {ep.source !== "direct-config" && (
                        <Button
                          className="hover:text-destructive"
                          disabled={deleteLoading}
                          size="icon"
                          ghost
                          title={t.customEndpoints.deleteEndpoint}
                          onClick={() => startDelete(ep)}
                        >
                          {deleteLoading && deleteTarget?.id === ep.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form */}
          <div className="space-y-3 rounded-md border border-border/50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4 text-muted-foreground" />
              {form.id ? t.customEndpoints.editEndpoint : t.customEndpoints.addEndpoint}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {t.customEndpoints.name}
                <Input
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder={t.customEndpoints.namePlaceholder}
                  value={form.name}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {t.customEndpoints.providerId}
                <Input
                  disabled={!!form.id && slugifyId(form.id) !== slugifyId(form.name)}
                  onChange={(e) =>
                    setForm((cur) => ({ ...cur, id: e.target.value }))
                  }
                  placeholder={t.customEndpoints.providerIdPlaceholder}
                  value={form.id}
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-xs text-muted-foreground">
              {t.customEndpoints.baseUrl}
              <Input
                onChange={(e) =>
                  setForm((cur) => ({ ...cur, base_url: e.target.value }))
                }
                placeholder={t.customEndpoints.baseUrlPlaceholder}
                value={form.base_url}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {t.customEndpoints.defaultModel}
                <Input
                  list="custom-endpoint-models"
                  onChange={(e) =>
                    setForm((cur) => ({ ...cur, model: e.target.value }))
                  }
                  placeholder={t.customEndpoints.defaultModelPlaceholder}
                  value={form.model}
                />
                <datalist id="custom-endpoint-models">
                  {allModelOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                {t.customEndpoints.contextLength}
                <Input
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, context_length: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder={t.customEndpoints.contextLengthPlaceholder}
                  value={form.context_length ?? ""}
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-xs text-muted-foreground">
              {t.customEndpoints.apiKey}
              <Input
                onChange={(e) =>
                  setForm((cur) => ({ ...cur, api_key: e.target.value }))
                }
                placeholder={
                  form.id
                    ? t.customEndpoints.apiKeyPlaceholderEdit
                    : t.customEndpoints.apiKeyPlaceholderNew
                }
                type="password"
                value={form.api_key ?? ""}
              />
            </label>

            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.make_default}
                  onCheckedChange={(v) =>
                    setForm((cur) => ({ ...cur, make_default: v === true }))
                  }
                />
                {t.customEndpoints.useForNewChats}
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.discover_models}
                  onCheckedChange={(v) =>
                    setForm((cur) => ({ ...cur, discover_models: v === true }))
                  }
                />
                {t.customEndpoints.discoverModels}
              </label>
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={testing || !form.base_url.trim()}
                outlined
                onClick={() => void handleValidate()}
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {t.customEndpoints.test}
              </Button>
              <Button
                disabled={!canSaveActual || saving}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                {t.customEndpoints.save}
              </Button>
              <Button
                className={cn(!form.id && "hidden")}
                ghost
                onClick={resetForm}
              >
                {t.customEndpoints.newEndpoint}
              </Button>
            </div>
          </div>
          </>
        )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        loading={deleteLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={deleteTarget
          ? t.customEndpoints.deleteEndpointConfirmTitle.replace(
              "{name}",
              deleteTarget.name,
            )
          : ""}
        description={t.customEndpoints.deleteEndpointConfirmDescription}
      />

      <Toast toast={toast} />
    </>
  );
}
