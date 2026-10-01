import { DBType, decodeObjectID } from '../core/types';
import { CursorFilterType, type CursorFilterPacket } from '../engine/GameHost';
import { isDebugFeaturesEnabled } from './context';

const DB_TYPE_LABELS: Record<number, string> = {
  [DBType.DOOR]: 'Door',
  [DBType.TELEPORTER]: 'Teleporter',
  [DBType.TEXT]: 'Text',
  [DBType.ACTUATOR]: 'Actuator',
  [DBType.CREATURE]: 'Creature',
  [DBType.WEAPON]: 'Weapon',
  [DBType.CLOTHING]: 'Clothing',
  [DBType.SCROLL]: 'Scroll',
  [DBType.POTION]: 'Potion',
  [DBType.CHEST]: 'Chest',
  [DBType.MISC]: 'Misc',
  [DBType.EXPOOL]: 'Expool',
  [DBType.DB12]: 'DB12',
  [DBType.DB13]: 'DB13',
  [DBType.MISSILE]: 'Missile',
  [DBType.CLOUD]: 'Cloud',
  [DBType.UNKNOWN]: 'Unknown',
};

const FILTER_LABELS: Record<CursorFilterType, string> = {
  [CursorFilterType.TakeKey]: 'Take key',
  [CursorFilterType.TakeFromTorchHolder]: 'Take from torch holder',
  [CursorFilterType.PlaceInTorchHolder]: 'Place in torch holder',
  [CursorFilterType.SwapRemove]: 'Swap remove',
  [CursorFilterType.SwapReplace]: 'Swap replace',
  [CursorFilterType.GiftFromGod]: 'Gift from god',
};

export function handleCursorFilter(packet: CursorFilterPacket): boolean {
  if (!isDebugFeaturesEnabled()) return true;
  const decoded = decodeObjectID(packet.object);
  const categoryLabel = DB_TYPE_LABELS[decoded.category] ?? `DB${decoded.category}`;
  const actionLabel = FILTER_LABELS[packet.type] ?? packet.type;
  console.debug(`[CursorFilter] ${actionLabel}: ${categoryLabel} ${packet.object.toString(16).padStart(4, '0')} at L${packet.level} (${packet.x},${packet.y}) pos ${packet.pos}`);
  return true;
}
