"use client";

import React, {useMemo, useEffect, useRef} from 'react'
import * as THREE from 'three'
import { useAnalysisStore } from '@/GlobalStates/AnalysisStore';
import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { usePlotStore } from '@/GlobalStates/PlotStore';
import { useZarrStore } from '@/GlobalStates/ZarrStore';
import { vertShader } from '@/components/computation/shaders'
import { useShallow } from 'zustand/shallow'
import { ThreeEvent } from '@react-three/fiber';
import { coarsenFlatArray, GetCurrentArray, GetTimeSeries, parseUVCoords } from '@/utils/HelperFuncs';
import { sampleCRS } from '../textures/ProjectionTexture';
import { evaluateColorMap } from '@/components/textures';
import { flatFrag } from '../textures/shaders';
import { SquareMeshes } from './TransectMeshes';
import { usePaddedTextures } from '@/hooks/usePaddedTextures';
import { useAxisIndices, useDimAxis } from '@/hooks';
import { updateCommonUniforms, useCommonUniforms } from '@/hooks/useCommonUniforms';
import { functionInjector } from '../ui/Elements/ColorAdjuster';
interface InfoSettersProps{
  setLoc: React.Dispatch<React.SetStateAction<number[]>>;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  val: React.RefObject<number>;
  coords: React.RefObject<number[]>;
}

const FlatMap = ({textures: propTextures, infoSetters} : {textures : THREE.DataTexture[] | THREE.Data3DTexture[], infoSetters : InfoSettersProps}) => {
    // ---- Imports ---- //
    const textures = usePaddedTextures(propTextures);
    const {setLoc, setShowInfo, val, coords} = infoSetters;
    const {flipY, dimArrays, dimNames, dimUnits, isFlat, dataShape, strides, remapTexture, remapBorders, shape,
      setPlotDim,updateDimCoords, updateTimeSeries} = useGlobalStore(useShallow(s => s))
    const {animProg, zSlice, ySlice, xSlice, selectTS, coarsen, colorScale,
      getColorIdx, incrementColorIdx} = usePlotStore(useShallow(s => s))
    const {axis, analysisMode, analysisArray} = useAnalysisStore(useShallow(s => s))
    const {kernelSize, kernelDepth} = useZarrStore(useShallow(s => s))

    const {xIdx, yIdx, zIdx} = useAxisIndices()
    const {xArray, yArray, zArray} = useDimAxis();
    const dimSlices = [zArray, yArray, xArray];
    const shapeRatio = useMemo(()=> {
      if (dataShape.length == 2){
        return shape.y/shape.x
      } else if (analysisMode){
        const thisShape = dataShape.filter((_val, idx) => idx != axis)
        return thisShape[0]/thisShape[1]
      } else {
        return shape.y/shape.x
      }
    }, [axis, shape, dataShape, analysisMode] )
    
    const geometry = useMemo(()=>new THREE.PlaneGeometry(2,2*shapeRatio),[shapeRatio])
    const infoRef = useRef<boolean>(false)
    const rotateMap = analysisMode && axis == 2;
    const sampleArray = useMemo(()=> analysisMode ? analysisArray : GetCurrentArray(),[analysisMode, analysisArray, textures])
    const analysisDims = useMemo(() => {
      if (!analysisMode) return dimSlices;
      const fullSlices = [
        dimArrays[zIdx]?.slice(zSlice[0], zSlice[1] ? zSlice[1] : undefined) ?? [],
        dimArrays[yIdx]?.slice(ySlice[0], ySlice[1] ? ySlice[1] : undefined) ?? [],
        dimArrays[xIdx]?.slice(xSlice[0], xSlice[1] ? xSlice[1] : undefined) ?? [],
      ];
      let slices = fullSlices.filter((_, idx) => idx !== axis);
      if (coarsen) slices = slices.map((val, idx) => coarsenFlatArray(val, (idx === 0 && slices.length > 2 ? kernelDepth : kernelSize)))
      return slices;
    }, [analysisMode, dimSlices, dimArrays, zSlice, ySlice, xSlice, axis, coarsen, kernelDepth, kernelSize, xIdx, yIdx, zIdx])

    useEffect(()=>{
        geometry.dispose()
    },[geometry])

    // ----- MOUSE MOVE ----- //
    const handleMove = (e: ThreeEvent<PointerEvent>) => {
      if (infoRef.current && e.uv) {
        let {uv} = e;
        if (!uv) return;
        setLoc([e.clientX, e.clientY]);
        if (remapTexture){
          const [thisUV, isValid] = sampleCRS(remapTexture, uv.x, uv.y)
          uv = thisUV;
          if (!isValid){
            val.current = NaN;
            coords.current = [thisUV.y,thisUV.x]
            return;
          }
        }
        const { x, y } = uv;
        const xSize = xArray.length;
        const ySize = yArray.length;
        const xId = Math.floor(x * xSize);
        const yId = Math.floor(y * ySize);
        let dataIdx = xSize * yId + xId;
        const zOffset = isFlat ? 0 : Math.floor((zArray.length-1) * animProg)
        dataIdx += zOffset * xSize*ySize
        const dataVal = sampleArray ? sampleArray[dataIdx] : 0;
        val.current = dataVal;
        coords.current = [y,x]
      }
    }
    // ----- TIMESERIES ----- //
    function HandleTimeSeries(event: THREE.Intersection){
      const uv = event.uv;
      if (!uv) return;
      const tsUV = flipY ? new THREE.Vector2(uv.x, 1-uv.y) : uv
      let newUV: THREE.Vector2 | undefined;
      const normal = new THREE.Vector3(0,0,1)
      if (remapTexture){
          const [thisUV, isValid] = sampleCRS(remapTexture, uv.x, flipY ? 1-uv.y: uv.y) // Weird double flippiing of UVs with flipY. Has something to do with how projected data is done. 
          if (flipY) thisUV.y = 1-thisUV.y
          if (isValid) newUV = thisUV;
          else{
            return;
          }
      }

      const tempTS = GetTimeSeries({data:analysisMode ? analysisArray : GetCurrentArray(), shape:dataShape, stride:strides},{uv:newUV ?? uv,normal})
      setPlotDim(0) //I think this 2 is only if there are 3-dims. Need to rework the logic
      
      const coordUV = parseUVCoords({normal:normal,uv:tsUV})
      let dimCoords = coordUV.map((val,idx)=>val ? dimSlices[idx][Math.round(val*dimSlices[idx].length)] : null)
      const thisDimNames = dimNames.filter((_,idx)=> dimCoords[idx] !== null)
      const thisDimUnits = dimUnits.filter((_,idx)=> dimCoords[idx] !== null)
      dimCoords = dimCoords.filter(val => val !== null)
      const tsID = `${dimCoords[0]}_${dimCoords[1]}`
      const tsObj = {
        color: evaluateColorMap(getColorIdx() / 10, 'Paired'),
        data: tempTS,
        normal,
        uv: tsUV,
      }
      incrementColorIdx();
      updateTimeSeries({ [tsID] : tsObj})
      const dimObj = {
        first:{
          name:thisDimNames[0],
          loc:dimCoords[0] ?? 0,
          units:thisDimUnits[0]
        },
        second:{
          name:thisDimNames[1],
          loc:dimCoords[1] ?? 0,
          units:thisDimUnits[1]
        },
        plot:{
          units:dimUnits[0]
        }
      }
      updateDimCoords({[tsID] : dimObj})
      
    }
    // ----- SHADER MATERIAL ----- //
    const uniforms = useCommonUniforms()
    const shaderMaterial = useMemo(()=>new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms:{
              map: {value: textures},
              remapTexture: {value: remapTexture?? remapBorders},
              ...uniforms
            },
            defines:{
              ...(isFlat ? { IS_FLAT: true } : {}),
              ...(remapTexture ? { REPROJECT: true } : {})
            },
            vertexShader: vertShader,
            fragmentShader: functionInjector(flatFrag, colorScale),
            side: THREE.DoubleSide,
        }),[isFlat, textures, remapTexture, colorScale])
    updateCommonUniforms(shaderMaterial)
    
    useEffect(()=>{
      // This is duplicated. Probably shoud just move it to Plot.tsx
      useGlobalStore.setState({timeSeries:{}, dimCoords:{}})
    },[remapTexture])
  return (
    <>
    <SquareMeshes />
    <mesh 
      material={shaderMaterial} 
      geometry={geometry} 
      scale={[((analysisMode && axis == 2) && flipY) ? -1:  1, flipY ? -1 : ((analysisMode && axis == 2) ? -1 : 1) , 1]}
      rotation={[0,0,rotateMap ? Math.PI/2 : 0]}
      onPointerEnter={()=>{setShowInfo(true); infoRef.current = true }}
      onPointerLeave={()=>{setShowInfo(false); infoRef.current = false }}
      onPointerMove={handleMove}
      onClick={selectTS && HandleTimeSeries}
    />
    </>
  )
}

export {FlatMap}
