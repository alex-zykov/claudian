import {
  DEVICE_SESSIONS_PATH,
  SESSIONS_PATH,
} from '@/core/bootstrap/storagePaths';

/**
 * App-owned admission for chat-history-file import: tombstones, existing
 * metadata across device folders, and folder listing under devices/.
 */
export async function hasSessionTombstone(
  exists: (path: string) => Promise<boolean>,
  listDeviceFolders: () => Promise<readonly string[]>,
  id: string,
): Promise<boolean> {
  if (await exists(`${SESSIONS_PATH}/${id}.deleted.json`)) return true;
  for (const folder of await listDeviceFolders()) {
    if (await exists(`${folder}/${id}.deleted.json`)) return true;
  }
  return false;
}

export async function hasAnySessionMetadata(
  exists: (path: string) => Promise<boolean>,
  listDeviceFolders: () => Promise<readonly string[]>,
  id: string,
): Promise<boolean> {
  if (await exists(`${SESSIONS_PATH}/${id}.meta.json`)) return true;
  for (const folder of await listDeviceFolders()) {
    if (await exists(`${folder}/${id}.meta.json`)) return true;
  }
  return false;
}

/**
 * Lists device session folders via adapter.listFolders (not listFiles). A listing failure
 * propagates: admission fails closed instead of treating unreadable layers as empty.
 */
export async function listDeviceSessionFolders(
  listFolders: (path: string) => Promise<readonly string[]>,
): Promise<string[]> {
  const entries = await listFolders(DEVICE_SESSIONS_PATH);
  return entries.map(entry => (
    entry.startsWith(`${DEVICE_SESSIONS_PATH}/`)
      ? entry
      : `${DEVICE_SESSIONS_PATH}/${entry}`
  ));
}
