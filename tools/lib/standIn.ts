/**
 * A stand-in for one public member of an engine object, for a tool that decides what an
 * engine call returns (`CharacterSystem.executeAttack` landing a blow) or reads what it
 * was given (`MagicSystem.castSpellFromUi`'s result). The replacement is typed as the
 * member it replaces, `keyof` admits no private, and the returned function puts the
 * member back as it was: the prototype's again, or the stand-in it replaced.
 */

/** Puts the member back. */
export type Restore = () => void;

type MethodKey<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];

/** `target[key]` is `replacement` until the returned function is called. */
export function standIn<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): Restore {
  const own = Object.prototype.hasOwnProperty.call(target, key);
  const before = target[key];
  target[key] = replacement;
  return () => {
    if (own) target[key] = before;
    else Reflect.deleteProperty(target, key);
  };
}

/**
 * `target[key]` is what `wrap` makes of the member it replaces, bound to `target`, until
 * the returned function is called: a stand-in that calls the real one and notes what
 * went by.
 */
export function wrapMember<T extends object, K extends MethodKey<T>>(
  target: T, key: K, wrap: (real: T[K]) => T[K],
): Restore {
  // `MethodKey` makes `T[K]` a function, which `tsc` does not carry into a generic body.
  const real = (target[key] as (...args: unknown[]) => unknown).bind(target) as T[K];
  return standIn(target, key, wrap(real));
}

/**
 * A stand-in for a whole `T` that has only `members`: a partial record, a context or a
 * system holding just what the call under test reaches. `tsc` checks each member given
 * against `T`'s, and `Partial` admits no private, so a renamed member fails to compile
 * rather than leave the tool testing nothing. Any other member is absent, and a call
 * that reaches one throws.
 */
export function standInOf<T>(members: Partial<T>): T {
  return members as T;
}
