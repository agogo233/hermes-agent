// Locks the translated catalogs against drift: every English key must exist in
// zh with a matching value kind, and any value that still equals English must
// be an intentional keep (brand names, platform names, path/URL/expression
// placeholders, font family names, tier names). zh-hant is a known follow-up
// (S5): its missing keys are allowed, but its present keys must stay sound and
// it must not grow new values that duplicate English outside the keep list.
import { describe, expect, it } from "vitest";

import { en } from "./en";
import { zh } from "./zh";
import { zhHant } from "./zh-hant";

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ""): Leaf[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key),
    );
  }
  return [{ path, value }];
}

// Values that legitimately stay identical to English: brand/org names,
// platform names, file/path/URL/cron placeholders, font family names, and the
// achievement tier ladder (proper nouns). A translation of any of these is
// fine — it only has to be removed from this list, never added silently.
const KEEP_AS_ENGLISH = new Set([
  "app.brand",
  "app.brandShort",
  "app.footer.org",
  "customEndpoints.baseUrlPlaceholder",
  "customEndpoints.directConfigSource",
  "cron.schedulePlaceholder",
  "cron.scheduleModes.customPlaceholder",
  "cron.scheduleDescribe.none",
  "cron.delivery.telegram",
  "cron.delivery.discord",
  "cron.delivery.slack",
  "config.configPath",
  "config.categories.discord",
  "theme.fontSans",
  "theme.fontSerif",
  "theme.fontMono",
  "achievements.stats.highest_tier_hint",
]);

const englishLeaves = leaves(en);
const english = new Map(englishLeaves.map(({ path, value }) => [path, value]));

const kindOf = (value: unknown) => (Array.isArray(value) ? "array" : typeof value);

// `intro` is display-only copy rendered from intro-copy.jsonl; its catalog
// entry is an empty shell and is not part of the key contract.
const isTranslatable = (path: string) => !path.startsWith("intro.");

describe("web zh catalog", () => {
  const zhLeaves = new Map(leaves(zh).map(({ path, value }) => [path, value]));

  it("covers every English key", () => {
    const missing = [...english.keys()].filter((key) => !zhLeaves.has(key));
    expect(missing).toEqual([]);
  });

  it("keeps the same value kinds and function arity as English", () => {
    for (const [path, value] of english) {
      if (!zhLeaves.has(path) || !isTranslatable(path)) continue;
      const translated = zhLeaves.get(path);
      expect({ path, kind: kindOf(translated) }).toEqual({ path, kind: kindOf(value) });
      if (typeof value === "function" && typeof translated === "function") {
        expect(translated.length, `${path} drops interpolated arguments`).toBe(value.length);
      }
    }
  });

  it("keeps English values only for the intentional keep list", () => {
    for (const [path, value] of english) {
      if (!zhLeaves.has(path) || typeof value !== "string") continue;
      const translated = zhLeaves.get(path);
      if (typeof translated === "string" && translated === value) {
        expect(KEEP_AS_ENGLISH.has(path), `${path} equals English and is not whitelisted`).toBe(true);
      }
    }
  });
});

describe("web zh-hant catalog (follow-up: S5)", () => {
  const zhHantLeaves = new Map(leaves(zhHant).map(({ path, value }) => [path, value]));

  it("adds no key English does not have", () => {
    const extra = [...zhHantLeaves.keys()].filter((key) => !english.has(key));
    expect(extra).toEqual([]);
  });

  it("keeps the same value kinds as English for the keys it does translate", () => {
    for (const [path, value] of english) {
      if (!zhHantLeaves.has(path) || !isTranslatable(path)) continue;
      const translated = zhHantLeaves.get(path);
      expect({ path, kind: kindOf(translated) }).toEqual({ path, kind: kindOf(value) });
    }
  });
});
