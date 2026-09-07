import React, {useEffect, useMemo} from 'react'
import * as THREE from 'three'
import { usePlotStore } from '@/GlobalStates/PlotStore'
import { useGlobalStore } from '@/GlobalStates/GlobalStore'
import { useShallow } from 'zustand/shallow'
import { useCoordBounds } from '@/hooks/useCoordBounds'
import { useAxisIndices } from '@/hooks'

function remapToXYZ(sphereUV: THREE.Vector2): THREE.Vector3 {
	const u = -sphereUV.x;
	const v = sphereUV.y;
	const theta = u * Math.PI * 2;        // longitude, [0, 2π]
	const phi = v * Math.PI - Math.PI / 2; // latitude, [-π/2, π/2]

	return new THREE.Vector3(
		Math.cos(phi) * Math.cos(theta),
		Math.sin(phi),
		Math.cos(phi) * Math.sin(theta)
	);
}

function uvToSphere(uv: THREE.Vector2, latBounds: number[], lonBounds: number[]): THREE.Vector2 {
	const u = uv.x;
	const v = uv.y;

	const sphereMinU = lonBounds[0] / (Math.PI * 2);
	const sphereMaxU = lonBounds[1] / (Math.PI * 2);

	const sphereMinV = (latBounds[0] + Math.PI / 2) / Math.PI;
	const sphereMaxV = (latBounds[1] + Math.PI / 2) / Math.PI;

	const sphereU = sphereMinU + u * (sphereMaxU - sphereMinU);
	const sphereV = sphereMinV + v * (sphereMaxV - sphereMinV);

	return new THREE.Vector2(sphereU, sphereV);
}

function normalToPos(uv: THREE.Vector2, normal:THREE.Vector3, ratios:{depthRatio:number, aspectRatio:number}, steps:{xSteps:number, ySteps:number, zSteps:number}): THREE.Vector3{
	let posZ, posY, posX: number;
	const {xSteps,ySteps,zSteps} = steps;
	const {aspectRatio, depthRatio} = ratios;
	if (Math.abs(normal.z) == 1){
		const flip = normal.z < 0;
		let x = flip ? (1-uv.x)-0.5: (uv.x-0.5)
		x = (Math.floor(x * xSteps ) + 0.5 )/xSteps;
		posX = x*2;
		const y = (Math.floor(uv.y * ySteps) + 0.5)/ySteps;
		posY = (y-0.5)*2*aspectRatio;
		posZ = 0;
	} else if (Math.abs(normal.y) == 1){
		const flip = normal.y > 0;
		let y = flip ? (1-uv.y)-0.5: (uv.y-0.5)
		y = (Math.floor(y * zSteps))/zSteps;
		const x = (Math.floor(uv.x * xSteps)+0.5)/xSteps;
		posX = (x-0.5)*2;
		posY = 0;
		posZ = y*Math.max(depthRatio,2);
	} else {
		const flip = normal.x > 0;
		let x = flip ? (1-uv.x)-0.5: (uv.x-0.5)
		x = (Math.round(x * zSteps))/zSteps;
		posX = 0;
		const y = (Math.round(uv.y * ySteps) + 0.5)/ySteps;
		posY = (y-0.5)*2*aspectRatio;
		posZ = x*Math.max(depthRatio,2);
	}
	return new THREE.Vector3(posX, posY, posZ)
}

function normalToScale(normal:THREE.Vector3, ratios:{depthRatio:number, aspectRatio:number}, steps:{xSteps:number, ySteps:number, zSteps:number}){
	//This function scales meshes to match the observed size of the pixels
	let scaleZ, scaleY, scaleX: number;
	const {xSteps,ySteps,zSteps} = steps;
	const {aspectRatio, depthRatio} = ratios;
	if (Math.abs(normal.z) == 1){
		scaleX = 2/xSteps;
		scaleY = 2*aspectRatio/ySteps;
		scaleZ = Math.max(depthRatio,2);
	} else if (Math.abs(normal.y) == 1){
		scaleX = 2/xSteps;
		scaleY = 2*aspectRatio;
		scaleZ = Math.max(depthRatio,2)/zSteps;
	} else{
		scaleX = 2;
		scaleY = 2*aspectRatio/ySteps;
		scaleZ = Math.max(depthRatio,2)/zSteps;
	}
	return new THREE.Vector3(scaleX, scaleY, scaleZ);
}

export const SquareMeshes = () => {
	const {timeSeries, dataShape, shape, flipY} = useGlobalStore(useShallow(s => s))
	const {plotType} = usePlotStore(useShallow(s => s))
	const {lonBounds, latBounds} = useCoordBounds()
	const {xIdx, yIdx} = useAxisIndices()
	const meshes: THREE.Mesh[] = useMemo(() =>{
		const meshes = []
		const xSteps = dataShape[xIdx];
		const ySteps = dataShape[yIdx];
		const normedXExtent = (lonBounds[1]-lonBounds[0])/360
		const normedYExtent = (latBounds[1]-latBounds[0])/180
		const isSphere = plotType == "sphere";
		const aspect = shape.y/shape.x;
		for (const [_tsID, tsObj] of Object.entries(timeSeries)){
			const {normal, uv, color} = tsObj
			if (normal.z != 1) break; // It should never be, but just in case, flat versions only do time. Skip all of these.
			let geometry = new THREE.PlaneGeometry(1, 1)
			// Color from 0-255 to 0-1 range
			const thisColor = color.map((c: number) => Math.pow((c/255), 2.2)) // Gamma correct the color
			const material = new THREE.MeshBasicMaterial({color: new THREE.Color(...thisColor)});
			material.side = THREE.DoubleSide; // For flipY or to see it on otherside of sphere after clipping values
			material.needsUpdate = true;
			const mesh = new THREE.Mesh(geometry, material)
			let position: THREE.Vector3;
			const uvX = (Math.floor(uv.x * xSteps)+0.5)/xSteps;
			const uvY = (Math.floor(uv.y * ySteps)+0.5)/ySteps;
			if (isSphere){
				const thisUV = new THREE.Vector2(uvX, flipY ? 1 - uvY : uvY)
				const sphereUV = uvToSphere(thisUV, latBounds, lonBounds)
				const circum = 2*Math.PI;
				const xScale = circum/xSteps * normedXExtent;
				const yScale = circum/2/ySteps * normedYExtent;
				const xScaler = Math.cos((sphereUV.y - 0.5) * Math.PI);
				position = remapToXYZ(sphereUV)	
				// Rotate the plane where position is also normal vector
				mesh.lookAt(position.x, position.y, position.z)
				geometry.scale(xScale*xScaler, yScale, 1)
			}
			else{
				const sqScale = 2/xSteps
				const posX = (uvX-0.5)*2;
				const posY = (uvY-0.5)*2*aspect;
				position = new THREE.Vector3(posX, posY, 0.001)
				geometry.scale(sqScale,sqScale,1)
			}
			mesh.position.set(position.x, position.y, position.z)			
			meshes.push(mesh)
		}
		return meshes
	}, [timeSeries, plotType, latBounds, lonBounds])
	useEffect(() => {
		return () => {
			meshes.forEach(mesh => {
				mesh.geometry.dispose()
				//@ts-ignore TS thiunks this is a different material type
				mesh.material.dispose()
			});
		};}, [meshes]
	);
	return (
	<>
		{meshes.map((mesh, idx) => <primitive key={idx} object={mesh}/>)}
	</>
	)
}

export const ColumnMeshes = () => {
	const {timeSeries, dataShape, remapTexture} = useGlobalStore(useShallow(s => s))
	const {plotType} = usePlotStore(useShallow(s => s))
	const {xIdx, yIdx, zIdx} = useAxisIndices()
	const meshes: THREE.Mesh[] = useMemo(()=>{
		const meshes: THREE.Mesh[] = []
		const originalXSteps = dataShape[xIdx]; // Need this because it messes up the depthScale after repro
		const xSteps = remapTexture 
						? remapTexture.image.width 
						: dataShape[xIdx];
		const ySteps = remapTexture
						? remapTexture.image.height 
						: dataShape[yIdx];
		const zSteps = dataShape[zIdx];
		const aspectRatio = ySteps/xSteps; // This is not aspect ratio
		const depthRatio = zSteps/originalXSteps;
		for (const [_tsID, tsObj] of Object.entries(timeSeries)){
			const {normal, uv, color} = tsObj
			const position = normalToPos(uv, normal, {aspectRatio,depthRatio}, {xSteps, ySteps, zSteps})
			const meshScale = normalToScale(normal, {aspectRatio, depthRatio}, {xSteps, ySteps, zSteps})
			const thisColor = color.map((c: number) => Math.pow((c/255), 2.2)) // Gamma correct the color
			const material = new THREE.MeshBasicMaterial({color: new THREE.Color(...thisColor)})
			let geometry = new THREE.BoxGeometry(1,1,1)
			geometry.scale(...meshScale.toArray())
			const mesh = new THREE.Mesh(geometry, material)
			mesh.position.copy(position)
			meshes.push(mesh)
		}
		return meshes

	},[timeSeries, plotType])
	useEffect(() => {
		return () => {
			meshes.forEach(mesh => {
				mesh.geometry.dispose()
				//@ts-ignore TS thiunks this is a different material type
				mesh.material.dispose()
			});
		};}, [meshes]
	);
  return (
	<>
		{meshes.map((mesh, idx) => <primitive key={idx} object={mesh}/>)}
	</>
  )
}
