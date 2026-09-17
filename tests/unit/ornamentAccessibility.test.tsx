import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {OrnamentPage} from '../../src/ornament/ui/OrnamentPage';
import {cityCapture} from '../fixtures/ornament/captures';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';

// The plan's §Accessibility requirements, one describe each, against the UI as it now stands —
// after the marker feature was removed and the warning lists were consolidated into one badge. There
// is deliberately nothing here about marker controls: they do not exist, and a test asserting that
// an absent control is accessible would pass for the wrong reason. (That the marker is gone is
// asserted in ornamentMapUi.test.tsx, which is where its removal belongs.)

const CRIVITZ={
 id:'nominatim:374550587',
 label:'Crivitz, Marinette County, Wisconsin, United States',
 coordinates:[-88.0043,45.2323],
 boundingBox:[-88.0246,45.2166,-87.9884,45.2498],
 provider:'nominatim',
 attribution:'© OpenStreetMap contributors — geocoding by Nominatim',
 kind:'village',
};
const PROVIDERS=[{id:'nominatim',label:'Nominatim (OpenStreetMap)',attribution:'a',note:'Worldwide'}];

const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};
const controls=()=>document.querySelector('aside')!;
const accessibleName=(element:Element):string=>{
 const aria=element.getAttribute('aria-label');
 if(aria)return aria;
 const id=element.getAttribute('id');
 if(id){
  // Scanned rather than selected: this jsdom has no CSS.escape, and useId() produces ids with
  // colons in them that an unescaped attribute selector cannot express.
  const label=Array.from(document.querySelectorAll('label')).find(node=>node.htmlFor===id);
  if(label?.textContent?.trim())return label.textContent.trim();
 }
 const wrapping=element.closest('label');
 if(wrapping?.textContent?.trim())return wrapping.textContent.trim();
 return '';
};

describe('accessibility of the ornament controls',()=>{
 let fake:InstalledFakeMapLibre;
 beforeEach(()=>{
  localStorage.clear();
  fake=installFakeMapLibre({features:cityCapture()});
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve({
   ok:true,status:200,
   json:async()=>({query:'Crivitz',provider:'nominatim',attribution:CRIVITZ.attribution,results:[CRIVITZ],cached:false,providers:PROVIDERS}),
  })));
  render(<OrnamentPage onExit={()=>{}}/>);
  openEverySection();
 });
 afterEach(()=>{cleanup();fake.uninstall()});

 // "Real labels for all text and range inputs."
 describe('labels',()=>{
  it('names every input in the control pane',()=>{
   const unnamed=Array.from(controls().querySelectorAll('input,select,textarea'))
    .filter(element=>!accessibleName(element))
    .map(element=>`${element.tagName.toLowerCase()}[type=${element.getAttribute('type')??'—'}] #${element.id||'(no id)'}`);
   expect(unnamed).toEqual([]);
  });

  it('names every range input distinctly from its number input, so each is addressable',()=>{
   const ranges=Array.from(controls().querySelectorAll('input[type=range]'));
   expect(ranges.length).toBeGreaterThan(5);
   for(const range of ranges)expect(accessibleName(range)).toMatch(/slider$/);
  });

  it('names every button',()=>{
   const unnamed=Array.from(controls().querySelectorAll('button')).filter(button=>!(button.textContent?.trim()||button.getAttribute('aria-label')));
   expect(unnamed).toEqual([]);
  });
 });

 // "Numeric values adjacent to sliders and editable directly."
 describe('numeric fields',()=>{
  it('pairs every slider with a number input sharing one stored value',()=>{
   for(const range of Array.from(controls().querySelectorAll('input[type=range]'))){
    const number=range.parentElement?.querySelector('input[type=number]') as HTMLInputElement|null;
    expect(number,`no number input beside ${accessibleName(range)}`).not.toBeNull();
    expect(number!.value).toBe((range as HTMLInputElement).value);
   }
  });

  it('lets the number be typed directly, and the slider follows',()=>{
   const zoom=screen.getByLabelText('Zoom') as HTMLInputElement;
   expect(zoom.type).toBe('number');
   fireEvent.change(zoom,{target:{value:'11'}});
   const slider=screen.getByLabelText('Zoom slider') as HTMLInputElement;
   expect(slider.value).toBe('11');
   expect((screen.getByLabelText('Zoom') as HTMLInputElement).value).toBe('11');
  });

  it('carries the same min, max and step on both halves',()=>{
   const number=screen.getByLabelText('Zoom') as HTMLInputElement;
   const slider=screen.getByLabelText('Zoom slider') as HTMLInputElement;
   expect([slider.min,slider.max,slider.step]).toEqual([number.min,number.max,number.step]);
  });
 });

 // "Keyboard-operable segmented controls."
 describe('segmented controls',()=>{
  const detailButtons=()=>['Low','Medium','High'].map(name=>screen.getByRole('button',{name}));

  it('is one tab stop, resting on the option that is on',()=>{
   const [low,medium,high]=detailButtons();
   expect(medium.getAttribute('aria-pressed')).toBe('true');
   expect(medium.tabIndex).toBe(0);
   expect(low.tabIndex).toBe(-1);
   expect(high.tabIndex).toBe(-1);
  });

  it('moves focus with the arrow keys',()=>{
   const [low,medium,high]=detailButtons();
   medium.focus();
   fireEvent.keyDown(medium,{key:'ArrowRight'});
   expect(document.activeElement).toBe(high);
   fireEvent.keyDown(high,{key:'ArrowLeft'});
   expect(document.activeElement).toBe(medium);
   fireEvent.keyDown(medium,{key:'ArrowLeft'});
   expect(document.activeElement).toBe(low);
  });

  it('wraps around, and Home and End reach the ends',()=>{
   const [low,,high]=detailButtons();
   low.focus();
   fireEvent.keyDown(low,{key:'ArrowLeft'});
   expect(document.activeElement).toBe(high);
   fireEvent.keyDown(high,{key:'Home'});
   expect(document.activeElement).toBe(low);
   fireEvent.keyDown(low,{key:'End'});
   expect(document.activeElement).toBe(high);
  });

  it('still selects on activation, and moves the tab stop with the selection',()=>{
   const [,medium,high]=detailButtons();
   fireEvent.click(high);
   expect(screen.getByRole('button',{name:'High'}).getAttribute('aria-pressed')).toBe('true');
   expect(screen.getByRole('button',{name:'High'}).tabIndex).toBe(0);
   expect(screen.getByRole('button',{name:'Medium'}).tabIndex).toBe(-1);
   expect(medium.getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves other keys alone so typing is never swallowed',()=>{
   const [,medium]=detailButtons();
   medium.focus();
   fireEvent.keyDown(medium,{key:'a'});
   expect(document.activeElement).toBe(medium);
  });
 });

 // "Status/progress announced through a polite live region."
 describe('the live regions',()=>{
  it('announces progress politely, and marks itself busy only while it is',async()=>{
   const progress=document.querySelector('.ornament-progress')!;
   expect(progress.getAttribute('role')).toBe('status');
   expect(progress.getAttribute('aria-live')).toBe('polite');
   expect(progress.getAttribute('aria-busy')).toBe('false');
   expect(progress.textContent).toMatch(/Idle/);

   fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
   expect(progress.getAttribute('aria-busy')).toBe('true');
   expect(progress.textContent).toMatch(/Capturing|Building/);

   await waitFor(()=>expect(document.querySelector('.ornament-progress')!.getAttribute('aria-busy')).toBe('false'));
  });

  it('keeps the workspace status line polite too',()=>{
   const note=document.querySelector('.mode-note')!;
   expect(note.getAttribute('role')).toBe('status');
   expect(note.getAttribute('aria-live')).toBe('polite');
  });

  // The badge used to carry role="status" on its own <summary>, which replaced the disclosure role
  // outright: the count was announced but the fact that it could be opened was not.
  it('leaves the status badge as a working disclosure rather than a live region',()=>{
   const summary=document.querySelector('.ornament-status summary')!;
   expect(summary.getAttribute('role')).toBeNull();
   expect(summary.getAttribute('aria-live')).toBeNull();
   expect(summary.closest('details')).not.toBeNull();
  });
 });

 // "Errors explain how to recover."
 describe('errors and blocked states',()=>{
  it('says what to do about every reason export is blocked, not just that it is',()=>{
   const reasons=within(document.getElementById('ornament-export-blocked')!).queryAllByRole('listitem').map(item=>item.textContent??'');
   expect(reasons.length).toBeGreaterThan(0);
   // Each reason names an action: search, choose, capture.
   for(const reason of reasons)expect(reason).toMatch(/search|choose|capture/i);
  });

  it('ties the disabled export button to the list saying why',()=>{
   const button=screen.getByRole('button',{name:'Export SVG'});
   expect(button.getAttribute('aria-describedby')).toBe('ornament-export-blocked');
   expect(document.getElementById('ornament-export-blocked')).not.toBeNull();
  });

  it('explains a failed search rather than going quiet',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve({
    ok:false,status:504,json:async()=>({error:'Nominatim did not respond within 8000ms.',code:'upstream-timeout'}),
   })));
   fireEvent.change(screen.getByLabelText('Place or address'),{target:{value:'Crivitz'}});
   fireEvent.click(screen.getByRole('button',{name:'Search'}));
   await waitFor(()=>expect(screen.getByText(/did not respond/)).toBeTruthy());
  });
 });

 // "Do not rely on colour alone for cut/engrave roles."
 describe('roles are not carried by colour alone',()=>{
  it('names each role and the shape treatment that encodes it',()=>{
   const legend=document.querySelector('.ornament-legend')!;
   expect(legend).not.toBeNull();
   const text=legend.textContent??'';
   expect(text).toMatch(/Cut\s*—\s*outline only, no fill/);
   expect(text).toMatch(/Engrave\s*—\s*solid fill/);
   expect(text).toMatch(/dashed outline/);
  });

  it('hides the colour swatches from assistive technology, since the words carry the meaning',()=>{
   const swatches=document.querySelectorAll('.ornament-legend-swatch');
   expect(swatches.length).toBeGreaterThan(0);
   for(const swatch of Array.from(swatches))expect(swatch.getAttribute('aria-hidden')).toBe('true');
  });

  it('titles the cut and engrave groups in the preview drawing',()=>{
   const titles=Array.from(document.querySelectorAll('svg title')).map(node=>node.textContent??'');
   expect(titles.join(' | ')).toMatch(/cut/i);
   expect(titles.join(' | ')).toMatch(/engrav/i);
  });

  it('names the severity of every finding in words',async()=>{
   // Force a finding: text far too large for the band is a blocking geometry issue.
   fireEvent.change(screen.getByLabelText('Title size'),{target:{value:'60'}});
   openEverySection();
   await waitFor(()=>expect(document.querySelectorAll('.ornament-issues li').length).toBeGreaterThan(0));
   for(const item of Array.from(document.querySelectorAll('.ornament-status .ornament-issues li')))
    expect(item.querySelector('.ornament-issue-kind')?.textContent).toMatch(/^(Error|Warning)$/);
  });

  it('summarises the badge in words rather than by colour',async()=>{
   fireEvent.change(screen.getByLabelText('Title size'),{target:{value:'60'}});
   await waitFor(()=>expect(document.querySelector('.ornament-status summary')!.textContent).toMatch(/error|warning/i));
  });
 });
});
