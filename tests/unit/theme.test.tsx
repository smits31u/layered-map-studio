import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ThemeToggle} from '../../src/components/ui/ThemeToggle';
import {nextPreference,resolveTheme,storedPreference,THEME_STORAGE_KEY} from '../../src/theme/theme';

// Light/dark/follow-system: the system setting decides until the user picks light or dark, the
// toggle cycles light → dark → system → light, an explicit choice survives a reload and "system"
// forgets it — and the two token sets in tokens.css define the same roles, so no component can
// fall through to a light value in the dark theme.

// A controllable prefers-color-scheme (jsdom has no matchMedia).
let systemDark=false;
let listeners:((event:{matches:boolean})=>void)[]=[];
const setSystem=(dark:boolean)=>{systemDark=dark;for(const listener of [...listeners])listener({matches:dark})};

const html=()=>document.documentElement;
const toggle=()=>screen.getByRole('button',{name:/^Theme:/});
const press=()=>fireEvent.click(toggle());
const shown=()=>({preference:toggle().dataset.preference,theme:html().dataset.theme,stored:localStorage.getItem(THEME_STORAGE_KEY)});

describe('theme',()=>{
 beforeEach(()=>{
  systemDark=false;listeners=[];localStorage.clear();delete html().dataset.theme;
  window.matchMedia=((query:string)=>({
   get matches(){return query.includes('dark')&&systemDark},
   media:query,
   addEventListener:(_:string,listener:(event:{matches:boolean})=>void)=>{listeners.push(listener)},
   removeEventListener:(_:string,listener:(event:{matches:boolean})=>void)=>{listeners=listeners.filter(l=>l!==listener)},
  })) as unknown as typeof window.matchMedia;
 });
 afterEach(cleanup);

 it('cycles light → dark → system → light',()=>{
  expect(nextPreference('light')).toBe('dark');
  expect(nextPreference('dark')).toBe('system');
  expect(nextPreference('system')).toBe('light');
 });

 it('follows prefers-color-scheme when nothing is stored',()=>{
  expect(storedPreference()).toBe('system');
  expect(resolveTheme()).toBe('light');
  systemDark=true;
  expect(resolveTheme()).toBe('dark');
 });

 it('prefers a stored light or dark over the system, and treats anything else as system',()=>{
  systemDark=true;
  localStorage.setItem(THEME_STORAGE_KEY,'light');
  expect(storedPreference()).toBe('light');
  expect(resolveTheme()).toBe('light');
  localStorage.setItem(THEME_STORAGE_KEY,'sepia');
  expect(storedPreference()).toBe('system');
  expect(resolveTheme()).toBe('dark');
 });

 it('starts on the system preference and applies the system theme',()=>{
  systemDark=true;
  render(<ThemeToggle/>);
  expect(shown()).toEqual({preference:'system',theme:'dark',stored:null});
  expect(toggle().getAttribute('aria-label')).toBe('Theme: System (dark). Switch to light');
 });

 it('walks the whole cycle, storing light and dark and forgetting the choice on system',()=>{
  systemDark=true;
  render(<ThemeToggle/>);
  press();
  expect(shown()).toEqual({preference:'light',theme:'light',stored:'light'});
  expect(toggle().getAttribute('aria-label')).toBe('Theme: Light. Switch to dark');
  press();
  expect(shown()).toEqual({preference:'dark',theme:'dark',stored:'dark'});
  expect(toggle().getAttribute('aria-label')).toBe('Theme: Dark. Switch to system');
  press();
  expect(shown()).toEqual({preference:'system',theme:'dark',stored:null});
  press();
  expect(shown()).toEqual({preference:'light',theme:'light',stored:'light'});
 });

 it('keeps an explicit choice across a reload, over the system',()=>{
  systemDark=true;
  render(<ThemeToggle/>);
  press();
  cleanup();delete html().dataset.theme;
  render(<ThemeToggle/>);
  expect(shown()).toEqual({preference:'light',theme:'light',stored:'light'});
 });

 it('tracks a system change on the system preference, but not on light or dark',()=>{
  render(<ThemeToggle/>);
  expect(html().dataset.theme).toBe('light');
  act(()=>setSystem(true));
  expect(html().dataset.theme).toBe('dark');
  expect(toggle().getAttribute('aria-label')).toBe('Theme: System (dark). Switch to light');

  press(); // light
  act(()=>setSystem(false));
  act(()=>setSystem(true));
  expect(html().dataset.theme).toBe('light');
  press(); // dark
  act(()=>setSystem(false));
  expect(html().dataset.theme).toBe('dark');

  press(); // back to system, which is light right now
  expect(html().dataset.theme).toBe('light');
  act(()=>setSystem(true));
  expect(html().dataset.theme).toBe('dark');
 });

 it('defines every semantic role in both the light and the dark token sets',()=>{
  const css=readFileSync(resolve(__dirname,'../../src/styles/tokens.css'),'utf8');
  const block=(selector:string)=>{const start=css.indexOf(selector);return css.slice(start,css.indexOf('\n}',start))};
  const roles=(text:string)=>new Set([...text.matchAll(/^\s*(--lms-[\w-]+):/gm)].map(match=>match[1]));
  const light=roles(block(':root,:root[data-theme=light]{'));
  const dark=roles(block(':root[data-theme=dark]{'));
  expect(light.size).toBeGreaterThan(40);
  expect([...light].filter(role=>!dark.has(role))).toEqual([]);
  expect([...dark].filter(role=>!light.has(role))).toEqual([]);
 });

 it('styles the studio only through semantic roles, never a raw palette colour',()=>{
  const css=readFileSync(resolve(__dirname,'../../src/styles/studio.css'),'utf8');
  expect(css.match(/var\(--lms-(navy|night|mist|paper|brick|amber|steel|green)-\d+\)|#[0-9a-f]{6}\b|rgba?\(/gi)).toBeNull();
 });
});
