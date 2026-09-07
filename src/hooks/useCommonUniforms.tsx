// useCommonUniforms.ts
import { useGlobalStore } from '@/GlobalStates/GlobalStore'
import { usePlotStore } from '@/GlobalStates/PlotStore'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { useCoordBounds } from './useCoordBounds'

export function useCommonUniforms() {
	const {cScale, cOffset, animProg, nanTransparency, nanColor, fillValue, maskTexture, maskValue, valueRange, 
		useBorderTexture, borderColor, borderWidth, borderTexture, is360Deg, showBorders} = usePlotStore(useShallow(s=>s))
	const { textureArrayDepths, colormap, remapBorders, remapTexture, valueScales, useF16Textures} = useGlobalStore(useShallow(s => s))
	const {lonBounds, latBounds} = useCoordBounds()
    
	const uniforms = useMemo(() => ({
		cScale: {value: cScale},
		cOffset: {value: cOffset},
		maskTexture: {value: maskTexture},
		maskValue: {value: maskValue},
		useBorderTexture: {value: useBorderTexture && showBorders},
		borderTexture: {value: borderTexture},
		borderWidth: {value: borderWidth},
		borderColor: {value: new THREE.Color(borderColor).convertLinearToSRGB()},
		remapBorders : {value: Boolean(remapBorders) && !Boolean(remapTexture)},
		is360: {value: is360Deg},
		useF16: {value: useF16Textures},
		threshold: {value: new THREE.Vector2(valueRange[0],valueRange[1])},
		latBounds: {value: new THREE.Vector2(latBounds[0], latBounds[1])},
		lonBounds: {value: new THREE.Vector2(lonBounds[0], lonBounds[1])},
		textureDepths: {value:  new THREE.Vector3(textureArrayDepths[2], textureArrayDepths[1], textureArrayDepths[0])},
		cmap : { value : colormap},
		animateProg: {value: animProg},
		nanColor: {value : new THREE.Color(nanColor).convertLinearToSRGB()},
		nanAlpha: {value: 1 - nanTransparency},
		fillValue: {value: fillValue?? NaN},
		valueRange: {value: new THREE.Vector2(valueScales.minVal, valueScales.maxVal)}
	}), [
		cScale, cOffset, animProg, nanTransparency, nanColor, fillValue, maskTexture, maskValue, valueRange,
		textureArrayDepths, colormap, lonBounds, latBounds, useBorderTexture, borderTexture, borderWidth, 
		borderColor, remapBorders, remapTexture, is360Deg, showBorders, valueScales, useF16Textures
	])
	return uniforms
}

export function updateCommonUniforms(material: THREE.ShaderMaterial){
	const {cScale, cOffset, animProg, nanTransparency, nanColor, fillValue, maskTexture, maskValue, valueRange,
		useBorderTexture, borderColor, borderWidth, is360Deg, showBorders} = usePlotStore(useShallow(s=>s))
	const {textureArrayDepths, colormap, valueScales, useF16Textures} = useGlobalStore(useShallow(s => s))
	const {lonBounds, latBounds} = useCoordBounds()
	useEffect(()=>{
		// Cleanup function to dispose materials when they are remade in parent component
		if (material){
			material.dispose()
		}
	},[material])

	useEffect(()=>{
		if (!material) return;
		const uniforms = material.uniforms;
		uniforms.cOffset.value = cOffset;
		uniforms.cmap. value = colormap;
		uniforms.animateProg.value = animProg;
		uniforms.nanColor.value = new THREE.Color(nanColor).convertLinearToSRGB();
		uniforms.nanAlpha.value = 1 - nanTransparency;
		uniforms.cScale.value = cScale;
		uniforms.threshold.value.set(valueRange[0], valueRange[1]);
		uniforms.latBounds.value = new THREE.Vector2(latBounds[0], latBounds[1]);
		uniforms.lonBounds.value = new THREE.Vector2(lonBounds[0], lonBounds[1]);
		uniforms.maskValue.value = maskValue;
		uniforms.fillValue.value = fillValue?? NaN;
		uniforms.useBorderTexture.value = useBorderTexture && showBorders;
		uniforms.borderColor.value = new THREE.Color(borderColor).convertLinearToSRGB();
		uniforms.borderWidth.value = borderWidth;
		uniforms.is360.value = is360Deg;
		uniforms.valueRange.value = new THREE.Vector2(valueScales.minVal, valueScales.maxVal);
		uniforms.useF16.value = useF16Textures;
	},[[
		cScale, cOffset, animProg, nanTransparency, nanColor, fillValue, maskTexture, maskValue, valueRange,
		textureArrayDepths, colormap, lonBounds, latBounds, useBorderTexture, borderColor, borderWidth, is360Deg, showBorders,
		valueScales, useF16Textures
	]])
	
	return;
}