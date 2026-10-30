import { stringifyYaml } from 'obsidian';

export function serializeChatMarkdown(
  frontmatter: Readonly<Record<string, unknown>>,
  body: string,
): string {
  const yaml = typeof stringifyYaml === 'function'
    ? stringifyYaml(frontmatter).trimEnd()
    : Object.entries(frontmatter)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
  if (body === '') return `---\n${yaml}\n---\n`;
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  return `---\n${yaml}\n---\n${normalizedBody}`;
}
