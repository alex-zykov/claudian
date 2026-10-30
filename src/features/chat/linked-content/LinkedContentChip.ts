import type { ComposerInfoRow } from '@/features/chat/composer/ComposerInfoRow';
import type { LinkedContentPresentation } from '@/features/chat/linked-content/LinkedContentPresentation';

/** Presents Linked content in the composer info row, under the input box. */
export class LinkedContentChip {
  constructor(
    private readonly infoRow: ComposerInfoRow,
    private readonly onActivate: () => void,
    private readonly onRemove: () => void,
  ) {}

  render(content: LinkedContentPresentation | null, removable: boolean): void {
    if (!content) {
      this.infoRow.setLinkedContent(null);
      return;
    }
    const detail = folderDetail(content);
    const folderLabel = detail ? `. Folder: ${detail}` : '';
    this.infoRow.setLinkedContent({
      label: content.missing ? `${content.label} · Missing content` : content.label,
      ...(detail ? { detail } : {}),
      icon: content.icon,
      ariaLabel: content.missing
        ? `Linked content: ${content.path}. Missing content${folderLabel}`
        : `Linked content: ${content.path}${folderLabel}`,
      missing: content.missing,
      onActivate: this.onActivate,
      ...(removable ? { onRemove: this.onRemove } : {}),
    });
  }

  destroy(): void {
    this.infoRow.setLinkedContent(null);
  }
}

/** The project folder, unless the label already names it (a top-level folder). */
function folderDetail(content: LinkedContentPresentation): string | undefined {
  if (content.kind === 'folder' && !content.folder.includes('/')) return undefined;
  return content.folder || 'Vault root';
}
