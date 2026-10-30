/** @jest-environment jsdom */
import '@/providers';
import '@test/helpers/ObsidianSettingsDOM';

import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { t } from '@/i18n/i18n';

function setup(initial: { key: string; value: string }[] = []) {
  const settings = { chatFileCustomFields: initial };
  const mutateSettings = jest.fn(async (mutation: (value: typeof settings) => void) => {
    mutation(settings);
  });
  const plugin = { settings, mutateSettings, storage: { getAdapter: () => ({}) } };
  const tab = new ClaudianSettingTab({} as any, {} as any, plugin as any);
  const container = document.body.appendChild(document.createElement('div'));
  tab['renderChatFileFields'](container);
  const screen = within(container);
  const type = (input: HTMLElement, value: string) => {
    (input as HTMLInputElement).value = value;
    fireEvent.input(input);
  };
  const addField = async (key: string, value: string) => {
    fireEvent.click(screen.getByRole('button', { name: t('settings.chatFileFields.add') }));
    const keys = screen.getAllByRole('textbox', { name: /field name/i });
    const values = screen.getAllByRole('textbox', { name: /field value/i });
    type(keys[keys.length - 1], key);
    type(values[values.length - 1], value);
    await Promise.resolve();
  };
  return { container, screen, settings, mutateSettings, type, addField };
}

afterEach(() => { document.body.replaceChildren(); });

it('lists the stored fields and has no violations', async () => {
  const { container, screen } = setup([{ key: 'type', value: 'chat' }]);

  expect(screen.getByRole('textbox', { name: /field name/i })).toHaveProperty('value', 'type');
  expect(screen.getByRole('textbox', { name: /field value/i })).toHaveProperty('value', 'chat');
  expect((await axe(container)).violations).toEqual([]);
});

it('saves a complete field and shows no error', async () => {
  const { screen, settings, addField } = setup();

  await addField('type', 'chat');

  await waitFor(() => expect(settings.chatFileCustomFields).toEqual([{ key: 'type', value: 'chat' }]));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not save a half-filled field', async () => {
  const { screen, settings, type } = setup();
  fireEvent.click(screen.getByRole('button', { name: t('settings.chatFileFields.add') }));

  type(screen.getByRole('textbox', { name: /field name/i }), 'type');
  await Promise.resolve();

  expect(settings.chatFileCustomFields).toEqual([]);
});

it('reports a key that Claudian uses itself and does not save it', async () => {
  const { screen, settings, addField } = setup();

  await addField('id', 'x');

  expect(screen.getByRole('alert').textContent).toBe(t('settings.chatFileFields.errorReserved', { key: 'id' }));
  expect(screen.getByRole('textbox', { name: /field name/i }).getAttribute('aria-invalid')).toBe('true');
  expect(settings.chatFileCustomFields).toEqual([]);
});

it('reports a repeated key on the later row and keeps only the first', async () => {
  const { screen, settings, addField } = setup();

  await addField('type', 'chat');
  await addField('Type', 'other');

  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  expect(screen.getByRole('alert').textContent)
    .toBe(t('settings.chatFileFields.errorDuplicate', { key: 'Type' }));
  expect(settings.chatFileCustomFields).toEqual([{ key: 'type', value: 'chat' }]);
});

it('clears the error once the key is changed', async () => {
  const { screen, settings, type, addField } = setup();
  await addField('id', 'x');

  type(screen.getByRole('textbox', { name: /field name/i }), 'kind');
  await Promise.resolve();

  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(settings.chatFileCustomFields).toEqual([{ key: 'kind', value: 'x' }]));
});

it('removes a field and saves the rest', async () => {
  const { screen, settings } = setup([{ key: 'type', value: 'chat' }, { key: 'kind', value: 'ai' }]);

  fireEvent.click(screen.getAllByRole('button', { name: /remove field/i })[0]);

  await waitFor(() => expect(settings.chatFileCustomFields).toEqual([{ key: 'kind', value: 'ai' }]));
  expect(screen.getAllByRole('textbox', { name: /field name/i })).toHaveLength(1);
});
