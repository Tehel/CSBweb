export interface SoundInfo {
  name: string;
  rates?: number[];
}

export const ratesDefault = [5486];
export const ratesDoors = [5486, 4237];

export const soundsIndex: Record<number, SoundInfo> = {
  533: { name: 'Falling item' },
  534: { name: 'Switch' },
  535: { name: 'Door', rates: ratesDoors },
  536: { name: 'Trolin attack / Stone golem attack / Touch wall' },
  537: { name: 'Exploding fireball' },
  539: { name: 'Falling and dying' },
  540: { name: 'Swallowing' },
  541: { name: 'Champion wounded 1' },
  542: { name: 'Champion wounded 2' },
  543: { name: 'Champion wounded 3' },
  544: { name: 'Champion wounded 4' },
  545: { name: 'Exploding spell' },
  546: { name: 'Skeleton attack / armour attack / slash' },
  547: { name: 'Teleport' },
  549: { name: 'Running into a wall' },
  550: { name: 'Rat attack / Dragon attack' },
  551: { name: 'Mummy attack / Ghost attack' },
  552: { name: 'Screamer attack / Oitu attack' },
  553: { name: 'Scorpion attack' },
  554: { name: 'Worm attack' },
  555: { name: 'Giggler' },
};
