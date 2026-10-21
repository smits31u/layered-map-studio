// How far a machine-time estimate was from a timed real job. Pure, so the panel, the recorded-jobs
// table and the export summary all report the same number.
//
// The error is taken against the real job, the thing being predicted: (estimate - actual) / actual.
// Positive means the estimate ran high (the job finished early), negative that it ran low.

// V2 spec, A5: the estimate is good enough to quote from once it lands within 15% of a timed job.
export const CALIBRATION_GATE_PCT=15;

export function percentError(estimatedMin:number,actualMin:number):number|null{
 if(!(Number.isFinite(estimatedMin)&&estimatedMin>0)||!(Number.isFinite(actualMin)&&actualMin>0))return null;
 return (estimatedMin-actualMin)/actualMin*100;
}

export const withinGate=(errorPct:number|null,gatePct=CALIBRATION_GATE_PCT)=>errorPct!==null&&Math.abs(errorPct)<=gatePct;

// "+12.3%" / "-4.0%", with the sign always shown so high and low read differently.
export const formatPercentError=(errorPct:number|null)=>errorPct===null?'-':`${errorPct>=0?'+':'-'}${Math.abs(errorPct).toFixed(1)}%`;

export function describeError(errorPct:number|null,gatePct=CALIBRATION_GATE_PCT):string{
 if(errorPct===null)return 'Enter the minutes the laser software reported.';
 const side=errorPct>=0?'high':'low';
 return withinGate(errorPct,gatePct)
  ?`Estimate ${formatPercentError(errorPct)} (${side}): within the ${gatePct}% gate.`
  :`Estimate ${formatPercentError(errorPct)} (${side}): outside the ${gatePct}% gate.`;
}
