// Model selection helpers (no server-only imports, so unit tests can load them).

export interface ListedModel {
  name: string;
  supportedGenerationMethods?: string[];
}

/**
 * Pick text models from the API's model list, best first: Flash before
 * Flash-Lite/Pro, newest version first, stable before preview/experimental.
 * Exported for unit tests.
 */
export function rankModels(models: ListedModel[]): string[] {
  const version = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini-/.test(id) && /flash/.test(id) && !/(image|tts|audio|live|embedding|vision|robotics|computer-use)/.test(id))
    .sort((a, b) => {
      const score = (id: string) => (/lite/.test(id) ? 1 : 0) + (/(preview|exp)/.test(id) ? 2 : 0);
      return score(a) - score(b) || version(b) - version(a) || a.localeCompare(b);
    });
}

