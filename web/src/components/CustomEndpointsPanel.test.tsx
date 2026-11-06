// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomEndpointsPanel } from "./CustomEndpointsPanel";

const apiMocks = vi.hoisted(() => ({
  activateCustomEndpoint: vi.fn(),
  deleteCustomEndpoint: vi.fn(),
  getCustomEndpoints: vi.fn(),
  saveCustomEndpoint: vi.fn(),
  validateCustomEndpoint: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMocks,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: {
      customEndpoints: {
        title: "Custom Endpoints",
        subtitle: "OpenAI-compatible API endpoints",
        addEndpoint: "Add Endpoint",
        editEndpoint: "Edit Endpoint",
        noEndpointsDescription: "Add an OpenAI-compatible endpoint below.",
        name: "Name",
        namePlaceholder: "e.g. Axet Proxy",
        providerId: "Provider ID",
        providerIdPlaceholder: "e.g. axet-proxy",
        baseUrl: "Endpoint URL",
        baseUrlPlaceholder: "http://127.0.0.1:8081/v1",
        defaultModel: "Default Model",
        defaultModelPlaceholder: "e.g. gpt-5.4",
        contextLength: "Context",
        contextLengthPlaceholder: "Auto",
        apiKey: "API Key",
        apiKeyPlaceholderEdit: "Leave blank to keep current key",
        apiKeyPlaceholderNew: "Optional",
        useForNewChats: "Use for new chats",
        discoverModels: "Discover models",
        test: "Test",
        save: "Save",
        newEndpoint: "New endpoint",
        active: "Active",
        directConfigSource: "config.yaml",
        keySet: "API key set",
        endpointSaved: "Custom endpoint saved.",
        endpointSavedAndActivated: "Custom endpoint saved and activated.",
        validationFailed: "Validation failed",
        endpointReached: "Endpoint is reachable.",
        endpointReachable: "Endpoint is reachable. Found {count} models.",
        validationReachableMessage: "Endpoint is reachable.",
        validationNoReachableMessage: "Could not reach the endpoint.",
        deleteEndpoint: "Delete endpoint",
        deleteEndpointConfirmTitle: "Delete {name}?",
        deleteEndpointConfirmDescription: "This removes the endpoint from configuration. This cannot be undone.",
        deleteEndpointSuccess: "Endpoint deleted.",
        idCollisionHint: "Provider ID must be unique across endpoints",
        idRequiredHint: "Enter an ASCII Provider ID",
        useAsDefault: "Use",
      },
    },
  }),
}));

// Mock node modules the panel imports from @nous-research/ui to avoid loading
// the full UI package in unit tests.
vi.mock("@nous-research/ui", () => ({
  Toast: () => null,
  useToast: () => ({ toast: [], showToast: vi.fn() }),
}));
vi.mock("@nous-research/ui/ui/components/button", () => ({
  Button: ({
    children,
    ...rest
  }: React.ComponentProps<"button"> & { className?: string }) => (
    <button {...rest}>{children}</button>
  ),
}));
vi.mock("@nous-research/ui/ui/components/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@nous-research/ui/ui/components/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
  }) => (
    <input
      data-testid="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      type="checkbox"
    />
  ),
}));
vi.mock("@nous-research/ui/ui/components/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} data-testid="input" />,
}));
vi.mock("@nous-research/ui/ui/components/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
}));
vi.mock("@nous-research/ui/ui/components/spinner", () => ({
  Spinner: () => <span data-testid="spinner" />,
}));
vi.mock("@/components/DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: ({
    open,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="delete-confirm-dialog">
        <button onClick={onCancel}>Cancel</button>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}));

let container: HTMLDivElement;
let root: Root;

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
  return container;
}

async function cleanup() {
  await act(async () => {
    root.unmount();
    container.remove();
  });
}

beforeEach(() => {
  apiMocks.getCustomEndpoints.mockReset();
  apiMocks.saveCustomEndpoint.mockReset();
  apiMocks.validateCustomEndpoint.mockReset();
  apiMocks.activateCustomEndpoint.mockReset();
  apiMocks.deleteCustomEndpoint.mockReset();
  apiMocks.getCustomEndpoints.mockResolvedValue({
    current: { provider: "", model: "", base_url: "" },
    endpoints: [],
  });
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

describe("CustomEndpointsPanel", () => {
  it("renders a loading spinner until the initial fetch resolves", async () => {
    let resolve: (v: unknown) => void;
    const promise = new Promise((res) => { resolve = res; });
    apiMocks.getCustomEndpoints.mockReturnValue(promise as ReturnType<typeof apiMocks.getCustomEndpoints>);

    await render(<CustomEndpointsPanel />);
    expect(container.querySelector("[data-testid='spinner']")).not.toBeNull();

    await act(async () => {
      resolve!({
        current: { provider: "", model: "", base_url: "" },
        endpoints: [],
      });
    });
    expect(container.querySelector("[data-testid='spinner']")).toBeNull();
  });

  it("renders the endpoint list and populates the form from the current row", async () => {
    apiMocks.getCustomEndpoints.mockResolvedValue({
      current: { provider: "my-proxy", model: "gpt-5", base_url: "http://127.0.0.1:8081/v1" },
      endpoints: [
        {
          id: "my-proxy",
          name: "My Proxy",
          base_url: "http://127.0.0.1:8081/v1",
          model: "gpt-5",
          models: ["gpt-5"],
          has_api_key: false,
          discover_models: true,
          is_current: true,
          source: "providers",
        },
      ],
    });

    await render(<CustomEndpointsPanel />);

    // The first visible input after mount should be the Name field, already
    // populated from the current endpoint.
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[data-testid="input"]'),
    );
    expect(inputs.length).toBeGreaterThanOrEqual(6);
    // inputs[0] = name, inputs[1] = id, inputs[2] = base_url
    expect(inputs[0].value).toBe("My Proxy");
    expect(inputs[2].value).toBe("http://127.0.0.1:8081/v1");

    // Active badge should be visible inside the panel.
    expect(container.querySelector("[data-testid='badge']")).not.toBeNull();
  });

  it("calls activateCustomEndpoint when clicking Use and invokes onChanged", async () => {
    apiMocks.getCustomEndpoints.mockResolvedValue({
      current: { provider: "", model: "", base_url: "" },
      endpoints: [
        {
          id: "proxy-1",
          name: "Proxy 1",
          base_url: "http://127.0.0.1:8081/v1",
          model: "gpt-4",
          models: [],
          has_api_key: false,
          discover_models: true,
          is_current: false,
          source: "providers",
        },
      ],
    });
    apiMocks.activateCustomEndpoint.mockResolvedValue({ ok: true, provider: "proxy-1", model: "gpt-4" });

    const onChanged = vi.fn();
    await render(<CustomEndpointsPanel onChanged={onChanged} />);

    const useBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Use",
    );
    expect(useBtn).toBeTruthy();
    await act(async () => useBtn!.click());

    expect(apiMocks.activateCustomEndpoint).toHaveBeenCalledWith("proxy-1");
    expect(onChanged).toHaveBeenCalled();
  });

  it("calls saveCustomEndpoint with the correct payload and refreshes", async () => {
    // Provide an initial endpoint so the form is pre-populated and canSave is true.
    apiMocks.getCustomEndpoints.mockResolvedValue({
      current: { provider: "", model: "", base_url: "" },
      endpoints: [
        {
          id: "axet-proxy",
          name: "Axet Proxy",
          base_url: "http://127.0.0.1:8081/v1",
          model: "gpt-5.4",
          models: [],
          has_api_key: false,
          discover_models: true,
          is_current: false,
          source: "providers",
        },
      ],
    });
    apiMocks.saveCustomEndpoint.mockResolvedValue({
      ok: true,
      id: "axet-proxy",
      endpoints: [
        {
          id: "axet-proxy",
          name: "Axet Proxy",
          base_url: "http://127.0.0.1:8081/v1",
          model: "gpt-5.4",
          models: [],
          has_api_key: false,
          discover_models: true,
          is_current: false,
          source: "providers",
        },
      ],
    });

    await render(<CustomEndpointsPanel />);

    const saveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Save",
    );
    expect(saveBtn).toBeTruthy();
    // The pre-populated form should already satisfy canSave.
    expect(saveBtn!.disabled).toBe(false);

    await act(async () => saveBtn!.click());

    expect(apiMocks.saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Axet Proxy",
        base_url: "http://127.0.0.1:8081/v1",
        model: "gpt-5.4",
        discover_models: true,
      }),
    );
  });

  it("blocks save when the Provider ID slug would be empty (pure CJK name)", async () => {
    apiMocks.getCustomEndpoints.mockResolvedValue({
      current: { provider: "", model: "", base_url: "" },
      endpoints: [],
    });

    await render(<CustomEndpointsPanel />);

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[data-testid="input"]'),
    );
    expect(inputs.length).toBeGreaterThanOrEqual(6);

    await act(async () => {
      inputs[0].value = "中文代理";
      inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Save",
    );
    // When slugified id is empty, Save should be disabled.
    expect(saveBtn?.disabled).toBe(true);
  });

  it("calls validateCustomEndpoint and populates the model datalist", async () => {
    // Pre-populate so the Test button is enabled (base_url is non-empty).
    apiMocks.getCustomEndpoints.mockResolvedValue({
      current: { provider: "", model: "", base_url: "" },
      endpoints: [
        {
          id: "px",
          name: "Px",
          base_url: "http://127.0.0.1:8081/v1",
          model: "gpt-4",
          models: [],
          has_api_key: false,
          discover_models: true,
          is_current: false,
          source: "providers",
        },
      ],
    });
    apiMocks.validateCustomEndpoint.mockResolvedValue({
      ok: true,
      reachable: true,
      models: ["gpt-4", "gpt-5"],
      message: "",
    });

    await render(<CustomEndpointsPanel />);

    const testBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Test",
    );
    expect(testBtn).toBeTruthy();
    // The pre-populated base_url should make the Test button enabled.
    expect(testBtn!.disabled).toBe(false);
    await act(async () => testBtn!.click());

    expect(apiMocks.validateCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ base_url: "http://127.0.0.1:8081/v1" }),
    );

    // Discovered models should populate the datalist.
    const datalist = container.querySelector<HTMLDListElement>("datalist#custom-endpoint-models");
    expect(datalist).toBeTruthy();
    expect(datalist!.querySelectorAll("option").length).toBeGreaterThan(0);
  });
});
