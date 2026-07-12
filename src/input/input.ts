/*
 * Input mapping. Translates keyboard codes to engine InputEvents and defines
 * the Hotspot shape the render layer emits for tap/click targets.
 */

import type { InputEvent } from "../engine/state";

/** Keyboard code -> engine event. Arrows navigate; Z confirm, X back, C evidence. */
export const KEY_EVENTS: Record<string, InputEvent> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyZ: "confirm",
  Enter: "confirm",
  Space: "confirm",
  KeyX: "back",
  Escape: "back",
  KeyC: "evidence",
};

/**
 * A tap/click target in logical (256x224) space. `action` is either an engine
 * InputEvent or a `menu:<index>` directive handled by main.
 */
export interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  action: InputEvent | `menu:${number}`;
}
