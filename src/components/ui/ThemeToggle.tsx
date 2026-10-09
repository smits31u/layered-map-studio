import {nextPreference,type ThemePreference} from '../../theme/theme';
import {useTheme} from '../../theme/useTheme';

const NAMES:Record<ThemePreference,string>={light:'Light',dark:'Dark',system:'System'};

// Theme button for the app bar, cycling light → dark → follow system. With three states the icon
// shows the current preference (sun, moon, or a screen for "follow the system") rather than the
// next one, and the accessible name says both what is on and what a press does. Self-contained, so
// every screen's app bar can carry one; only one screen is mounted at a time.
export function ThemeToggle(){
 const {preference,theme,cycle}=useTheme();
 const current=preference==='system'?`System (${theme})`:NAMES[preference];
 const label=`Theme: ${current}. Switch to ${NAMES[nextPreference(preference)].toLowerCase()}`;
 return <button type="button" className="theme-toggle" onClick={cycle} aria-label={label} title={label} data-preference={preference}>
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
   {preference==='light'&&<><circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M3.05 12.95l1.13-1.13M11.82 4.18l1.13-1.13"/></>}
   {preference==='dark'&&<path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z"/>}
   {preference==='system'&&<><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25"/><path d="M5.5 14.25h5M8 11.25v3"/></>}
  </svg>
 </button>;
}
