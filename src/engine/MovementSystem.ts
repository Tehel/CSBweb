/**
 * Movement system with collision detection
 *
 * Handles party movement, collision detection, and special tile interactions
 * Based on CSBWin's movement and collision system
 */

import type { Party } from './Party';
import type { DungeonState } from './DungeonState';
import type { MovementResult } from './gameTypes';
import { MovementAction } from './gameTypes';
import { OBJECT_ID_EOF, Position, RoomType } from '../core/types';
import type { ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';
import { sw } from '../core/intCast';

/**
 * What `MoveParty` needs from the monster and champion systems.
 */
export interface MovementHooks {
    /** `FindFirstMonster(newX, newY)` (doc/CSBwin-src/CSBCode.cpp:8296). */
    findFirstMonster(position: Position): ObjectID;
    /** `ProcessTimers29to41(newX, newY, TT_M1, 0)` (doc/CSBwin-src/CSBCode.cpp:8302). */
    activateMonster(position: Position): void;
    /** `GetCharacterToDamage` (doc/CSBwin-src/CSBCode.cpp:6884). */
    getCharacterToDamage(x: number, y: number, corner: number): number;
    /** `DamageCharacter` (doc/CSBwin-src/Character.cpp:2703). */
    damageCharacter(chIdx: number, damage: number, woundMask: number, kind: number): number;
}

/**
 * MovementSystem - handles movement validation and collision detection
 */
export class MovementSystem {
    private party: Party;
    private dungeon: DungeonState;
    private hooks: MovementHooks;

    constructor(party: Party, dungeon: DungeonState, hooks: MovementHooks) {
        this.party = party;
        this.dungeon = dungeon;
        this.hooks = hooks;
    }

    /**
     * Attempt to move the party
     *
     * @param action - Movement action
     * @returns Movement result
     */
    move(action: MovementAction): MovementResult {
        // Check timing - can we move yet?
        const currentTime = Date.now();
        if (!this.party.canMove(action, currentTime)) return { success: false };

        // Handle turns (no collision detection needed)
        if (action === MovementAction.TURN_LEFT || action === MovementAction.TURN_RIGHT) {
            return this.handleTurn(action);
        }

        // Handle movement (requires collision detection)
        return this.handleMovement(action);
    }

    /**
     * Handle turning
     */
    private handleTurn(action: MovementAction): MovementResult {
        const position = this.party.state.position;
        const cellFlags = this.dungeon.getCellFlag(position);
        const roomType = (cellFlags >> 5) & 0x7;

        if (roomType === RoomType.STAIRS) {
            return this.traverseStairway(position, (cellFlags & 0x04) !== 0);
        }

        const newFacing = this.party.calculateNewFacing(action);

        return {
            success: true,
            newFacing,
        };
    }

    /**
     * Handle movement with collision detection
     */
    private handleMovement(action: MovementAction): MovementResult {
        const position = this.party.state.position;
        const cellFlagsFrom = this.dungeon.getCellFlag(position);
        const roomTypeFrom = (cellFlagsFrom >> 5) & 0x7;
        // `move` sends only the four moves here, never a turn.
        const relDirection = this.getRelativeDirection(action)!;

        if (roomTypeFrom === RoomType.STAIRS && relDirection === 2) {
            return this.traverseStairway(position, (cellFlagsFrom & 0x04) !== 0);
        }

        const newPosition = this.party.calculateNewPosition(action);

        // Off the map, `GetCellFlags` answers a stone cell (doc/CSBwin-src/CSBCode.cpp:4609),
        // so the party bumps the edge of the map as it bumps a wall.
        const dimensions = this.dungeon.getMapDimensions(newPosition.z);
        if (!dimensions) return this.bumpWall(newPosition, relDirection);

        if (newPosition.x < 0 || newPosition.x >= dimensions.width ||
            newPosition.y < 0 || newPosition.y >= dimensions.height) {
            return this.bumpWall(newPosition, relDirection);
        }

        // Check if new position is walkable.
        // CSBWin answers a blocked move with a sound only — there is no message
        // (`doc/CSBwin-src/Movement.cpp`, `doc/CSBwin-src/Mouse.cpp`).
        if (!this.dungeon.isWalkable(newPosition)) return this.bumpWall(newPosition, relDirection);

        const cellFlagsTo = this.dungeon.getCellFlag(newPosition);
        const roomTypeTo = (cellFlagsTo >> 5) & 0x7;
        if (roomTypeTo === RoomType.STAIRS) {
            return this.traverseStairway(newPosition, (cellFlagsTo & 0x04) !== 0);
        }

        // A monster in the destination cell inhibits the move exactly as a wall does
        // — `MoveParty` sets the same `D5W` flag for both
        // (doc/CSBwin-src/CSBCode.cpp:8286-8304):
        //
        //   if (d.NumCharacter != 0) {
        //     if (D5W != 0) { ...wall-bump damage... }
        //     else {
        //       if (direction <= 3) { objD0 = FindFirstMonster(newX,newY); D5W = objD0 != RNeof; }
        //       if (D5W != 0) ProcessTimers29to41(newX, newY, TT_M1, 0);
        //     }
        //   }
        //
        // Three details are load-bearing and easy to lose:
        //
        // - the check is gated on the party having champions, so an empty party walks
        //   through monsters as CSBWin lets it;
        // - `FindFirstMonster` does not test `NonMaterial()`, unlike the door-crush in
        //   `ProcessTT_1` — even an immaterial monster blocks the party;
        // - blocking is *silent*. The wall bump can queue sound 18; this queues nothing.
        //   It pokes the group instead, so the monster gets a turn out of being bumped
        //   into. `TT_M1` is CSBWin's "monster attacked, or the party bumped into it".
        //
        // Every `MovementAction` that reaches here is one of CSBWin's relative
        // directions 0-3 (see `getRelativeDirection`), so the `direction <= 3` test is
        // always true at this point. CSBWin's `direction > 3` arm — the Move Up /
        // Move Down buttons, which refuse outright rather than poking the group
        // (`:8200-8204`) — has no entry point here yet; see DEBT.md C5.
        if (this.party.state.champions.length !== 0) {
            if (this.hooks.findFirstMonster(newPosition) !== OBJECT_ID_EOF) {
                this.hooks.activateMonster(newPosition);
                return {
                    success: false,
                    blocked: true,
                };
            }
        }

        // Movement is valid
        return {
            success: true,
            newPosition,
        };
    }

    /**
     * `MoveParty`'s inhibited-move arm for terrain — stone, a shut door, a solid false
     * wall (doc/CSBwin-src/CSBCode.cpp:8263-8291):
     *
     *   direction = direction + (d.partyFacing + 2);
     *   LOCAL_8 = GetCharacterToDamage(newX, newY, direction & 3);
     *   k = sw(DamageCharacter(LOCAL_8, 1, 24, 2));
     *   LOCAL_10 = GetCharacterToDamage(newX, newY, (direction+1) & 3);
     *   LOCAL_30 = LOCAL_10;
     *   if (LOCAL_8 != LOCAL_30) k |= DamageCharacter(LOCAL_10, 1, 24, 2);
     *   if (k != 0) QueueSound(18, d.partyX, d.partyY, 0);
     *
     * The corners are the two of the new cell on the party's side, so the champions
     * who walked into the wall are the ones hurt, on the legs and feet (mask 24). The
     * bump is silent when nobody was hurt — an empty party, or a blow armour absorbed.
     * `LOCAL_30` is a `ui16`, so a -1 in both compares unequal and `DamageCharacter(-1)`
     * runs, returning 0; the port keeps the comparison as written.
     */
    private bumpWall(newPosition: Position, relDirection: number): MovementResult {
        let k = 0;
        if (this.party.state.champions.length !== 0) {
            const direction = relDirection + ((this.party.state.facing & 3) + 2);
            const local8 = this.hooks.getCharacterToDamage(newPosition.x, newPosition.y, direction & 3);
            k = sw(this.hooks.damageCharacter(local8, 1, 24, 2));
            const local10 = this.hooks.getCharacterToDamage(newPosition.x, newPosition.y, (direction + 1) & 3);
            const local30 = local10 & 0xffff;
            if (local8 !== local30) k |= this.hooks.damageCharacter(local10, 1, 24, 2);
        }
        return {
            success: false,
            blocked: true,
            soundId: k !== 0 ? SoundIndex.WALL_BUMP : undefined,
        };
    }

    private getRelativeDirection(action: MovementAction): number | null {
        switch (action) {
            case MovementAction.MOVE_FORWARD:  return 0;
            case MovementAction.STRAFE_RIGHT:  return 1;
            case MovementAction.MOVE_BACKWARD: return 2;
            case MovementAction.STRAFE_LEFT:   return 3;
            default: return null;
        }
    }

    private traverseStairway(position: Position, isUp: boolean): MovementResult {
        const delta = isUp ? -1 : 1;
        const next = this.dungeon.incrementLevel(position, delta);

        if (!next) {
            return {
                success: false,
                blocked: true,
            };
        }

        const fallbackFacing = this.party.state.facing;
        const newFacing = this.dungeon.getExitStairsDirection(next, fallbackFacing);

        return {
            success: true,
            newPosition: next,
            newFacing,
        };
    }

    /**
     * Execute a validated movement
     *
     * @param action - Movement action
     * @returns True if movement was executed
     */
    executeMovement(action: MovementAction): boolean {
        const result = this.move(action);

        if (!result.success) return false;

        this.party.applyMovement(result);
        return true;
    }

    /**
     * Get current position info for debugging
     */
    getPositionInfo(): string {
        const position = this.party.state.position;
        const facing = this.party.state.facing;

        const dirNames = ['North', 'East', 'South', 'West'];
        const tile = this.dungeon.getTile(position);
        const tileType = tile ? `Type: ${tile.roomType}` : 'Unknown';

        return `Position: (${position.x}, ${position.y}) Map: ${position.z} Facing: ${dirNames[facing]} ${tileType}`;
    }
}
