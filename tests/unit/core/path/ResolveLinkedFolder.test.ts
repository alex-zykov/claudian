import { resolveLinkedFolder } from '@/core/path/ResolveLinkedFolder';

describe('resolveLinkedFolder', () => {
  const folders = new Set([
    'Projects',
    'Projects/A',
    'Projects/B',
    'Projects/B/notes',
  ]);
  const files = new Set([
    'Projects/A/x.md',
    'Projects/B/notes/y.md',
    'RootNote.md',
    'Assets/diagram.svg',
  ]);

  const isFolder = (path: string): boolean | undefined => {
    if (folders.has(path)) return true;
    if (files.has(path)) return false;
    return undefined;
  };

  it.each([
    {
      name: 'folder path resolves to itself',
      path: 'Projects/A',
      expected: 'Projects/A',
    },
    {
      name: 'nested file resolves to parent folder',
      path: 'Projects/B/notes/y.md',
      expected: 'Projects/B/notes',
    },
    {
      name: 'root file resolves to vault root',
      path: 'RootNote.md',
      expected: '',
    },
    {
      name: 'absent path yields vault root',
      path: undefined,
      expected: '',
    },
    {
      name: 'empty path yields vault root',
      path: '',
      expected: '',
    },
    {
      name: 'Windows separators normalize before resolving a file',
      path: 'Projects\\A\\x.md',
      expected: 'Projects/A',
    },
    {
      name: 'Windows separators normalize before resolving a folder',
      path: 'Projects\\B\\notes',
      expected: 'Projects/B/notes',
    },
    {
      name: 'legacy decoded note path resolves to parent',
      path: 'Projects/A/x.md',
      expected: 'Projects/A',
    },
    {
      name: 'missing target with extension is treated as a file',
      path: 'Gone/Old Plan.md',
      expected: 'Gone',
    },
    {
      name: 'missing target without extension is treated as a folder',
      path: 'Gone/Archive',
      expected: 'Gone/Archive',
    },
    {
      name: 'missing root-level file yields vault root',
      path: 'Missing.md',
      expected: '',
    },
    {
      name: 'non-markdown file resolves to parent',
      path: 'Assets/diagram.svg',
      expected: 'Assets',
    },
  ])('$name', ({ path, expected }) => {
    expect(resolveLinkedFolder(path, isFolder)).toBe(expected);
  });

  it('uses the isFolder port rather than guessing when the target exists', () => {
    // Extension-looking folder that the vault reports as a folder.
    expect(resolveLinkedFolder('Projects/v1.0', () => true)).toBe('Projects/v1.0');
    // Extension-less file that the vault reports as a file.
    expect(resolveLinkedFolder('Projects/Makefile', () => false)).toBe('Projects');
  });
});
