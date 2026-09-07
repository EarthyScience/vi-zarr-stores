'use client';
import React, {useEffect, useMemo} from 'react'
import './Plots.css'
import { useAnalysisStore } from '@/GlobalStates/AnalysisStore';
import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { useShallow } from 'zustand/shallow'
import { parseLoc } from '@/utils/HelperFuncs'
import { useDimAxis } from '@/hooks';


const AnalysisInfo = ({loc, show, info, } : {loc: number[], show: boolean, info: number[]}) => {
    const {axisDimNames, axisDimUnits} = useGlobalStore(useShallow(s => s))
    const axis = useAnalysisStore(state=> state.axis)
    const {xArray, yArray, zArray} = useDimAxis();
    const axisDimArrays = [zArray, yArray, xArray];
    const plotInfo = useMemo(()=>{
        let plotNames, plotUnits, plotArrays;
        if (axisDimNames.length < 3){
            plotNames = [axisDimNames[0], axisDimNames[1]]
            plotUnits = [axisDimUnits[0], axisDimUnits[1]]
            plotArrays = [axisDimArrays[0], axisDimArrays[1]]
        }
        else{
            plotNames = axisDimNames.filter((_val,idx)=> idx != axis)
            plotUnits = axisDimUnits.filter((_val,idx)=> idx != axis)
            plotArrays = axisDimArrays.filter((_val,idx)=> idx != axis)
        }
        return {plotNames, plotUnits, plotArrays}
    },[axisDimNames, axisDimUnits, axisDimArrays, axis]) 
    const {plotNames, plotUnits} = plotInfo;
    const yCoord = yArray[Math.floor(info[0] * yArray?.length)]
    const xCoord = xArray[Math.floor(info[1] * xArray?.length)]

  return (
    <div className='analysis-overlay'
        style={{
            left:`${loc[0]+10}px`,
            top:`${loc[1]+10}px`,
            display: show ? '' : 'none'
        }}
    >
        {`${plotNames[0]}: ${show && parseLoc(yCoord,plotUnits[0])}`}<br/>
        {`${plotNames[1]}: ${show && parseLoc(xCoord,plotUnits[1])}`}<br/>
        {`Value: ${Math.round(info[2] * 100)/100}`}
    </div>
    )
}

export default AnalysisInfo
