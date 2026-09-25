// A warning from building the board's vector features. Never blocking: the plan's preflight, which
// decides what blocks export, is Phase 4. These say what the build had to change and why.
export interface TopoFeatureWarning{code:string;message:string}
