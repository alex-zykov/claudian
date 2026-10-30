/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import { fireEvent } from '@testing-library/dom';

import {
  ChatViewHeader,
  folderSegments,
  renderFolderBreadcrumbs,
  resolveViewSide,
} from '@/features/chat/workspace/ChatViewHeader';

describe('folderSegments', () => {
  it.each([
    ['', []],
    ['Projects', ['Projects']],
    ['Projects/A/B', ['Projects', 'A', 'B']],
  ])('splits %j into %j', (folder, expected) => {
    expect(folderSegments(folder)).toEqual(expected);
  });
});

describe('renderFolderBreadcrumbs', () => {
  function render(folder: string, onSelect = jest.fn()) {
    const parentEl = document.createElement('div');
    renderFolderBreadcrumbs(parentEl, folder, onSelect);
    return { parentEl, onSelect };
  }

  it('leaves the header empty for the vault root', () => {
    const { parentEl } = render('');

    expect(parentEl.childElementCount).toBe(0);
  });

  it('renders one crumb per folder, each followed by a separator', () => {
    const { parentEl } = render('Projects/A');

    expect([...parentEl.children].map(el => el.className)).toEqual([
      'view-header-breadcrumb',
      'view-header-breadcrumb-separator',
      'view-header-breadcrumb',
      'view-header-breadcrumb-separator',
    ]);
    expect([...parentEl.querySelectorAll('.view-header-breadcrumb')].map(el => el.textContent))
      .toEqual(['Projects', 'A']);
    expect(parentEl.querySelector('.view-header-breadcrumb-separator')?.textContent).toBe('/');
  });

  it('selects the folder path up to the clicked crumb', () => {
    const { parentEl, onSelect } = render('Projects/A/B');

    fireEvent.click(parentEl.querySelectorAll('.view-header-breadcrumb')[1]);

    expect(onSelect).toHaveBeenCalledWith('Projects/A');
  });

  it('replaces crumbs rendered earlier', () => {
    const parentEl = document.createElement('div');
    renderFolderBreadcrumbs(parentEl, 'Old/Path', jest.fn());

    renderFolderBreadcrumbs(parentEl, 'New', jest.fn());

    expect([...parentEl.querySelectorAll('.view-header-breadcrumb')].map(el => el.textContent))
      .toEqual(['New']);
  });
});

describe('resolveViewSide', () => {
  const left = {};
  const right = {};
  const main = {};
  const workspace = { leftSplit: left, rightSplit: right };

  it.each([
    [left, 'left'],
    [right, 'right'],
    [main, 'main'],
  ] as const)('places a leaf under that root in %#: %s', (root, expected) => {
    expect(resolveViewSide({ getRoot: () => root }, workspace)).toBe(expected);
  });
});

describe('ChatViewHeader', () => {
  function setup(overrides: Partial<ConstructorParameters<typeof ChatViewHeader>[0]> = {}) {
    const titleParentEl = document.createElement('div');
    const titleEl = document.createElement('div');
    let folder = 'Projects/A';
    let side: 'left' | 'right' | 'main' = 'main';
    let hasFile = true;
    const actions = new Map<string, HTMLElement>();
    const addAction = jest.fn((icon: string, _title: string, onClick: () => void) => {
      const el = document.createElement('div');
      el.addEventListener('click', onClick);
      actions.set(icon, el);
      return el;
    });
    const deps = {
      titleParentEl,
      titleEl,
      addAction,
      labels: { moveToLeft: 'Move to left panel', moveToRight: 'Move to right panel', editNote: 'Edit note' },
      getFolder: () => folder,
      getTitle: () => 'Plan review',
      getSide: () => side,
      revealFolder: jest.fn(),
      moveToSide: jest.fn(async () => true),
      onMoveRefused: jest.fn(),
      hasChatFile: () => hasFile,
      openChatFile: jest.fn(async () => true),
      onEditRefused: jest.fn(),
      ...overrides,
    };
    const header = new ChatViewHeader(deps);
    return {
      header,
      addAction,
      deps,
      titleParentEl,
      titleEl,
      actions,
      setFolder: (value: string) => { folder = value; },
      setSide: (value: typeof side) => { side = value; },
      setHasFile: (value: boolean) => { hasFile = value; },
    };
  }

  it('shows the folder as breadcrumbs and the chat title next to them', () => {
    const { header, titleParentEl, titleEl } = setup();

    header.refresh();

    expect([...titleParentEl.querySelectorAll('.view-header-breadcrumb')].map(el => el.textContent))
      .toEqual(['Projects', 'A']);
    expect(titleEl.textContent).toBe('Plan review');
  });

  it('follows the folder when it changes', () => {
    const { header, titleParentEl, setFolder } = setup();
    header.refresh();

    setFolder('');
    header.refresh();

    expect(titleParentEl.childElementCount).toBe(0);
  });

  it('reveals the clicked folder in the file explorer', () => {
    const { header, titleParentEl, deps } = setup();
    header.refresh();

    fireEvent.click(titleParentEl.querySelectorAll('.view-header-breadcrumb')[0]);

    expect(deps.revealFolder).toHaveBeenCalledWith('Projects');
  });

  it('adds a move button for each sidebar', () => {
    const { deps } = setup();

    expect(deps.addAction).toHaveBeenCalledWith('panel-left', 'Move to left panel', expect.any(Function));
    expect(deps.addAction).toHaveBeenCalledWith('panel-right', 'Move to right panel', expect.any(Function));
  });

  it('adds the buttons right to left, because Obsidian puts each new button to the left of the previous ones', () => {
    const { addAction } = setup();

    expect(addAction.mock.calls.map(([icon]) => icon)).toEqual(['panel-right', 'file-pen', 'panel-left']);
  });

  it.each([
    ['main', false, false],
    ['left', true, false],
    ['right', false, true],
  ] as const)('hides the move button of the sidebar the chat is already in (%s)', (side, leftHidden, rightHidden) => {
    const { header, actions, setSide } = setup();
    setSide(side);

    header.refresh();

    expect(actions.get('panel-left')!.classList.contains('claudian-hidden')).toBe(leftHidden);
    expect(actions.get('panel-right')!.classList.contains('claudian-hidden')).toBe(rightHidden);
  });

  it.each([
    ['panel-left', 'left'],
    ['panel-right', 'right'],
  ] as const)('moves the chat to the %s sidebar on click', async (icon, side) => {
    const { actions, deps } = setup();

    fireEvent.click(actions.get(icon)!);
    await Promise.resolve();

    expect(deps.moveToSide).toHaveBeenCalledWith(side);
    expect(deps.onMoveRefused).not.toHaveBeenCalled();
  });

  it('adds an edit note button between the two move buttons', () => {
    const { deps } = setup();

    expect(deps.addAction).toHaveBeenCalledWith('file-pen', 'Edit note', expect.any(Function));
  });

  it.each([[true, false], [false, true]])('shows the edit note button only when the chat has a file (file: %s, hidden: %s)', (hasFile, hidden) => {
    const { header, actions, setHasFile } = setup();
    setHasFile(hasFile);

    header.refresh();

    expect(actions.get('file-pen')!.classList.contains('claudian-hidden')).toBe(hidden);
  });

  it('opens the chat file as a note on click', async () => {
    const { actions, deps } = setup();

    fireEvent.click(actions.get('file-pen')!);
    await Promise.resolve();

    expect(deps.openChatFile).toHaveBeenCalledTimes(1);
    expect(deps.onEditRefused).not.toHaveBeenCalled();
  });

  it('tells the user when the chat file could not be opened', async () => {
    const { actions, deps } = setup({ openChatFile: jest.fn(async () => false) });

    fireEvent.click(actions.get('file-pen')!);
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.onEditRefused).toHaveBeenCalledTimes(1);
  });

  it('tells the user when the move is refused', async () => {
    const { actions, deps } = setup({ moveToSide: jest.fn(async () => false) });

    fireEvent.click(actions.get('panel-left')!);
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.onMoveRefused).toHaveBeenCalledTimes(1);
  });

  it('does nothing in the header slots when Obsidian does not expose them', () => {
    const { header } = setup({ titleParentEl: undefined, titleEl: undefined });

    expect(() => header.refresh()).not.toThrow();
  });
});
