import {useCallback,useState} from 'react';
import type {EstimateConfig} from '../config';
import {loadEstimateConfig,saveEstimateConfig} from '../persistence';

// The shared estimate config, loaded once from localStorage and written back on every change.
export function useEstimateConfig():[EstimateConfig,(next:EstimateConfig)=>void]{
 const[config,setState]=useState<EstimateConfig>(()=>loadEstimateConfig());
 const setConfig=useCallback((next:EstimateConfig)=>{setState(next);saveEstimateConfig(next)},[]);
 return [config,setConfig];
}
