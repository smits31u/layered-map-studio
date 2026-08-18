export const MM_PER_INCH=25.4;
export const inchesToMm=(n:number)=>Number((n*MM_PER_INCH).toFixed(9));
export const mmToInches=(n:number)=>Number((n/MM_PER_INCH).toFixed(9));
export function validateDimensionMm(n:number){return Number.isFinite(n)&&n>=50&&n<=1220}
export const formatMm=(n:number)=>Number(n.toFixed(6));
