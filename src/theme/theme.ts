// Light/dark theme. The user's preference is one of three: light, dark, or follow the system (the
// browser's prefers-color-scheme). The toggle cycles through them. The theme actually shown is the
// preference resolved against the system, applied as `data-theme` on <html>, which switches the
// semantic tokens in tokens.css.
//
// Only an explicit light or dark is stored. Following the system is the absence of a stored value,
// so it is also the default on first load, and a user on it keeps tracking their OS as it changes
// (e.g. at sunset).

export type Theme='light'|'dark';
export type ThemePreference=Theme|'system';

export const THEME_STORAGE_KEY='layered-map-studio.theme';

// The toggle's cycle, from any preference to the next.
const CYCLE:Record<ThemePreference,ThemePreference>={light:'dark',dark:'system',system:'light'};
export const nextPreference=(preference:ThemePreference):ThemePreference=>CYCLE[preference];

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

const defaultStorage=():Storage|undefined=>{
 try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}
};

const darkQuery=():MediaQueryList|undefined=>typeof window!=='undefined'&&typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):undefined;

export function systemTheme():Theme{
 return darkQuery()?.matches?'dark':'light';
}

// The stored preference; anything other than an explicit light or dark means follow the system.
export function storedPreference(storage=defaultStorage()):ThemePreference{
 try{const value=storage?.getItem(THEME_STORAGE_KEY);return value==='light'||value==='dark'?value:'system'}catch{return 'system'}
}

export function storePreference(preference:ThemePreference,storage=defaultStorage()):void{
 // Storage can be full or blocked (private windows); the choice still applies for this visit.
 try{if(preference==='system')storage?.removeItem(THEME_STORAGE_KEY);else storage?.setItem(THEME_STORAGE_KEY,preference)}catch{/* not persisted */}
}

export const resolvePreference=(preference:ThemePreference):Theme=>preference==='system'?systemTheme():preference;

export function resolveTheme(storage=defaultStorage()):Theme{
 return resolvePreference(storedPreference(storage));
}

export function applyTheme(theme:Theme,root:HTMLElement|undefined=typeof document==='undefined'?undefined:document.documentElement):void{
 if(root)root.dataset.theme=theme;
}

// Calls back when the system setting changes. Returns the unsubscribe.
export function onSystemThemeChange(callback:(theme:Theme)=>void):()=>void{
 const query=darkQuery();
 if(!query)return ()=>{};
 const listener=(event:MediaQueryListEvent)=>callback(event.matches?'dark':'light');
 query.addEventListener('change',listener);
 return ()=>query.removeEventListener('change',listener);
}
