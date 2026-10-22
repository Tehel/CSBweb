/**
 * The Dungeon Master forum's shared OneDrive, read without logging in: the folder its list
 * of custom dungeons names as the archive of every one of them, `Custom Dungeons/<name>
 * [<engines>] [<authors>]` (`.claude/memory/forum-dungeon-sources.md`).
 *
 * `api.onedrive.com` answers 401 to an anonymous caller; the token OneDrive's own web app
 * reads a shared folder with does not. Only reads: nothing here writes to the share.
 *
 * Usage:
 *
 *   import { oneDriveCustomDungeons, oneDriveFiles } from './lib/oneDrive';
 *   const folder = (await oneDriveCustomDungeons()).find((f) => f.name.startsWith('Kid Dungeon (Original)'));
 *   const files = await oneDriveFiles(folder);   // their '@content.downloadUrl' downloads them
 */

/** The forum's shared folder, which its list names as the archive of every dungeon in it. */
export const ONEDRIVE_SHARE = 'https://1drv.ms/f/s!AsBu7boYHQokbYK3rjKY0b5_ra8';
/** OneDrive's web app, whose anonymous token reads a shared folder (`oneDrive`). */
const ONEDRIVE_APP_ID = '5cbed6ac-a083-4e14-b191-b4ba07653de2';
const ONEDRIVE_API = 'https://my.microsoftpersonalcontent.com/_api/v2.0';
const USER_AGENT = 'Mozilla/5.0 (CSBweb)';

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  folder?: unknown;
  parentReference: { driveId: string };
  '@content.downloadUrl'?: string;
}

/** `url`'s answer, refused unless it is OK. */
export async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response;
}

let oneDriveAuth: string | null = null;

/** A call to OneDrive's API, with its web app's anonymous token, asked for once. */
async function oneDrive(url: string): Promise<{ value?: OneDriveItem[]; '@odata.nextLink'?: string } & OneDriveItem> {
  if (oneDriveAuth === null) {
    const answer = await fetchOk('https://api-badgerp.svc.ms/v1.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: ONEDRIVE_APP_ID }),
    });
    oneDriveAuth = `Badger ${(await answer.json() as { token: string }).token}`;
  }
  return (await fetchOk(url, { headers: { Authorization: oneDriveAuth, Prefer: 'autoredeem' } })).json();
}

/** A folder's children, every page of them. */
export async function oneDriveChildren(item: OneDriveItem): Promise<OneDriveItem[]> {
  const children: OneDriveItem[] = [];
  let url: string | undefined = `${ONEDRIVE_API}/drives/${item.parentReference.driveId}/items/${item.id}/children?$top=500`;
  while (url) {
    const page = await oneDrive(url);
    children.push(...page.value ?? []);
    url = page['@odata.nextLink'];
  }
  return children;
}

/** Every file under `item`, with its path below it. */
export async function oneDriveFiles(item: OneDriveItem, path = ''): Promise<{ path: string; item: OneDriveItem }[]> {
  const files: { path: string; item: OneDriveItem }[] = [];
  for (const child of await oneDriveChildren(item)) {
    const below = `${path}/${child.name}`;
    if (child.folder) files.push(...await oneDriveFiles(child, below));
    else files.push({ path: below, item: child });
  }
  return files;
}

/** The shared folder's `Custom Dungeons`, a folder a dungeon. */
export async function oneDriveCustomDungeons(): Promise<OneDriveItem[]> {
  const share = Buffer.from(ONEDRIVE_SHARE).toString('base64url');
  const root = await oneDrive(`${ONEDRIVE_API}/shares/u!${share}/driveitem`);
  const dungeons = (await oneDriveChildren(root)).find((child) => child.name === 'Custom Dungeons');
  if (!dungeons) throw new Error(`${ONEDRIVE_SHARE} has no 'Custom Dungeons' folder`);
  return oneDriveChildren(dungeons);
}
