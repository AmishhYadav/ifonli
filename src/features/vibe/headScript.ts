/**
 * Builds the inline, blocking <head> script that resolves the active vibe before first paint.
 * The string is generated from config + tokens so it cannot drift from them. Budget: < 1 KB.
 *
 * Resolution order: ?vibe= URL param -> cookie -> localStorage -> default ("random" picks one).
 * Side effects: html[data-vibe], cookie + localStorage (URL or random pick), font preload, theme-color.
 */
import {
  DEFAULT_VIBE,
  DEFAULT_VIBE_CYCLE,
  DISPLAY_FONT_FILES,
  VIBE_COOKIE,
  VIBE_COOKIE_MAX_AGE,
  VIBE_STORAGE_KEY,
  VIBE_URL_PARAM,
  type DefaultVibeSetting,
  type Vibe,
} from "./config";
import { resolveTokens } from "./tokens";

export interface HeadScriptOptions {
  cycle?: readonly Vibe[];
  defaultVibe?: DefaultVibeSetting;
}

export function buildHeadScript({
  cycle = DEFAULT_VIBE_CYCLE,
  defaultVibe = DEFAULT_VIBE,
}: HeadScriptOptions = {}): string {
  // One compact map: { vibe: [theme-color, font basename] }. Keys are valid identifiers, so unquoted.
  const FONT_PREFIX = "/fonts/";
  const FONT_SUFFIX = ".woff2";
  const entries = cycle.map((v) => {
    const file = DISPLAY_FONT_FILES[v];
    if (!file.startsWith(FONT_PREFIX) || !file.endsWith(FONT_SUFFIX)) {
      throw new Error(
        `Display font for ${v} must live in ${FONT_PREFIX} and be a ${FONT_SUFFIX} file`,
      );
    }
    const base = file.slice(FONT_PREFIX.length, -FONT_SUFFIX.length);
    return `${v}:[${JSON.stringify(resolveTokens(v).palette.bg.toLowerCase())},${JSON.stringify(base)}]`;
  });
  const fallback = defaultVibe === "random" ? "0" : JSON.stringify(defaultVibe);
  const s = JSON.stringify(VIBE_STORAGE_KEY);

  return [
    `(function(){try{`,
    `var M={${entries.join(",")}},V=Object.keys(M),d=document,`,
    `q=new URLSearchParams(location.search).get(${JSON.stringify(VIBE_URL_PARAM)}),`,
    `m=d.cookie.match(/(?:^|; )${VIBE_COOKIE}=(\\w+)/),l,v,u,e;`,
    `try{l=localStorage.getItem(${s})}catch(e){}`,
    `v=V.indexOf(q)>-1?(u=1,q):V.indexOf(m&&m[1])>-1?m[1]:V.indexOf(l)>-1?l:${fallback};`,
    `if(!v){v=V[Math.random()*V.length|0];u=1}`,
    `d.documentElement.dataset.vibe=v;`,
    `if(u){d.cookie="${VIBE_COOKIE}="+v+";max-age=${VIBE_COOKIE_MAX_AGE};path=/;SameSite=Lax"+(location.protocol=="https:"?";Secure":"");`,
    `try{localStorage.setItem(${s},v)}catch(e){}}`,
    `e=d.createElement("link");e.rel="preload";e.as="font";e.type="font/woff2";e.crossOrigin="";e.href="${FONT_PREFIX}"+M[v][1]+"${FONT_SUFFIX}";d.head.appendChild(e);`,
    `e=d.createElement("meta");e.name="theme-color";e.content=M[v][0];d.head.appendChild(e)`,
    `}catch(e){}})()`,
  ].join("");
}
