import { buildHeadScript, type HeadScriptOptions } from "./headScript";

/**
 * Inline blocking script for <head>. Server component, no request-time reads, so pages stay static.
 * Later phases pass `{ cycle, defaultVibe }` from settings.
 */
export function VibeHeadScript(props: HeadScriptOptions) {
  return <script dangerouslySetInnerHTML={{ __html: buildHeadScript(props) }} />;
}
