import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {OrnamentPage} from '../../src/ornament/ui/OrnamentPage';
import {createDefaultOrnamentProject,DEFAULT_ZOOM} from '../../src/ornament/defaults';
import {loadOrnamentProject} from '../../src/ornament/persistence';

// The reference generator's reset was observed to leave the zoom control showing 7 while state
// intended 14 — the control and the store had drifted apart. A store-level test cannot catch that
// class of bug, because the store was arguably right; only the rendered value was wrong. So this
// test asserts on what the user can actually see.
const field=(label:string)=>screen.getByLabelText(label) as HTMLInputElement;
const slider=(label:string)=>screen.getByLabelText(`${label} slider`) as HTMLInputElement;
const defaults=createDefaultOrnamentProject();

const openEverySection=()=>{
 for(const summary of document.querySelectorAll('details'))summary.setAttribute('open','');
};

describe('ornament reset, as displayed',()=>{
 beforeEach(()=>{localStorage.clear();render(<OrnamentPage onExit={()=>{}}/>);openEverySection()});
 afterEach(cleanup);

 it('starts at the schema defaults',()=>{
  expect(field('Diameter').value).toBe('4');            // 101.6mm shown in the default unit, inches
  expect(field('Zoom').value).toBe(String(DEFAULT_ZOOM));
  expect(field('Rim width').value).toBe(String(defaults.ornament.rimWidthMm));
  expect(field('Title').value).toBe('');
 });

 it('restores every displayed control after edits, including the zoom the reference tool got wrong',()=>{
  fireEvent.change(field('Zoom'),{target:{value:'7'}});
  fireEvent.change(field('Diameter'),{target:{value:'6'}});
  fireEvent.change(field('Rim width'),{target:{value:'11'}});
  fireEvent.change(field('Map/text boundary'),{target:{value:'-4'}});
  fireEvent.change(field('Loop outer diameter'),{target:{value:'24'}});
  fireEvent.change(field('Minimum neck width'),{target:{value:'5'}});
  fireEvent.change(field('Title'),{target:{value:'Caldron Falls'}});
  fireEvent.change(field('Subtitle'),{target:{value:'north woods'}});
  fireEvent.change(field('Date'),{target:{value:'1967'}});
  fireEvent.change(field('Title size'),{target:{value:'18'}});
  fireEvent.change(field('Gap subtitle to title'),{target:{value:'9'}});
  fireEvent.change(screen.getByLabelText('Title font'),{target:{value:'inter'}});
  fireEvent.click(screen.getByRole('button',{name:'Water cutout (3 piece)'}));

  // Precondition: the UI really is showing the edited values.
  expect(field('Zoom').value).toBe('7');
  expect(field('Title').value).toBe('Caldron Falls');
  expect(screen.getByRole('button',{name:'Water cutout (3 piece)'}).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button',{name:'Reset to defaults'}));
  openEverySection();

  expect(field('Zoom').value).toBe(String(DEFAULT_ZOOM));
  expect(slider('Zoom').value).toBe(String(DEFAULT_ZOOM));
  expect(field('Diameter').value).toBe('4');
  expect(slider('Diameter').value).toBe('4');
  expect(field('Rim width').value).toBe(String(defaults.ornament.rimWidthMm));
  expect(field('Map/text boundary').value).toBe(String(defaults.ornament.mapToTextBoundaryMm));
  expect(field('Loop outer diameter').value).toBe(String(defaults.ornament.hangingLoop.outerDiameterMm));
  expect(field('Minimum neck width').value).toBe(String(defaults.ornament.hangingLoop.minNeckWidthMm));
  expect(field('Title').value).toBe('');
  expect(field('Subtitle').value).toBe('');
  expect(field('Date').value).toBe('');
  expect(field('Title size').value).toBe(String(defaults.text.title.sizeMm));
  expect(field('Gap subtitle to title').value).toBe(String(defaults.text.gap12Mm));
  expect((screen.getByLabelText('Title font') as HTMLSelectElement).value).toBe(defaults.text.title.fontId);
  expect(screen.getByRole('button',{name:'Classic (2 piece)'}).getAttribute('aria-pressed')).toBe('true');
 });

 it('keeps the slider and the number box showing the same value when either is edited',()=>{
  fireEvent.change(slider('Rim width'),{target:{value:'9'}});
  expect(field('Rim width').value).toBe('9');
  fireEvent.change(field('Rim width'),{target:{value:'13'}});
  expect(slider('Rim width').value).toBe('13');
 });

 it('re-displays millimetres without changing the stored diameter',()=>{
  fireEvent.change(screen.getByLabelText('Units'),{target:{value:'mm'}});
  expect(field('Diameter').value).toBe('101.6');
  fireEvent.change(screen.getByLabelText('Units'),{target:{value:'in'}});
  expect(field('Diameter').value).toBe('4');
 });

 it('clears the persisted project so a reload does not resurrect the old one',()=>{
  fireEvent.change(field('Title'),{target:{value:'Caldron Falls'}});
  expect(loadOrnamentProject()?.text.title.value).toBe('Caldron Falls');
  fireEvent.click(screen.getByRole('button',{name:'Reset to defaults'}));
  expect(loadOrnamentProject()?.text.title.value??'').toBe('');
 });
});
