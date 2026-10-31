import type { SceneBuilder } from "./helpers";
import { scene01 } from "./scene01";
import { scene02 } from "./scene02";
import { scene03 } from "./scene03";
import { scene04 } from "./scene04";
import { scene05 } from "./scene05";
import { scene06 } from "./scene06";
import { scene07 } from "./scene07";
import { scene08 } from "./scene08";
import { scene09 } from "./scene09";
import { scene10 } from "./scene10";

/** Scene modules in loop order; index `i` is scene `i + 1` of the plan table. */
export const SCENE_BUILDERS: readonly SceneBuilder[] = [
  scene01,
  scene02,
  scene03,
  scene04,
  scene05,
  scene06,
  scene07,
  scene08,
  scene09,
  scene10,
];
