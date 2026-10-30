/**
 * Derive the project folder for a conversation from its Linked content path.
 * Folder paths resolve to themselves; file paths to their parent; absent to vault root ('').
 * When the target is missing (`isFolder` returns undefined), a last-segment extension
 * treats the path as a file; otherwise as a folder.
 */
export function resolveLinkedFolder(
  path: string | undefined,
  isFolder: (path: string) => boolean | undefined,
): string {
  if (path === undefined || path.length === 0) return '';

  const normalized = normalizeVaultRelativePath(path);
  if (normalized.length === 0) return '';

  const folderish = isFolder(normalized);
  if (folderish === true) return normalized;
  if (folderish === false) return parentFolder(normalized);

  return hasFileExtension(normalized) ? parentFolder(normalized) : normalized;
}

function normalizeVaultRelativePath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    normalized.push(segment);
  }
  return normalized.join('/');
}

function parentFolder(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

function hasFileExtension(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // Require a non-empty name before the dot and a non-empty extension after it.
  return dot > 0 && dot < base.length - 1;
}
