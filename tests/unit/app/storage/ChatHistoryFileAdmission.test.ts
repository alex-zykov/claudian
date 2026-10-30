import {
  hasAnySessionMetadata,
  hasSessionTombstone,
  listDeviceSessionFolders,
} from '@/app/storage/ChatHistoryFileAdmission';

describe('ChatHistoryFileAdmission', () => {
  it('detects tombstones and meta across device folders', async () => {
    const exists = jest.fn(async (path: string) => (
      path === '.claudian/sessions/devices/dev-b/import-3.deleted.json'
      || path === '.claudian/sessions/devices/dev-a/import-4.meta.json'
    ));
    const folders = async () => [
      '.claudian/sessions/devices/dev-a',
      '.claudian/sessions/devices/dev-b',
    ];

    expect(await hasSessionTombstone(exists, folders, 'import-3')).toBe(true);
    expect(await hasSessionTombstone(exists, folders, 'import-4')).toBe(false);
    expect(await hasAnySessionMetadata(exists, folders, 'import-4')).toBe(true);
    expect(await hasAnySessionMetadata(exists, folders, 'import-3')).toBe(false);
  });

  it('lists device folders from listFolders, not file entries', async () => {
    const listFolders = jest.fn(async () => [
      '.claudian/sessions/devices/dev-a',
      'dev-b',
    ]);
    await expect(listDeviceSessionFolders(listFolders)).resolves.toEqual([
      '.claudian/sessions/devices/dev-a',
      '.claudian/sessions/devices/dev-b',
    ]);
    expect(listFolders).toHaveBeenCalledWith('.claudian/sessions/devices');
  });

  it('returns an empty list when the devices folder holds no device folders', async () => {
    await expect(listDeviceSessionFolders(async () => [])).resolves.toEqual([]);
  });

  it('fails closed when the devices folder cannot be listed', async () => {
    const listFolders = jest.fn(async () => {
      throw new Error('EACCES');
    });
    await expect(listDeviceSessionFolders(listFolders)).rejects.toThrow('EACCES');
  });
});
