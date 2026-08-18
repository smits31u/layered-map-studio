import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as opentype from 'opentype.js';
import {FONT_REGISTRY,registerFontForTesting} from '../src/text/fontRegistry';

// Registers the real bundled fonts synchronously (via fs, not fetch) so every test that touches
// buildScene's label/title/subtitle/compass path sees fonts as already loaded, exactly as they
// would be in a real browser after preloadAllFonts() resolves — no mocking of text vectorization.
for(const font of FONT_REGISTRY){
 const buffer=readFileSync(resolve(__dirname,'..','public',font.url.replace(/^\//,'')));
 registerFontForTesting(font.id,opentype.parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)));
}
