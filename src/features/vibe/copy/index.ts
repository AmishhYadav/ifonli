import type { Vibe } from "../config";

import { bold } from "./bold";
import { cute } from "./cute";
import { funky } from "./funky";
import { gothic } from "./gothic";
import type { CopyDictionary } from "./keys";

export { COPY_KEYS, type CopyDictionary, type CopyKey } from "./keys";

/** One dictionary per vibe; a missing key in any of them is a type error. */
export const COPY: Record<Vibe, CopyDictionary> = { cute, funky, bold, gothic };
