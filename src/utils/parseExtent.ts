import { GetAttributes } from '@/components/zarr/ZarrLoaderLRU'
import { useGlobalStore } from '@/GlobalStates/GlobalStore'
import { usePlotStore } from '@/GlobalStates/PlotStore'
import { useZarrStore } from '@/GlobalStates/ZarrStore'
import { getDimAxis, useAxisIndices } from '@/hooks'
import proj4 from 'proj4'
import React from 'react'

const COMMON_CRS_NAMES = [
	'esri_pe_string',
	'crs',
	'spatial_ref',
	'crs_wkt',
]
// We exclude EPSG since the number of valid EPSGs is limited for proj4js

const COMMON_POINTER_NAMES = [
	'grid_mapping_name',
	'grid_mapping',
]

const hasAny = (obj:Record<string, string>, keys:string[]) => keys.some(k => k in obj);

const checkForCRS = (metadata: Record<string, string>): string | undefined =>{
	//Loop through common CRS attribute names and see if they are valid in proj4js
	for (const key of COMMON_CRS_NAMES){
		if (!(key in metadata)) continue;
		try{
			const candidateCRS = metadata[key]
			proj4(candidateCRS)
			return candidateCRS
		} catch {continue}
	}
}

export const parseExtent = () => {
	const {xArray, yArray} = getDimAxis()
	const {metadata, variables, flipY} = useGlobalStore.getState()
	const hasCRS = metadata ? hasAny(metadata, COMMON_CRS_NAMES) : false;
	const hasPointer = metadata ? hasAny(metadata, COMMON_POINTER_NAMES) : false;
	const hasCRSVar = COMMON_CRS_NAMES.some(k => k in variables);
	let validCRS = undefined
	if (hasCRS && metadata){ // Metadata can't be undefined while hasCRS is true, but whatever
		validCRS = checkForCRS(metadata)
	}else if (hasPointer && metadata){
		for (const varName in COMMON_POINTER_NAMES){
			if (!(varName in variables)) continue;
			GetAttributes(varName).then(varMeta =>{
				validCRS = checkForCRS(varMeta)
			})
		}
	}else if (hasCRSVar){
		for (const varName in COMMON_CRS_NAMES){
			if (!(varName in variables)) continue;
			GetAttributes(varName).then(varMeta =>{
				validCRS = checkForCRS(varMeta);
			})
		}
	}
	const xMin = xArray[0];
	const xMax = xArray[xArray.length-1];
	const yStart = yArray[0];
	const yEnd = yArray[yArray.length-1];
	const xRes = xArray[1]-xArray[0];
	const yRes = Math.abs(yArray[1] - yArray[0]);

	let is360Deg = xMax > 180 && xMax <= 360;
	const yMax = Math.max(yStart, yEnd);
	const borderCompatible = (xMax <= 360 && yMax <= 90) || Boolean(validCRS);
	let yExtent, xExtent;
	if (borderCompatible){
		yExtent = flipY ? [yEnd, yStart] : [yStart, yEnd];
		xExtent = [xMin, xMax]
	} else {
		yExtent = [-90, 90]
		xExtent = [-180, 180]
	}
	usePlotStore.setState({
		nativeCRS:validCRS,
		lonExtent:[xMin, xMax],
		latExtent:yExtent as [number, number],
		lonResolution:xRes,
		latResolution:yRes,
		originalExtent:[xMin, xMax, yExtent[0], yExtent[1]],
		is360Deg
	})
	useGlobalStore.setState({
		borderCompatible
	})


	return
}


