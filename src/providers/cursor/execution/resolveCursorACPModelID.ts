/**
 * Map a Claudian/CLI Cursor model id onto an ACP `session/set_model` id.
 *
 * `agent --list-models` uses ids like `auto` / `composer-2.5`.
 * ACP `session/new` advertises `default[]` / `composer-2.5[fast=true]`.
 * Sending the CLI form yields JSON-RPC `-32602 Invalid params`.
 */
export function resolveCursorACPModelID(
  selectedModelId: string,
  availableAcpModelIds: readonly string[],
): string | null {
  const selected = selectedModelId.trim();
  if (!selected || availableAcpModelIds.length === 0) return null;

  const available = availableAcpModelIds.map(id => id.trim()).filter(Boolean);
  if (available.includes(selected)) return selected;

  for (const alias of expandCursorModelAliases(selected)) {
    if (available.includes(alias)) return alias;
    const prefixed = available.find(id => id.startsWith(`${alias}[`));
    if (prefixed) return prefixed;
  }

  return null;
}

function expandCursorModelAliases(selected: string): string[] {
  const aliases = [selected];
  if (selected === 'auto' || selected === 'default') {
    aliases.push('default[]', 'auto', 'default');
  }
  if (selected.endsWith('-fast')) {
    const base = selected.slice(0, -'-fast'.length);
    if (base) aliases.push(base);
  }
  return aliases;
}
