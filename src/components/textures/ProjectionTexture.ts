import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { usePlotStore } from '@/GlobalStates/PlotStore';
import { ArrayMinMax, linspace } from '@/utils/HelperFuncs';
import { useErrorStore } from '@/GlobalStates/ErrorStore';
import * as THREE from 'three';
import proj4 from 'proj4';
import { getAxisIndices } from '@/hooks/useAxisIndices';
import { useZarrStore } from '@/GlobalStates/ZarrStore';
import { getDimAxis, getAxisDimAxis} from '@/hooks';

export function checkProjString(projString: string){
    const {setError} = useErrorStore.getState()
    try{
        proj4(projString)
        return true
    } catch{
        setError('badProj')
        return false
    }
}

export function clearProjectionData(){
     useGlobalStore.setState({
        remapTexture: undefined,
        remapBorders: undefined,
     })
     usePlotStore.setState({
        nativeCRS: undefined,
        destCRS:undefined,
     })
}

export function resetProjection(){
    const {dimArrays, dimNames, dimUnits, shape} = useGlobalStore.getState()
    const {xSlice, ySlice} = useZarrStore.getState()
    usePlotStore.setState({ // Need to set this before getDimAxis()
        xSlice, 
        ySlice,
    })
    const {xArray, yArray} = getDimAxis()
    const xLength = xArray.length;
    const yLength = yArray.length;
    const aspectRatio = xLength/yLength;
    const newShape = new THREE.Vector3().copy(shape)
    newShape.y = 2/aspectRatio;
    useGlobalStore.setState({
        axisDimArrays: dimArrays,
        axisDimUnits: dimUnits,
        axisDimNames: dimNames,
        shape: newShape,
        remapTexture: undefined,
        remapBorders: undefined,
    })
    handleIrregularGrid()
}

function normalizeArray(array: number[], min?: number, max?: number): number[]{
    const len = array.length;
    if (!min || !max){
        min = Infinity, max = -Infinity;
        for (let i = 0; i < len; i++){
            const v = array[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    const range = max - min;
    const scaler = range === 0 ? 0 : 1 / range;
    const out = new Array<number>(len);
    for (let i = 0; i < array.length; i++){
        out[i] = (array[i]-min)* scaler;
    }
    return out;
}

function isUniformStep(array: number[]): boolean {
    const len = array.length;
    if (len < 3) return true; // any 0–2 element array trivially qualifies
    const step = Math.abs(array[1] - array[0]);
    if (step < 1e-12)return false; // Rejected really small steps to avod exploding vals
    let max = 0
    let min = 100
    for (let i = 2; i < len; i++) {
        const diff = Math.abs(array[i] - array[i - 1])
        max = Math.max(max, diff)
        min = Math.min(min, diff)
        if ((Math.abs(diff - step) / step) > 0.01) { // If its greater than a 1% divergence we can call it irregular
            return false;
        }
    }
    return true;
}

function createIrregularUV(
    xArray: Array<number>,
	yArray: Array<number>,
    flipY: boolean,
) {
    const width = xArray.length;
    const height = yArray.length;

    const data = new Uint16Array(width * height * 4);

    const [xMin, xMax] = ArrayMinMax(xArray)
    const [yMin, yMax] = ArrayMinMax(yArray)

    const xSpace = linspace(xMin, xMax, width);
    const ySpace = linspace(yMin, yMax, height);

    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            let x = xSpace[i]
            let y = ySpace[j]

            let xi = fractionalIndex(xArray, x);
            let yi = fractionalIndex(yArray, y);

            const u = ((xi ?? 0) + 0.5) / xArray.length;
            const v = ((yi ?? 0) + 0.5) / yArray.length;

            // Inverse for border Texture
            const ix = xArray[i]
            const iy = yArray[j]

            const iu = ((ix + 180) / 360) % 1;
            const iv = (iy+90) / 180;

            const idx = (j * width + i) * 4;
            data[idx]     = THREE.DataUtils.toHalfFloat(u); 
            data[idx + 1] = THREE.DataUtils.toHalfFloat(v);
            data[idx + 2] = THREE.DataUtils.toHalfFloat(iu);  
            data[idx + 3] = THREE.DataUtils.toHalfFloat(iv);
        }
    }
    const texture = new THREE.DataTexture(
		data,
		width,
		height,
		THREE.RGBAFormat,
		THREE.HalfFloatType,
	);
    texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = flipY;
    texture.needsUpdate = true;
    useGlobalStore.setState({remapBorders: texture})
}

function createInverseUV(
	xArray: Array<number>,
	yArray: Array<number>,
    is360: boolean,
	resolution : number
) {
	// Creates an inverse UV map: for each normalized (x, y) position,
	// stores the (i, j) index into xArray/yArray that best matches it.
	const width = resolution*2; 
	const height = resolution;

    //We assume all irregular grids are in degrees for now. 
	const normX = normalizeArray(xArray, is360? 0 : -180 , is360 ? 360 : 180);
	const normY = normalizeArray(yArray, -90, 90);
    const [xMin, xMax] = ArrayMinMax(normX);
    const [yMin, yMax] = ArrayMinMax(normY);

	const data = new Uint16Array(width * height * 4); // 4 for RGBA
	let ptr = 0;
	for (let j = 0; j < height; j++) {
		const vRaw = height > 1 ? j / (height) : 0;
		const v = vRaw;
		const jIdx = findNearestIndex(normY, v);
		const jNorm = yArray.length > 1 ? jIdx / (yArray.length) : 0;
        const vValid = v >= yMin && v <= yMax;
		for (let i = 0; i < width; i++) {
			const u = width > 1 ? i / (width) : 0;
			const iIdx = findNearestIndex(normX, u);
			const iNorm = xArray.length > 1 ? iIdx / (xArray.length) : 0;
            const uValid = u >= xMin && u <= xMax;

            const valid = uValid && vValid;
			data[ptr++] = THREE.DataUtils.toHalfFloat(iNorm);
			data[ptr++] = THREE.DataUtils.toHalfFloat(jNorm);
			data[ptr++] = THREE.DataUtils.toHalfFloat(valid ? 1 : 0); // Set Valid so can be used in same shader logic
			ptr++;
		}
	}

	const texture = new THREE.DataTexture(
		data,
		width,
		height,
		THREE.RGBAFormat,
		THREE.HalfFloatType,
	);
    texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
    // texture.flipY = flipY;
    texture.needsUpdate = true;
	return texture;
}

export function handleIrregularGrid(){
    // This is needed for Sphere and other projections where the grid is not uniform. It creates an array for the ticks and update for sphere
    const {xArray, yArray} = getAxisDimAxis();
    const {flipY} = useGlobalStore.getState()
    const isRegular = isUniformStep(xArray) && isUniformStep(yArray)
    if (isRegular) return;
    const {is360Deg, plotType} = usePlotStore.getState();
	if(plotType == 'sphere') {
        const texture = createInverseUV(xArray, yArray, is360Deg, 1024);
        useGlobalStore.setState({remapTexture:texture});
    } else createIrregularUV(xArray, yArray, flipY)
    return
}

export function sampleCRS(tex: THREE.DataTexture, u: number, v: number): [THREE.Vector2, boolean] {
    // Linearly interpolates a texture given UV
    const { data, width, height } = tex.image;
    if (!data) return [new THREE.Vector2(u, v), true];

    const facX = u * width - 1;
    const facY = v * height - 1;

    const x0 = Math.floor(facX);
    const y0 = Math.floor(facY);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    // Interpolation weights [0-1]
    const wx = facX - x0;
    const wy = facY - y0;

    // Clamp each corner to the texture bounds
    const clampX = (x: number) => Math.min(Math.max(x, 0), width - 1);
    const clampY = (y: number) => Math.min(Math.max(y, 0), height - 1);

    const cx0 = clampX(x0);
    const cx1 = clampX(x1);
    const cy0 = clampY(y0);
    const cy1 = clampY(y1);

    const getValues = (x: number, y: number) => {
        const idx = (y * width + x) * 4;
        return {
            u: THREE.DataUtils.fromHalfFloat(data[idx]),
            v: THREE.DataUtils.fromHalfFloat(data[idx + 1]),
            valid: THREE.DataUtils.fromHalfFloat(data[idx + 2]),
        };
    };

    const t00 = getValues(cx0, cy0);
    const t10 = getValues(cx1, cy0);
    const t01 = getValues(cx0, cy1);
    const t11 = getValues(cx1, cy1);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const newU = lerp(lerp(t00.u, t10.u, wx), lerp(t01.u, t11.u, wx), wy);
    const newV = lerp(lerp(t00.v, t10.v, wx), lerp(t01.v, t11.v, wx), wy);

    // Valid only if all four corners are valid
    const valid = t00.valid > 0 && t10.valid > 0 && t01.valid > 0 && t11.valid > 0;

    return [new THREE.Vector2(newU, newV), valid];
}

export function reproject(resolution: number = 256){
    const {nativeCRS, destCRS, plotType, is360Deg} = usePlotStore.getState()
	const {remapTexture, flipY } = useGlobalStore.getState()
    let {xArray, yArray} = getDimAxis();
	const insufficientCRS = !nativeCRS || !destCRS
    if (remapTexture) remapTexture.dispose();
    useGlobalStore.setState({
        remapTexture:undefined
    })
	if (insufficientCRS || plotType == 'sphere'){
		// If sphere, we check if irregularGrid. If so then create new texture. 
		handleIrregularGrid()
		return;
	}
    if (!checkProjString(destCRS) || !checkProjString(nativeCRS)) return; 
    const {xIdx, yIdx} = getAxisIndices()
    if (is360Deg) {
		xArray = remap360to180Monotonic(xArray) 
	}
    const width = xArray.length;
    const height = yArray.length;
    // We need the border points as the min/max of the old CRS won't always be the min/max of the new CRS
    const boundaryPoints: [number, number][] = [];
	
    for (let i = 0; i < width; i++) {
        boundaryPoints.push([xArray[i], yArray[0]]);
    }
    for (let i = 0; i < width; i++) {
        boundaryPoints.push([xArray[i], yArray[height - 1]]);
    }
    for (let j = 0; j < height; j++) {
        boundaryPoints.push([xArray[0], yArray[j]]);
    }
    for (let j = 0; j < height; j++) {
        boundaryPoints.push([xArray[width - 1], yArray[j]]);
    }
    const proj = proj4(nativeCRS, destCRS);
    let [minX, minY] = [Infinity, Infinity];
    let [maxX, maxY] = [-Infinity, -Infinity];
    // Get min/max of new CRS for new Axis'
    for (const [x, y] of boundaryPoints) {
        const [px, py] = proj.forward([x, y]);
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }    
    const xDiff = Math.abs(maxX - minX);
    const yDiff = Math.abs(maxY - minY);
    const aspectRatio = yDiff > 0 ? xDiff / yDiff : 1;
    function safeInverse(proj: any, xy: [number, number], tol = 1e-6) {
        // Proj4 clamps new CRS, won't return invalid values. Need to do an inverse run instead
        //This function checks if the coordinates are valid and returns 0 or 1 based on conditions
        const [lon, lat] = proj.inverse(xy);
        if (!isFinite(lon) || !isFinite(lat)) return [lon, lat, 0];
        const [xCheck, yCheck] = proj.forward([lon, lat]);
        if (Math.abs(xCheck - xy[0]) > tol * Math.max(1, Math.abs(xy[0])) ||
            Math.abs(yCheck - xy[1]) > tol * Math.max(1, Math.abs(xy[1]))) {
            return [lon, lat, 0];
        }
        return [lon, lat, 1];
    }
    // ---- Construct new CRS axis' ----//
    let adjustedResolution = resolution;

    let targetWidth: number;
    let targetHeight: number;
    let data: Uint16Array;
    let xTicks: Array<number>;
    let yTicks: Array<number>;
    if (plotType === 'point-cloud') {
        targetWidth = width;
        targetHeight = height;
        xTicks = linspace(minX, maxX, targetWidth);
        yTicks = flipY ? linspace(maxY, minY, targetHeight) : linspace(minY, maxY, targetHeight);
        data = new Uint16Array(targetWidth * targetHeight * 4);
        const xScaler = 1 / (maxX - minX);
        const yScaler = 1/ (maxY - minY);
        for (let j = 0; j < targetHeight; j++) {
            const y = yArray[j];
            for (let i = 0; i < targetWidth; i++) {
                const x = xArray[i];
                const [px, py] = proj.forward([x, y]);
                const valid = Number(isFinite(px) && isFinite(py))

                const u = (px - minX) * xScaler;
                const v = (py - minY) * yScaler;

                const idx = (j * targetWidth + i) * 4;
                data[idx]     = THREE.DataUtils.toHalfFloat(u);  
                data[idx + 1] = THREE.DataUtils.toHalfFloat(v);
                data[idx + 2] = THREE.DataUtils.toHalfFloat(valid);
            }
        }
    } else {
        targetWidth = Math.ceil(adjustedResolution * aspectRatio);
        targetHeight = adjustedResolution;
        xTicks = linspace(minX, maxX, targetWidth) 
        yTicks = flipY 
            ? linspace(maxY, minY, targetHeight)
            : linspace(minY, maxY, targetHeight)

        data = new Uint16Array(targetWidth * targetHeight * 4);
        for (let j = 0; j < targetHeight; j++) {
            for (let i = 0; i < targetWidth; i++) {
                const [x, y, valid] = safeInverse(proj, [xTicks[i], yTicks[j]]);
                const xi = fractionalIndex(xArray, x);
                const yi = fractionalIndex(yArray, y);

                const inBounds = valid === 1 &&
                    xi !== null &&yi !== null &&
                    Number.isFinite(xi) && Number.isFinite(yi);
                let u = 0, v = 0;
                if (inBounds) {
                    u = (xi + 0.5) / xArray.length;
                    v = (yi + 0.5) / yArray.length;
                }
                const idx = (j * targetWidth + i) * 4;
                data[idx]     = THREE.DataUtils.toHalfFloat(u); 
                data[idx + 1] = THREE.DataUtils.toHalfFloat(v);
                data[idx + 2] = THREE.DataUtils.toHalfFloat(Number(inBounds));
            }  
        }
    }       
    
    const texture = new THREE.DataTexture(
        data,
        targetWidth,
        targetHeight,
        THREE.RGBAFormat, // Must be RGBA as HalfFloat RGB is not supported
        THREE.HalfFloatType
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    if (remapTexture) remapTexture.dispose();
    useGlobalStore.setState({remapTexture: texture})
    // ---- Update Axis and Shape information ----//
    const crsCheck = proj4(destCRS);
    const {axisDimArrays, axisDimUnits, axisDimNames, shape} = useGlobalStore.getState()
    const newAxisDimArrays = [...axisDimArrays];
    newAxisDimArrays[xIdx] = xTicks;
    newAxisDimArrays[yIdx] = yTicks;
    const newAxisDimUnits = [...axisDimUnits];
    const targetUnits = (crsCheck.oProj as any)?.units;
    //@ts-ignore At this point these are all valid
    newAxisDimUnits[xIdx] = targetUnits;
    //@ts-ignore At this point these are all valid
    newAxisDimUnits[yIdx] = targetUnits;

    const newAxisDimNames = [...axisDimNames];
    newAxisDimNames[xIdx] = 'X';
    newAxisDimNames[yIdx] = 'Y';
    const newShape = new THREE.Vector3().copy(shape)
    newShape.y = 2/aspectRatio;
    useGlobalStore.setState({
        axisDimArrays: newAxisDimArrays, 
        axisDimUnits: newAxisDimUnits, 
        axisDimNames: newAxisDimNames,
        shape: newShape
    })
    usePlotStore.setState({
        xSlice: [0, null],
        ySlice: [0, null],
    })
}


function remap360to180Monotonic(arr: number[]) {
    const wrapped = arr.map(v => ((v + 180) % 360 + 360) % 360 - 180);
    const sorted = wrapped.sort((a, b) => a - b);

    return sorted;
}

function bracketInterval(arr: number[], value: number) {
    // Gets indices in an array that border a value within that arrays bounds
    const n = arr.length;
    if (n <= 1) return { lo: 0, hi: 0 };

    const ascending = arr[0] <= arr[n - 1];
    let lo = 0;
    let hi = n - 1;

    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const midVal = arr[mid];

        if (ascending ? midVal < value : midVal > value) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    return { lo, hi };
}

function findNearestIndex(arr: number[], target: number): number {
	const { lo, hi } = bracketInterval(arr, target);

    return Math.abs(arr[lo] - target) <= Math.abs(arr[hi] - target)
        ? lo
        : hi;
}

function fractionalIndex(coords: number[], value: number) {
    const n = coords.length;
    if (n === 1) return 0;

    const ascending = coords[0] <= coords[n - 1];
    // Bounds check
    if (ascending) {
        if (value < coords[0] || value > coords[n - 1]) return null;
    } else {
        if (value > coords[0] || value < coords[n - 1]) return null;
    }

    const { lo, hi } = bracketInterval(coords, value);

    const a = coords[lo];
    const b = coords[hi];

    return lo + (value - a) / (b - a);
}

