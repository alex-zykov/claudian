import '@/providers';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/app/storage/ConversationPersistenceStore';
import type { SessionMetadataReader } from '@/app/storage/SessionStorage';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { Conversation } from '@/core/types';

function createPersistence(): ConversationPersistence {
  const metadataReader: SessionMetadataReader = {
    revalidate: jest.fn().mockResolvedValue([]),
    load: jest.fn(),
    scan: jest.fn(),
    loadMetadata: jest.fn(),
    scanMetadata: jest.fn(),
    listMetadata: jest.fn(),
  };
  return {
    metadataReader,
    saveMetadata: jest.fn().mockResolvedValue(undefined),
    deleteCurrentMetadata: jest.fn().mockResolvedValue(undefined),
    assignMetadataToDevice: jest.fn().mockResolvedValue(undefined),
  };
}

function createRepository() {
  const persistence = createPersistence();
  const repository = new ConversationRepository({
    providers: ProviderRegistry,
    providerSettings: ProviderSettingsCoordinator,
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    persistence,
    onConversationDeleted: jest.fn().mockResolvedValue(undefined),
  });
  return { repository, persistence };
}

describe('ConversationRepository.importFromHistoryFile', () => {
  it('creates device metadata from a history-file record', async () => {
    const { repository, persistence } = createRepository();
    const imported = await repository.importFromHistoryFile({
      id: 'import-shell-1',
      providerId: 'claude',
      title: 'Plan',
      createdAt: 100,
      lastActivityAt: 200,
      sessionId: 'native-1',
      linkedContentPath: 'Projects/A/x.md',
    });
    expect(imported).toMatchObject({
      id: 'import-shell-1',
      title: 'Plan',
      sessionId: 'native-1',
      linkedContentPath: 'Projects/A/x.md',
    });
    expect(persistence.saveMetadata).toHaveBeenCalled();
    expect(repository.blocksHistoryFileImport('import-shell-1')).toBe(true);
  });

  it('refuses ids deleted in this session', async () => {
    const { repository } = createRepository();
    const created = await repository.create({ providerId: 'claude' });
    await repository.delete(created.id);
    const imported = await repository.importFromHistoryFile({
      id: created.id,
      providerId: 'claude',
      title: 'Resurrect',
      createdAt: 1,
      lastActivityAt: 2,
      sessionId: null,
    });
    expect(imported).toBeNull();
  });

  it('refuses ids that already have a live record', async () => {
    const { repository } = createRepository();
    await repository.importFromHistoryFile({
      id: 'dup-1',
      providerId: 'claude',
      title: 'First',
      createdAt: 1,
      lastActivityAt: 2,
      sessionId: null,
    });
    const second = await repository.importFromHistoryFile({
      id: 'dup-1',
      providerId: 'claude',
      title: 'Second',
      createdAt: 3,
      lastActivityAt: 4,
      sessionId: null,
    });
    expect(second).toBeNull();
  });

  it('keeps ordinary create free of import-only fields', async () => {
    const { repository } = createRepository();
    const created = await repository.create({
      providerId: 'claude',
      linkedContentPath: 'Projects/A/x.md',
    });
    expect(created.linkedContentPath).toBe('Projects/A/x.md');
    expect((created as Conversation).id).toBeTruthy();
  });
});
