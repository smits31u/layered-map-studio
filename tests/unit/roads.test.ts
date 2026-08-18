import{describe,expect,it}from'vitest';import{includeRoad}from'../../src/geometry/roads/roads';
describe('road filtering',()=>{it('honors modes',()=>{expect(includeRoad('primary','main')).toBe(true);expect(includeRoad('tertiary','main')).toBe(false);expect(includeRoad('service','all')).toBe(true);expect(includeRoad('motorway','off')).toBe(false)})});
