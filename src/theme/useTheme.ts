import {useCallback,useEffect,useState} from 'react';
import {applyTheme,nextPreference,onSystemThemeChange,resolvePreference,storedPreference,storePreference,systemTheme,type Theme,type ThemePreference} from './theme';

// The theme preference, the theme it resolves to, and the toggle's cycle. main.tsx applies the
// theme before the first render, so this only keeps <html> in step afterwards: on a cycle, and on a
// system change while the preference is to follow the system.
export function useTheme():{preference:ThemePreference;theme:Theme;cycle:()=>void}{
 const [preference,setPreference]=useState<ThemePreference>(()=>storedPreference());
 const [system,setSystem]=useState<Theme>(()=>systemTheme());
 const theme=preference==='system'?system:resolvePreference(preference);
 useEffect(()=>{applyTheme(theme)},[theme]);
 useEffect(()=>onSystemThemeChange(setSystem),[]);
 const cycle=useCallback(()=>setPreference(current=>{const next=nextPreference(current);storePreference(next);return next}),[]);
 return {preference,theme,cycle};
}
