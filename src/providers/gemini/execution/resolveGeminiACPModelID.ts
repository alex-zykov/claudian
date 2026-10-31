/**
 * Map a Claudian/CLI Gemini (`agy`) model id onto an ACP `session/set_model` id.
 */
export function resolveGeminiACPModelID(
  selectedModelId: string,
  availableAcpModelIds: readonly string[],
  reasoningEffort?: string | null,
): string | null {
  const selected = selectedModelId.trim();
  if (!selected) return null;

  const effort = reasoningEffort?.trim().toLowerCase() || '';
  const available = availableAcpModelIds.map(id => id.trim()).filter(Boolean);
  if (available.length === 0) {
    return effort && !/-(low|medium|high|max)$/i.test(selected)
      ? `${selected}-${effort}`
      : selected;
  }

  if (effort) {
    const withEffort = `${selected}-${effort}`;
    if (available.includes(withEffort)) return withEffort;
  }

  if (available.includes(selected)) return selected;

  for (const fallbackEffort of ['high', 'medium', 'low', 'max']) {
    const candidate = `${selected}-${fallbackEffort}`;
    if (available.includes(candidate)) return candidate;
  }

  for (const alias of expandGeminiModelAliases(selected)) {
    if (available.includes(alias)) return alias;
    const prefixed = available.find(id => id.startsWith(`${alias}[`));
    if (prefixed) return prefixed;
  }

  return null;
}

function expandGeminiModelAliases(selected: string): string[] {
  const aliases = [selected];
  if (selected === 'auto' || selected === 'default') {
    aliases.push(
      'gemini-4-argon-high',
      'gemini-4-argon',
      'auto-gemini-3',
      'auto-gemini-2.5',
      'default[]',
      'auto',
      'default',
    );
  }
  return aliases;
}
