/** @jest-environment jsdom */

import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { type App, Notice } from 'obsidian';

import { createQuickAskCommand } from '@/features/chat/workspace/QuickAskCommand';

jest.mock('obsidian', () => jest.requireActual('@test/helpers/ObsidianSettingsDOM'));

const NOT_SENT = "Claudian can't take a message right now. Your question is still here.";

describe('Quick ask command', () => {
  const app = {} as App;

  function createHost(submitResult: boolean | Promise<boolean> = true) {
    const submitToActiveInput = jest.fn().mockImplementation(() => Promise.resolve(submitResult));
    const activateView = jest.fn().mockResolvedValue(undefined);
    const command = createQuickAskCommand({
      app,
      activateView,
      getView: () => ({ submitToActiveInput }),
    });
    return { activateView, command, submitToActiveInput };
  }

  function open(command: ReturnType<typeof createQuickAskCommand>): void {
    command.callback?.();
  }

  function question(): HTMLInputElement {
    return screen.getByRole('textbox', { name: 'Question' }) as HTMLInputElement;
  }

  beforeEach(() => {
    document.body.replaceChildren();
    jest.mocked(Notice).mockClear();
  });

  it('is a palette command that can be bound to a hotkey', () => {
    const { command } = createHost();

    expect(command).toEqual({
      id: 'quick-ask',
      name: 'Quick ask',
      callback: expect.any(Function),
    });
  });

  it('opens a labeled dialog and sends trimmed text through the active chat', async () => {
    const { activateView, command, submitToActiveInput } = createHost();

    open(command);

    const dialog = screen.getByRole('dialog', { name: 'Quick ask' });
    const input = question();
    expect(input.placeholder).toBe('Ask Claudian');
    expect(document.activeElement).toBe(input);
    expect(await axe(dialog)).toHaveNoViolations();

    input.value = '  What changed in this note?  ';
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(submitToActiveInput).toHaveBeenCalledWith('What changed in this note?'));
    expect(activateView).toHaveBeenCalledTimes(1);
    expect(activateView.mock.invocationCallOrder[0])
      .toBeLessThan(submitToActiveInput.mock.invocationCallOrder[0]);
    expect(screen.queryByRole('dialog', { name: 'Quick ask' })).toBeNull();
    expect(Notice).not.toHaveBeenCalled();
  });

  it('does nothing when Enter is pressed with empty text', () => {
    const { activateView, command, submitToActiveInput } = createHost();
    open(command);
    const input = question();

    input.value = '   ';
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(submitToActiveInput).not.toHaveBeenCalled();
    expect(activateView).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Quick ask' })).toBeTruthy();
    expect(input.value).toBe('   ');
    expect(Notice).not.toHaveBeenCalled();
  });

  it('closes on Escape without sending', () => {
    const { activateView, command, submitToActiveInput } = createHost();
    open(command);
    const input = question();
    input.value = 'Keep this';

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(submitToActiveInput).not.toHaveBeenCalled();
    expect(activateView).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Quick ask' })).toBeNull();
  });

  it('keeps the typed text and explains when the chat cannot accept it', async () => {
    const { command, submitToActiveInput } = createHost(false);
    open(command);
    const input = question();
    input.value = 'Ask later';

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(Notice).toHaveBeenCalledWith(NOT_SENT));
    expect(submitToActiveInput).toHaveBeenCalledWith('Ask later');
    expect(screen.getByRole('dialog', { name: 'Quick ask' })).toBeTruthy();
    expect(question().value).toBe('Ask later');
    expect(document.activeElement).toBe(question());
  });

  it('does not send an Enter that is still composing', () => {
    const { command, submitToActiveInput } = createHost();
    open(command);
    const input = question();
    input.value = '途中';

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(submitToActiveInput).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Quick ask' })).toBeTruthy();
  });
});
