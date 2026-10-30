import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { resolveLinkedFolder } from '@/core/path/ResolveLinkedFolder';

export type LinkedContentKind = 'file' | 'folder' | 'missing';

export interface LinkedContentPresentation {
  readonly path: string;
  readonly kind: LinkedContentKind;
  readonly label: string;
  /** Project folder: the folder itself, a file's parent, or '' for the vault root. */
  readonly folder: string;
  readonly icon: string;
  readonly missing: boolean;
  readonly target: TAbstractFile | null;
}

/** Vault-backed port for {@link resolveLinkedFolder}: true/false when present, undefined when missing. */
export function createVaultLinkedContentIsFolder(
  app: App,
): (path: string) => boolean | undefined {
  return (path: string): boolean | undefined => {
    const target = app.vault.getAbstractFileByPath(path);
    if (target instanceof TFolder) return true;
    if (target instanceof TFile) return false;
    return undefined;
  };
}

function finalPathSegment(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

function fileLabel(file: TFile): string {
  return file.extension.toLocaleLowerCase() === 'md' ? file.basename : file.name;
}

export function deriveLinkedContentPresentation(
  app: App,
  path: string,
): LinkedContentPresentation {
  const target = app.vault.getAbstractFileByPath(path);
  const folder = resolveLinkedFolder(path, createVaultLinkedContentIsFolder(app));
  if (target instanceof TFile) {
    return {
      path,
      folder,
      kind: 'file',
      label: fileLabel(target),
      icon: target.extension.toLocaleLowerCase() === 'md' ? 'file-text' : 'file',
      missing: false,
      target,
    };
  }
  if (target instanceof TFolder) {
    return {
      path,
      folder,
      kind: 'folder',
      label: target.name,
      icon: 'folder',
      missing: false,
      target,
    };
  }
  return {
    path,
    folder,
    kind: 'missing',
    label: finalPathSegment(path),
    icon: 'file-question',
    missing: true,
    target: null,
  };
}
