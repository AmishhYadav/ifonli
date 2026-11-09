import { MIX_ATTRIBUTE, MIX_PATH } from "./config";
import { buildHeadScript, type HeadScriptOptions } from "./headScript";

/** Marks the home page for the neutral mixed theme before first paint (MixMode keeps it right after navigations). */
const MIX_SCRIPT = `if(${MIX_PATH.toString()}.test(location.pathname))document.documentElement.setAttribute("${MIX_ATTRIBUTE}","")`;

/**
 * Inline blocking script for <head>. Server component, no request-time reads, so pages stay static.
 * Later phases pass `{ cycle, defaultVibe }` from settings.
 */
export function VibeHeadScript(props: HeadScriptOptions) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: buildHeadScript(props) }} />
      <script dangerouslySetInnerHTML={{ __html: MIX_SCRIPT }} />
    </>
  );
}
