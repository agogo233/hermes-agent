import { useCallback, useEffect, useState } from "react";
import { Globe, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import type { EnvVarInfo } from "@/lib/api";
import { Button } from "@nous-research/ui/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nous-research/ui/ui/components/card";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Toast, useToast } from "@nous-research/ui";
import { ProviderConfigDrawer } from "@/components/ProviderConfigDrawer";

type DrawerStatus =
  | { mode: "nothing" }
  | { mode: "new"; provider?: string; baseUrl?: string; model?: string };

interface ProviderRow {
  slug: string;
  label: string;
  hasKey: boolean;
  keyEnv: string;
  isCurrent: boolean;
  baseUrl: string;
}

export function ProviderEndpointsPanel({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [envVars, setEnvVars] = useState<Record<string, EnvVarInfo>>({});
  const [currentProvider, setCurrentProvider] = useState("");
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerStatus>({ mode: "nothing" });

  const refresh = useCallback(async () => {
    try {
      const [env, endpoints] = await Promise.all([
        api.getEnvVars(),
        api.getCustomEndpoints().catch(() => ({ endpoints: [], current: { base_url: "", model: "", provider: "" } })),
      ]);
      setEnvVars(env);
      setCurrentProvider((endpoints as { current: { provider: string } }).current.provider);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSaved = useCallback(() => {
    setDrawer({ mode: "nothing" });
    void refresh();
    onChanged?.();
  }, [onChanged, refresh]);

  // Built-in providers (those with a catalog-provided env key, excluding
  // messaging/tool credentials and any provider managed as a custom endpoint).
  const providerRows: ProviderRow[] = [];
  const seenSlugs = new Set<string>();
  for (const [envKey, info] of Object.entries(envVars)) {
    if (info.category !== "provider" || info.channel_managed) continue;
    const slug = (info.provider || envKey.replace(/_API_KEY$/, "").toLowerCase()).toLowerCase();
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    providerRows.push({
      slug,
      label: info.provider_label || slug,
      hasKey: info.is_set,
      keyEnv: envKey,
      isCurrent: currentProvider === slug,
      baseUrl: "",
    });
  }

  return (
    <>
      <Card className="min-w-0 max-w-full">
        <CardHeader className="min-w-0 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm">Built-in Providers</CardTitle>
            <span className="max-w-full min-w-0 text-xs text-text-secondary [overflow-wrap:anywhere]">
              Configure an API key / base URL for a known provider.
            </span>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 pt-3">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" /> loading…
            </div>
          ) : providerRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
              No known providers detected yet. Configure keys on the Keys page, or add a
              custom OpenAI-compatible endpoint above.
            </div>
          ) : (
            <div className="divide-y divide-border/40 rounded-md border border-border/50">
              {providerRows.map((row) => (
                <div
                  key={row.slug}
                  className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() =>
                      setDrawer({ mode: "new", provider: row.slug, baseUrl: row.baseUrl })
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{row.label}</span>
                      {row.isCurrent && <Badge tone="secondary">active</Badge>}
                      {row.hasKey ? (
                        <Badge tone="success">key set</Badge>
                      ) : (
                        <Badge tone="outline">no key</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.7rem] text-muted-foreground">
                      {row.keyEnv}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button
                      size="sm"
                      ghost
                      onClick={() =>
                        setDrawer({ mode: "new", provider: row.slug, baseUrl: row.baseUrl })
                      }
                      prefix={<Settings2 className="h-3 w-3" />}
                    >
                      Configure
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 text-xs text-text-tertiary">
            Keys live in <span className="font-mono">~/.hermes/.env</span>; base URL overrides
            go into <span className="font-mono">config.yaml</span>. Changes apply to new
            sessions.
          </div>
        </CardContent>
      </Card>

      <ProviderConfigDrawer
        status={drawer}
        onClose={() => setDrawer({ mode: "nothing" })}
        onSaved={handleSaved}
      />

      <Toast toast={toast} />
    </>
  );
}