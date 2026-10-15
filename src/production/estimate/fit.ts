// Bounding-box sheet fitting: how many identical rectangular pieces fit on one stock sheet, in a
// plain grid, either all upright or all turned 90 degrees. This is deliberately not nesting. Real
// nesting of irregular parts is a later feature, and for full-rectangle lake panels a grid is
// already what nesting would give.

export function gridCount(pieceW:number,pieceH:number,usableW:number,usableH:number,spacing:number):number{
 if(pieceW<=0||pieceH<=0||pieceW>usableW+1e-9||pieceH>usableH+1e-9)return 0;
 // n pieces need n widths and n-1 gaps, so n fit when n*w + (n-1)*s <= W.
 return Math.floor((usableW+spacing+1e-9)/(pieceW+spacing))*Math.floor((usableH+spacing+1e-9)/(pieceH+spacing));
}

// Pieces per sheet, trying both orientations of the piece. margin is kept clear on every sheet edge.
export function piecesPerSheet(pieceW:number,pieceH:number,sheetW:number,sheetH:number,margin=0,spacing=0):number{
 const usableW=sheetW-2*margin,usableH=sheetH-2*margin;
 if(usableW<=0||usableH<=0)return 0;
 return Math.max(gridCount(pieceW,pieceH,usableW,usableH,spacing),gridCount(pieceH,pieceW,usableW,usableH,spacing));
}

// Whether a piece fits the laser bed in either orientation.
export const fitsBed=(pieceW:number,pieceH:number,bedW:number,bedH:number)=>(pieceW<=bedW+1e-9&&pieceH<=bedH+1e-9)||(pieceH<=bedW+1e-9&&pieceW<=bedH+1e-9);
