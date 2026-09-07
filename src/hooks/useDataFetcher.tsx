import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { usePlotStore } from '@/GlobalStates/PlotStore';
import { useZarrStore } from '@/GlobalStates/ZarrStore';
import { useShallow } from 'zustand/shallow';
import { GetDimInfo } from '@/utils/HelperFuncs';
import { GetAttributes } from '@/components/zarr/ZarrLoaderLRU';
import { GetArray } from '@/components/zarr/GetArray';
import { ArrayToTexture } from '@/components/textures';
import { handleIrregularGrid, reproject } from '@/components/textures/ProjectionTexture';
import { parseExtent } from '@/utils/parseExtent';

export const useDataFetcher = () => {
    const {
    setShape, setDataShape, setFlipY, setValueScales, setMetadata, setPlotOn, setStatus} = useGlobalStore(
    useShallow(s => s))
    const {variable, setIsFlat, setUseF16Textures} = useGlobalStore(useShallow(s => s))
    const {plotType, interpPixels, preProject, setPlotType} = usePlotStore(useShallow(s => s))
    const {reFetch} = useZarrStore(useShallow(s => s))

    //---- Local State ----//
    const [textures, setTextures] = useState<THREE.DataTexture[] | THREE.Data3DTexture[] | null>(null);
    const [show, setShow] = useState<boolean>(false);
    const [stableMetadata, setStableMetadata] = useState<Record<string, any>>({});

    useEffect(() => {
        if (variable !== "Default") {
            // Could remove this. But I think it looks better to just wipe then have an empty texture.
            // ---- RESET STATES ---- //
            setShow(false);
            setUseF16Textures(false);
            usePlotStore.setState({nativeCRS:undefined, destCRS:undefined})
            useGlobalStore.setState({remapTexture: undefined, remapBorders:undefined, });
            // ---- FETCH DATA ---- //
            try {
                //---- Texture Cleanup ----//
                if (textures) {
                    const oldTextures = textures;
                    setTimeout(() => {
                        oldTextures.forEach((tex) => {
                            tex.dispose();
                            if (tex.source) (tex.source as any).data = null;
                        });
                    }, 0);
                    setTextures(null);
                }
                //----- TimeSeries Cleanup ----//
                useGlobalStore.setState({timeSeries:{}, dimCoords:{}})
                //---- Set Plot Slicez ----//

                //---- Main Fetch ----//
                GetArray().then((result) => {
                    setDataShape(result.shape);
                    const shape = result.shape.filter((val) => val != 1);
                    const activeIndices = result.indices.filter((_, idx) => result.shape[idx] != 1);
                    useGlobalStore.getState().setActiveIndices(activeIndices);

                    const [tempTexture, scaling] = ArrayToTexture({
                        data: result.data,
                        shape
                    });

                    setTextures(tempTexture);
                    setValueScales(scaling as { maxVal: number; minVal: number });
                    useGlobalStore.setState({scalingFactor: result.scalingFactor});

                    const shapeLength = shape.length;
                    if (shapeLength === 2) {
                        setIsFlat(true);
                        if (!["flat", "sphere"].includes(plotType)) {
                            setPlotType("flat");
                        }
                    } else {
                        setIsFlat(false);
                    }
                    const aspectRatio = shape[shapeLength - 2] / shape[shapeLength - 1];
                    const timeRatio = shape[shapeLength - 3] / shape[shapeLength - 1];
                    setShape(new THREE.Vector3(2, aspectRatio * 2, Math.max(timeRatio, 2)));
                    
                    setPlotOn(true);
                    setStatus(null);
                }).then(()=>{
                    if(preProject)reproject();
                    else handleIrregularGrid();
                    setShow(true)
                })
            } catch (error) {
                console.error(error);
                setStatus(null);
                return;
            }

            //---- Metadata ----//
            GetAttributes().then((result) => {
                setMetadata(result);
                setStableMetadata(result);
            });

            //---- DimInfo ----//
            GetDimInfo(variable).then((arrays) => {
                let { dimArrays, dimUnits, dimNames } = arrays;
                useGlobalStore.setState({dimArrays, dimNames, dimUnits, 
                    axisDimArrays: dimArrays, axisDimNames: dimNames, axisDimUnits: dimUnits});
                
                const { axisMapping } = useZarrStore.getState();
                const yIdx = (axisMapping.y >= 0 && axisMapping.y < dimArrays.length) ? axisMapping.y : Math.max(0, dimArrays.length - 2);
                const targetDim = dimArrays[yIdx] || dimArrays[0];
                const shouldFlip = (targetDim && targetDim.length >= 2) ? targetDim[1] < targetDim[0] : false;
                setFlipY(shouldFlip);   
                parseExtent();             
            });

        } else {
            setMetadata(null);
        }
    }, [reFetch]); 

    useEffect(()=> {
    if (!textures) return;
    const updated = textures.map(tex => {
      const clone = tex.clone(); 
      if (interpPixels) {
        clone.minFilter = THREE.LinearFilter;
        clone.magFilter = THREE.LinearFilter;
      } else {
        clone.minFilter = THREE.NearestFilter;
        clone.magFilter = THREE.NearestFilter;
      }
      clone.needsUpdate = true; 
      return clone ;
    });
    setTextures(updated as THREE.Data3DTexture[] | THREE.DataTexture[]);
  },[interpPixels])

  useEffect(() => {
    // This cleanup function will run when the `textures` state is about to change,
    // or when the component unmounts.
    return () => {
      if (textures) {
        textures.forEach(tex => {
          tex.dispose();
        });
      }
    };
  }, [textures]);

    return { textures, show, stableMetadata, setTextures };
};