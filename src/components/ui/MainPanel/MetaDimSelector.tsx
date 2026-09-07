"use client";

import React, { useMemo, useState, useEffect, createContext, useContext, useCallback } from 'react';
import { createStore, useStore } from 'zustand';
import DimSlicer, { Axis, defaultSelection, DimOption, SliceSelectionState } from '@/components/ui/DimSlicer';
import { defaultAttributes, renderAttributes } from "@/components/ui/MetaData";
import { Button } from '@/components/ui/button-enhanced';
import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { useShallow } from 'zustand/shallow';
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge, Switch, Input, Hider } from "@/components/ui";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { parseLoc } from '@/utils/HelperFuncs';
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useIsMobile } from "@/hooks/use-mobile";
import { useCacheStore } from "@/GlobalStates/CacheStore";
import { usePlotStore } from '@/GlobalStates/PlotStore';
import { useZarrStore } from '@/GlobalStates/ZarrStore';
import { SliderThumbs } from "@/components/ui/Widgets/SliderThumbs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BsFillQuestionCircleFill } from "react-icons/bs";
import { clearProjectionData } from '@/components/textures/ProjectionTexture';

const MAX_ACTIVE_DIMS = 3;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

interface DimInfo {
  dimArrays: ArrayLike<number>[];
  dimNames: string[];
  dimUnits: (string | null)[];
}

type Props = {
  meta: {
    name?: string;
    shape?: number[];
    chunks?: number[];
    totalSize?: number;
    dtype?: string;
    long_name?: string;
    dimInfo?: DimInfo;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
  onApply?: (sels: SliceSelectionState[], axes: Axis[], dimNames: string[]) => void;
};

const AXIS_COLOR: Record<Axis, string> = {
  x: 'text-pink-500',
  y: 'text-green-500',
  z: 'text-blue-500',
  c: 'text-yellow-500',
};

interface SlicerRow {
  dimName: string;
  sel: SliceSelectionState;
}

// "lat::1" -> 1
const getOrigIdx = (dimName: string) => parseInt(dimName.split('::').pop() ?? '');

// Positionally derives spatial axis ('z' | 'y' | 'x') from a row's index among active rows
const getActiveAxis = (index: number, totalRows: number): Axis => {
  const axes: Axis[] = ['z', 'y', 'x'];
  return axes[axes.length - totalRows + index] ?? 'x';
};

interface ParsedSliceRange {
  first: number;
  last: number;
  steps: number;
}

const parseSliceRange = (sel: SliceSelectionState | undefined, defaultSize: number): ParsedSliceRange => {
  if (!sel) return { first: 0, last: defaultSize, steps: Math.max(1, defaultSize) };
  if (sel.mode === 'scalar') {
    const val = parseInt(sel.scalar) || 0;
    return { first: val, last: val + 1, steps: 1 };
  }
  const start = parseInt(sel.start) || 0;
  let stop = parseInt(sel.stop);
  if (isNaN(stop)) stop = defaultSize;
  else stop = Math.min(stop + 1, defaultSize > 0 ? defaultSize : stop + 1);
  return { first: start, last: stop, steps: Math.max(1, stop - start) };
};

// Shared by MetaStatusBadges, the cache-status effect, and handlePlot — all three
// need "which row is currently z/y/x" plus each row's original dim index.
const getRowByAxis = (rows: SlicerRow[], axis: Axis) => {
  const idx = rows.findIndex((_, i) => getActiveAxis(i, rows.length) === axis);
  return idx >= 0 ? rows[idx] : undefined;
};

const getAxisRows = (rows: SlicerRow[]) => {
  const rowZ = getRowByAxis(rows, 'z');
  const rowY = getRowByAxis(rows, 'y');
  const rowX = getRowByAxis(rows, 'x');
  return {
    rowZ, rowY, rowX,
    origIdxZ: rowZ ? getOrigIdx(rowZ.dimName) : -1,
    origIdxY: rowY ? getOrigIdx(rowY.dimName) : -1,
    origIdxX: rowX ? getOrigIdx(rowX.dimName) : -1,
  };
};

// --- SCOPED STATE ISOLATION STORE ---
// Slider drags update this store, not the parent's React state, so dragging a
// slice range doesn't re-render the whole panel — only the isolated sub-components below.
interface SelectorStoreState {
  rows: SlicerRow[];
  collapsedSels: Record<string, SliceSelectionState>;
  updateDimName: (oldDimName: string, newDimName: string, availableDims: DimOption[], dataShape: number[]) => void;
  updateSel: (dimName: string, sel: SliceSelectionState) => void;
  updateCollapsedSel: (dimName: string, sel: SliceSelectionState) => void;
  addRow: (availableDims: DimOption[], dataShape: number[]) => void;
  removeLastRow: () => void;
}

type SelectorStore = ReturnType<typeof createMetaSelectorStore>;

const getDimShape = (availableDims: DimOption[], dataShape: number[], dimName: string): number => {
  const idx = availableDims.findIndex((d) => d.name === dimName);
  return dataShape[idx] ?? availableDims[idx]?.size ?? 0;
};

const createMetaSelectorStore = (initialRows: SlicerRow[], initialCollapsed: Record<string, SliceSelectionState>) =>
  createStore<SelectorStoreState>((set) => ({
    rows: initialRows,
    collapsedSels: initialCollapsed,

    updateDimName: (oldDimName, newDimName, availableDims, dataShape) => {
      if (oldDimName === newDimName) return;
      set((state) => {
        const newShape = getDimShape(availableDims, dataShape, newDimName);
        const isSwap = state.rows.some((r) => r.dimName === newDimName);

        if (!isSwap) {
          return {
            rows: state.rows.map((r) =>
              r.dimName === oldDimName ? { dimName: newDimName, sel: defaultSelection(newShape) } : r
            ),
          };
        }

        const oldShape = getDimShape(availableDims, dataShape, oldDimName);
        return {
          rows: state.rows.map((r) => {
            if (r.dimName === oldDimName) return { dimName: newDimName, sel: defaultSelection(newShape) };
            if (r.dimName === newDimName) return { dimName: oldDimName, sel: defaultSelection(oldShape) };
            return r;
          }),
        };
      });
    },

    updateSel: (dimName, sel) =>
      set((state) => ({
        rows: state.rows.map((r) => (r.dimName === dimName ? { ...r, sel: { ...sel, mode: 'slice' } } : r)),
      })),

    updateCollapsedSel: (dimName, sel) =>
      set((state) => ({
        collapsedSels: { ...state.collapsedSels, [dimName]: { ...sel, mode: 'scalar' } },
      })),

    addRow: (availableDims, dataShape) =>
      set((state) => {
        if (state.rows.length >= MAX_ACTIVE_DIMS) return state;
        const used = new Set(state.rows.map((r) => r.dimName));
        const dim = availableDims.find((d) => !used.has(d.name));
        if (!dim) return state;
        const shape = getDimShape(availableDims, dataShape, dim.name);
        return { rows: [...state.rows, { dimName: dim.name, sel: defaultSelection(shape) }] };
      }),

    removeLastRow: () => set((state) => ({ rows: state.rows.slice(0, -1) })),
  }));

const MetaSelectorContext = createContext<SelectorStore | null>(null);

const useMetaSelectorStore = <T,>(selector: (state: SelectorStoreState) => T): T => {
  const store = useContext(MetaSelectorContext);
  if (!store) throw new Error("MetaSelectorContext missing");
  return useStore(store, selector);
};

// --- ISOLATED SUB-COMPONENTS ---

const MetaStatusBadges: React.FC<{
  meta: Props['meta'];
  availableDims: DimOption[];
  cacheSize: number;
  setCacheSize: React.Dispatch<React.SetStateAction<number>>;
  setDataSize: React.Dispatch<React.SetStateAction<number>>;
}> = React.memo(({ meta, availableDims, cacheSize, setCacheSize, setDataSize }) => {
  const {rows, collapsedSels} = useMetaSelectorStore((s) => s);

  const {initStore, idx4D} = useGlobalStore((s) => s);
  const {cache, maxSize} = useCacheStore((s) => s);
  const {compress, coarsen, kernelSize, kernelDepth} = useZarrStore((s) => s);
  const {maxTextureSize, max3DTextureSize} = usePlotStore((s) => s);

  const dataShape = meta?.shape || [];
  const dtype = meta.totalSize ? Math.round(meta.totalSize/dataShape.reduce((a,b) => a * b, 1)) : 4

  const sizeData = useMemo(()=>{
	let prod = 1;
	const sizes = []
	// ---- Get total Size ----//
	for (const [_key, value] of Object.entries(rows)) {
		if (value.sel.mode != 'slice') continue;
		const idx = getOrigIdx(value.dimName)
		const start = parseInt(value.sel.start)
		let stop = parseInt(value.sel.stop)
		stop = Number.isFinite(stop) ? stop : dataShape[idx]
		const size = Math.abs(stop-start)
		sizes.push(size)
		prod *= size
	}
	// ---- Get Texture Counts ---- //
	const is2D = sizes.length == 2;
	const texSize = is2D ? maxTextureSize : max3DTextureSize;
	let texProd = 1;
	for (const size of sizes){
		const texCount = Math.ceil(size/texSize);
		texProd *= texCount;
	}
	// ---- Apply Coarsen ---- //
	if (coarsen){
		prod /= Math.pow(kernelSize,2)
		if (!is2D) prod /= kernelDepth
		prod = Math.round(prod)
	}
	return{
		size: prod * dtype, texCount:texProd
	}
  },[rows, coarsen, kernelSize, kernelDepth])

  const currentSize = sizeData.size;
  const texCount = sizeData.texCount;
  const tooBig = texCount > 12;
  const cachedSize = useMemo(() => {
    const cachedSize = currentSize * 2/dtype;
    setDataSize(cachedSize);
    return cachedSize;
  }, [currentSize, meta]);

  const smallCache = cachedSize > cacheSize;
  const [cachedChunks, setCachedChunks] = useState<string | null>(null);

  useEffect(() => {
    let newCached = false;
    let newCachedChunks: string | null = null;

    if (meta && meta.chunks && meta.shape) {
      const ndSlicesTemp = availableDims.map((d) => {
        const activeRow = rows.find((r) => r.dimName === d.name);
        if (activeRow) {
          const range = parseSliceRange(activeRow.sel, d.size);
          return [range.first, range.last] as [number, number];
        }
        const colSel = collapsedSels[d.name];
        return colSel && colSel.mode === 'scalar' ? parseInt(colSel.scalar) || 0 : 0;
      });

      const scalarIndices = ndSlicesTemp.filter((s) => typeof s === "number").join("_");
      let cacheBase = scalarIndices !== "" ? `${initStore}_${meta.name}_${scalarIndices}` : `${initStore}_${meta.name}`;
      if (meta.shape.length >= 4 && idx4D !== undefined && idx4D !== null) {
        cacheBase = `${cacheBase}_time${idx4D}`;
      }

      const { rowZ, rowY, rowX, origIdxZ, origIdxY, origIdxX } = getAxisRows(rows);

      // Which chunk indices (in dim units, not element units) a slice range touches
      const calcDim = (sel: SliceSelectionState | undefined, dimIdx: number) => {
        if (dimIdx < 0) return { start: 0, end: 1 };
        const chunkDim = meta.chunks?.[dimIdx];
        if (!chunkDim) return { start: 0, end: 1 };
        const { first, last } = parseSliceRange(sel, meta.shape?.[dimIdx] ?? 1);
        return { start: Math.floor(first / chunkDim), end: Math.ceil(last / chunkDim) };
      };

      const zDim = calcDim(rowZ?.sel, origIdxZ);
      const yDim = calcDim(rowY?.sel, origIdxY);
      const xDim = calcDim(rowX?.sel, origIdxX);

      let accum = 0;
      let total = 0;
      for (let z = zDim.start; z < zDim.end; z++) {
        for (let y = yDim.start; y < yDim.end; y++) {
          for (let x = xDim.start; x < xDim.end; x++) {
            total++;
            if (cache.has(`${cacheBase}_chunk_z${z}_y${y}_x${x}`)) accum++;
          }
        }
      }

      if (total > 0 && accum > 0) {
        newCachedChunks = `${accum}/${total}`;
        newCached = true;
      } else if (cache.has(`${initStore}_${meta.name}`)) {
        newCached = true;
      }
    } else if (meta && cache.has(`${initStore}_${meta.name}`)) {
      newCached = true;
    }
    setCachedChunks((prev) => (prev !== newCachedChunks ? newCachedChunks : prev));
  }, [meta, cache, initStore, rows, collapsedSels, availableDims]);

  return (
    <div className="flex flex-col gap-2">
      {/* Size info badge */}
      <div className="flex items-center gap-2 text-xs bg-background border px-2 py-1 rounded-md shadow-sm w-fit">
        <span className="text-muted-foreground">Raw:</span> <span className="font-medium">{formatBytes(currentSize)}</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="text-muted-foreground">Stored:</span> <span className="font-medium">{compress ? "<" : ""}{formatBytes(cachedSize)}</span>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-1 text-xs">
        {tooBig && (
          <span className="font-medium text-destructive">
            Too many textures ({texCount}/12). Won&apos;t fit.
          </span>
        )}
        {cachedChunks && (
          <span className="font-medium text-muted-foreground">
            {`${cachedChunks} chunks already cached`}
          </span>
        )}
      </div>

      {/* Cache expand UI if needed */}
      {currentSize > maxSize && (
        <Alert variant={smallCache ? "destructive" : "default"} className="mt-2 w-full border-0">
          {smallCache ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          <AlertTitle>
            {smallCache ? "Selection won't fit in Cache" : "Data Will Fit"}
          </AlertTitle>
          <AlertDescription className="w-full min-w-0">
            <div className="flex flex-col gap-3 mt-1 w-full min-w-0">
              <span className="leading-none text-muted-foreground break-words">Decrease selection or expand cache size</span>
              <div className="flex items-center gap-4 w-full min-w-0">
                <SliderThumbs
                  id="newCache-size"
                  min={200}
                  max={1200}
                  value={[cacheSize / (1024 * 1024)]}
                  step={10}
                  onValueChange={(e) => setCacheSize(e[0] * (1024 * 1024))}
                  className="flex-1 min-w-0"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    className="w-[70px] h-[28px] text-xs no-spinner"
                    type="number"
                    min={200}
                    step={20}
                    value={cacheSize / (1024 * 1024)}
                    onChange={(e) => setCacheSize(parseInt(e.target.value) * (1024 * 1024))}
                  />
                  <span className="text-xs font-semibold">MB</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <BsFillQuestionCircleFill className="ml-1 text-muted-foreground hover:text-foreground transition-colors cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Increasing this too far can cause crashes. Mobile users beware
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
});

const MetaDimTable: React.FC<{
  availableDims: DimOption[];
  dataShape: number[];
  chunkShape: number[];
}> = React.memo(({ availableDims, dataShape, chunkShape }) => {
  const {rows, collapsedSels} = useMetaSelectorStore((s) => s);

  return (
    <div className="mt-2 border rounded-md overflow-hidden text-xs bg-background shadow-sm w-full min-w-0">
      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full text-left border-collapse break-words whitespace-normal">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium border-b">Dim</th>
              <th className="px-3 py-2 font-medium border-b">Axis</th>
              <th className="px-3 py-2 font-medium border-b">Selection</th>
              <th className="px-3 py-2 font-medium border-b">Data Shape</th>
              <th className="px-3 py-2 font-medium border-b">Chunk Shape</th>
            </tr>
          </thead>
          <tbody>
            {availableDims.map((dim, originalIndex) => {
              const activeIndex = rows.findIndex((r) => r.dimName === dim.name);
              const activeRow = activeIndex >= 0 ? rows[activeIndex] : undefined;
              const sel = activeRow ? activeRow.sel : collapsedSels[dim.name];
              const range = !sel ? '?' : sel.mode === 'scalar' ? sel.scalar || '0' : `${sel.start !== '' ? sel.start : '0'}:${sel.stop !== '' ? sel.stop : ':'}`;
              const axis = activeIndex >= 0 ? getActiveAxis(activeIndex, rows.length) : 'c';
              const dataSize = dataShape[originalIndex] ?? '?';
              const chunkSize = chunkShape[originalIndex] ?? '?';

              return (
                <tr key={dim.name} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-1.5 font-medium">{dim.name}</td>
                  <td className={`px-3 py-1.5 font-bold ${AXIS_COLOR[axis] ?? 'text-muted-foreground'}`}>{axis.toUpperCase()}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{range}</td>
                  <td className="px-3 py-1.5">{dataSize}</td>
                  <td className="px-3 py-1.5">{chunkSize}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const MetaActiveSlicers: React.FC<{
  availableDims: DimOption[];
  dataShape: number[];
}> = React.memo(({ availableDims, dataShape }) => {
	const rows = useMetaSelectorStore((s) => s.rows);
	const updateDimNameAction = useMetaSelectorStore((s) => s.updateDimName);
	const updateSelAction = useMetaSelectorStore((s) => s.updateSel);
	const removeLastRow = useMetaSelectorStore((s) => s.removeLastRow);

	const handleDimChange = useCallback(
		(dimName: string, newName: string) =>
			updateDimNameAction(dimName, newName, availableDims, dataShape),
		[availableDims, dataShape]
	);

	const handleSelChange = useCallback(
		(dimName: string, sel: SliceSelectionState) => updateSelAction(dimName, sel),
		[] // updateSelAction should itself be stable
	);

	const dimByName = useMemo(
		() => new Map(availableDims.map((d) => [d.name, d])),
		[availableDims]
	);

	return (
		<div className="space-y-3">
		{rows.map((row, i) => {
			const dim = dimByName.get(row.dimName);
			const isLast = i === rows.length - 1;
			const axis = getActiveAxis(i, rows.length);
			return (
			<DimSlicer
				key={row.dimName}
				availableDims={availableDims}
				dimName={row.dimName}
				onDimChange={handleDimChange}
				onRemove={isLast && rows.length > 1 ? removeLastRow : undefined}
				dimSize={dim?.size ?? 0}
				selection={row.sel}
				axis={axis}
				onChange={handleSelChange}
				values={dim?.values}
				formatValue={dim?.formatValue}
				lockMode="slice"
			/>
			);
		})}
		</div>
	);
});

const MetaCollapsedSlicers: React.FC<{
  availableDims: DimOption[];
}> = React.memo(({ availableDims }) => {

	const {rows, collapsedSels, updateCollapsedSel} = useMetaSelectorStore(s=>s)

	const [collapsedOpen, setCollapsedOpen] = useState(false);

	const activeDimNames = new Set(rows.map((r) => r.dimName));
	const collapsedDims = availableDims.filter((d) => !activeDimNames.has(d.name));
	const handleSelChange = useCallback(
		(dimName: string, sel: SliceSelectionState) => updateCollapsedSel(dimName, sel),
		[updateCollapsedSel] 
	);
  if (collapsedDims.length === 0) return null;

  return (
    <div className="mt-6 mb-2">
      <button
        onClick={() => setCollapsedOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {collapsedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Collapsed dimensions
        <span className="ml-1 text-muted-foreground/60 text-xs font-normal bg-muted px-1.5 py-0.5 rounded-full">{collapsedDims.length}</span>
      </button>

      {collapsedOpen && (
        <div className="space-y-3 mt-3 ml-2 border-l-2 border-muted pl-4">
          {collapsedDims.map((dim) => (
            <DimSlicer
              key={dim.name}
              availableDims={availableDims}
              dimName={dim.name}
              onDimChange={() => { }}
              dimSize={dim.size}
              selection={collapsedSels[dim.name] ?? { ...defaultSelection(dim.size), mode: 'scalar' }}
              axis="c"
              onChange={handleSelChange}
              values={dim.values}
              formatValue={dim.formatValue}
              lockMode="scalar"
            />
          ))}
        </div>
      )}
    </div>
  );
});

const MetaAddDimensionControl: React.FC<{
  availableDims: DimOption[];
  dataShape: number[];
}> = React.memo(({ availableDims, dataShape }) => {
  const rows = useMetaSelectorStore((s) => s.rows);
  const addRowAction = useMetaSelectorStore((s) => s.addRow);

  const activeDimNames = new Set(rows.map((r) => r.dimName));
  const collapsedDims = availableDims.filter((d) => !activeDimNames.has(d.name));

  const atMax = rows.length >= MAX_ACTIVE_DIMS;
  const noUnused = collapsedDims.length === 0;
  const canAdd = !atMax && !noUnused;

  const addTooltip = atMax
    ? `Maximum of ${MAX_ACTIVE_DIMS} dimensions, remove one before adding another.`
    : noUnused
      ? 'All dimensions are already active.'
      : undefined;

  return (
    <div className="relative group">
      <button
        onClick={() => addRowAction(availableDims, dataShape)}
        disabled={!canAdd}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer border border-transparent hover:border-border"
        aria-label="Add dimension"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="7" y1="2" x2="7" y2="12" />
          <line x1="2" y1="7" x2="12" y2="7" />
        </svg>
        Add dimension
      </button>

      {addTooltip && (
        <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-10">
          <div className="rounded bg-popover border border-border px-2 py-1.5 text-xs text-popover-foreground shadow-sm w-64 text-center">
            {addTooltip}
          </div>
        </div>
      )}
    </div>
  );
});

export default function MetaDimSelector({ meta, metadata, onApply }: Props) {
	const isMobile = useIsMobile();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const { dimArrays, dimNames, dimUnits } = useMemo(() => ({
		dimArrays: (meta?.dimInfo?.dimArrays ?? []).map((a) => Array.from(a)),
		dimNames: meta?.dimInfo?.dimNames ?? [],
		dimUnits: (meta?.dimInfo?.dimUnits ?? []).map((u) => u ?? ''),
	}), [meta?.dimInfo]);

	const dataShape = meta?.shape || [];
	const chunkShape = meta?.chunks || [];
	
	const { setDimArrays, setDimNames, setDimUnits, setVariable, variable } = useGlobalStore(useShallow(s => s));
	const { maxSize, setMaxSize } = useCacheStore(useShallow(s => s))
	const { ndSlices, axisMapping, ReFetch, compress, setCompress, coarsen, setCoarsen, kernelSize, setKernelSize, kernelDepth, setKernelDepth } = useZarrStore(
    useShallow(s => s))
	const [cacheSize, setCacheSize] = useState(maxSize);
  const [dataSize, setDataSize] = useState(maxSize)
	const [displaySpat, setDisplaySpat] = useState(String(kernelSize));
	const [displayDepth, setDisplayDepth] = useState(String(kernelDepth));
  const smallCache = dataSize > cacheSize;
	const availableDims: DimOption[] = useMemo(
		() =>
		dimArrays.map((values, idx) => {
			const baseName = dimNames[idx] ?? `dim${idx}`;
			const name = `${baseName}::${idx}`;
			const label = baseName;
			const unit = dimUnits[idx] || undefined;
			return {
			name,
			label,
			size: values.length,
			values,
			formatValue: (v: number): string => String(parseLoc(v, unit)),
			};
		}),
	[dimArrays, dimNames, dimUnits]);
	const dimsKey = availableDims.map((d) => `${d.name}:${d.size}`).join('|');

	const initialCollapsed = useMemo(() => {
		const isCurrentVar = variable === meta.name && ndSlices && ndSlices.length === availableDims.length;
		return Object.fromEntries(
		availableDims.map((d, i) => {
			let sel: SliceSelectionState = { ...defaultSelection(d.size), mode: 'scalar' };
			if (isCurrentVar) {
			const s = ndSlices[i];
			if (typeof s === 'number') {
				sel = { start: '', stop: '', scalar: String(s), mode: 'scalar' };
			}
			}
			return [d.name, sel];
		})
		);
	}, [availableDims, variable, meta.name, ndSlices]);

	const initialRows = useMemo(() => {
		const isCurrentVar = variable === meta.name && ndSlices && ndSlices.length === availableDims.length && axisMapping;

		if (isCurrentVar) {
		const initRows: SlicerRow[] = [];
		const axes: Axis[] = ['z', 'y', 'x'];
		const seenNames = new Set<string>();

		for (const axis of axes) {
			const mappedIdx = (axisMapping as Record<string, number>)[axis];
			if (mappedIdx !== undefined && mappedIdx >= 0 && mappedIdx < availableDims.length) {
			const dim = availableDims[mappedIdx];
			if (!seenNames.has(dim.name)) {
				seenNames.add(dim.name);
				const s = ndSlices[mappedIdx];
				const dimShape = dataShape[mappedIdx] ?? dim.size;
				let sel = defaultSelection(dimShape);
				if (Array.isArray(s)) {
				sel = { start: String(s[0]), stop: s[1] !== null ? String(s[1]) : '', scalar: '', mode: 'slice' };
				}
				initRows.push({ dimName: dim.name, sel });
			}
			}
		}

		if (initRows.length > 0) return initRows;
		}

		const activeDims = availableDims.slice(-Math.min(MAX_ACTIVE_DIMS, availableDims.length));
		return activeDims.map((d) => {
			const dimShape = dataShape[availableDims.indexOf(d)] ?? d.size;
		return {
			dimName: d.name,
			sel: defaultSelection(dimShape),
		};
		});
		}, [availableDims, variable, meta.name, ndSlices, axisMapping, dataShape]);

	// Re-created (clean slate) whenever the active variable's dimensions change
	const selectorStore = useMemo(
		() => createMetaSelectorStore(initialRows, initialCollapsed),
		[dimsKey]
	);

	useEffect(() => {
		setCompress(false);
	}, [meta?.name, setCompress]);

	function setTextureDepths(){
		const {rows} = selectorStore.getState()
		const {maxTextureSize, max3DTextureSize} = usePlotStore.getState()
		const { rowZ, rowY, rowX, origIdxZ, origIdxY, origIdxX } = getAxisRows(rows);
		const is2D = dataShape.length === 2 || !rowZ;

		const lenZ = origIdxZ >= 0 ? dataShape[origIdxZ] : 1;
		const lenY = origIdxY >= 0 ? dataShape[origIdxY] : 1;
		const lenX = origIdxX >= 0 ? dataShape[origIdxX] : 1;

		const z = is2D ? { first: 0, last: 1, steps: 1 } : parseSliceRange(rowZ?.sel, lenZ);
		const y = parseSliceRange(rowY?.sel, lenY);
		const x = parseSliceRange(rowX?.sel, lenX);

		const maxSizeLimit = is2D ? maxTextureSize : max3DTextureSize;
		const texCounts = [z.steps / maxSizeLimit, y.steps / maxSizeLimit, x.steps / maxSizeLimit];

		const depths = texCounts.some((count) => count > 1)
		? texCounts.map((val) => Math.ceil(val))
		: [1, 1, 1];
		useGlobalStore.setState({textureArrayDepths:depths})
  	}

  const handlePlot = () => {
    const { rows, collapsedSels } = selectorStore.getState();

    setDimArrays(dimArrays);
    setDimNames(dimNames);
    setDimUnits(dimUnits);

    const { rowZ, rowY, rowX } = getAxisRows(rows);

    const ndSlices: (number | [number, number | null])[] = availableDims.map((dim, idx) => {
      const dimShape = dataShape ? dataShape[idx] ?? dim.size : dim.size;
      const row = rows.find((r) => r.dimName === dim.name);
      if (row) {
        if (row.sel.mode === 'scalar') return parseInt(row.sel.scalar) || 0;
        const range = parseSliceRange(row.sel, dimShape);
        return range.last === dimShape ? [range.first, null] : [range.first, range.last];
      }
      const colSel = collapsedSels[dim.name];
      if (colSel && colSel.mode === 'scalar') return parseInt(colSel.scalar) || 0;
      return 0;
    });

    const axisMapping = {
      x: getOrigIdx(rowX?.dimName || ''),
      y: getOrigIdx(rowY?.dimName || ''),
      z: getOrigIdx(rowZ?.dimName || '')
    };

    useZarrStore.setState({ndSlices, axisMapping})

    const activeDimNames = new Set(rows.map((r) => r.dimName));
    const collapsedDims = availableDims.filter((d) => !activeDimNames.has(d.name));

    if (collapsedDims.length > 0) {
      const firstCollapsed = collapsedDims[0];
      const sel = collapsedSels[firstCollapsed.name];
      if (sel && sel.mode === 'scalar') {
        useGlobalStore.getState().setIdx4D(parseInt(sel.scalar) || 0);
      }
    }

    if (variable === meta.name) {
      ReFetch();
    } else {
      setMaxSize(cacheSize);
      setVariable(meta.name || '');
      clearProjectionData()
      ReFetch();
    }

    usePlotStore.setState({ coarsen, kernel: { kernelDepth, kernelSize } });
	setTextureDepths();
    onApply?.(
      rows.map((r) => r.sel),
      rows.map((_, i) => getActiveAxis(i, rows.length)),
      rows.map((r) => r.dimName)
    );
  };

  return (
    <MetaSelectorContext.Provider value={selectorStore}>
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex flex-col gap-4 mb-2 min-w-0">
          <div className="flex flex-col gap-3 w-full min-w-0">
            <div className="flex items-center gap-2">
              <b className="text-base">{`${meta.long_name ?? meta.name ?? ''} `}</b>
              {mounted && isMobile ? (
                <Dialog>
                  <DialogTrigger className="cursor-pointer" asChild>
                    <Badge variant="default" className="block">Attributes</Badge>
                  </DialogTrigger>
                  <DialogContent className="metadata-dialog">
                    <DialogHeader>
                      <DialogTitle>Attributes</DialogTitle>
                      <DialogDescription className="sr-only">Metadata Information for variable</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] text-[12px] overflow-y-auto break-words p-0">
                      <div className="grid grid-cols-1 md:grid-cols-[max-content_1fr] gap-x-1 gap-y-[6px]">
                        {renderAttributes(metadata, defaultAttributes)}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : (
                <Popover>
                  <PopoverTrigger className="cursor-pointer" asChild>
                    <Badge variant="default" className="block">Attributes</Badge>
                  </PopoverTrigger>
                  <PopoverContent
                    data-meta-popover
                    className="w-[300px] max-h-[50vh] overflow-y-auto"
                    align="center"
                  >
                    {renderAttributes(metadata, defaultAttributes)}
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm w-full min-w-0">
              <div className="flex items-center gap-2">
                <label htmlFor="coarsen" className="font-semibold cursor-pointer">Coarsen</label>
                <Switch id="coarsen" checked={coarsen} onCheckedChange={(e) => setCoarsen(e)} />
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="compress-data" className="font-semibold cursor-pointer flex items-center">
                  Compress
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <BsFillQuestionCircleFill className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[min(100%,16rem)] break-words whitespace-normal">
                      Compress data to preserve memory at the expense of slightly longer load times
                    </TooltipContent>
                  </Tooltip>
                </label>
                <Switch id="compress-data" checked={compress} onCheckedChange={(e) => setCompress(e)} />
              </div>

              <div className="flex items-center justify-end ml-auto min-w-0">
                <Button
                  disabled={smallCache}
                  variant={'pink'}
                  className="cursor-pointer hover:scale-[1.05] shadow-sm h-8 px-4"
                  onClick={handlePlot}
                >
                  Plot
                </Button>
              </div>
            </div>

            <MetaStatusBadges
              meta={meta}
              availableDims={availableDims}
              cacheSize={cacheSize}
              setCacheSize={setCacheSize}
              setDataSize={setDataSize}
            />
          </div>

          <Hider show={coarsen}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2 bg-background p-3 rounded-md border text-sm">
              <div
                className="flex items-center justify-between sm:justify-start sm:gap-4"
                style={{ visibility: dataShape.length >= 3 ? 'visible' : 'hidden' }}
              >
                <span className="font-semibold">Temporal Coarsening</span>
                <div className="flex items-center gap-2">
                  <Input
                    type='number'
                    min='0'
                    step={1}
                    value={displayDepth}
                    className="w-16 h-8 text-center"
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setDisplayDepth(e.target.value);
                      setKernelDepth(Math.pow(2, val));
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                <span className="font-semibold">Spatial Coarsening</span>
                <div className="flex items-center gap-2">
                  <Input
                    type='number'
                    min='0'
                    step={1}
                    value={displaySpat}
                    className="w-16 h-8 text-center"
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setDisplaySpat(e.target.value);
                      setKernelSize(Math.pow(2, val));
                    }}
                  />
                </div>
              </div>
              <div className="col-span-1 sm:col-span-2 text-xs text-muted-foreground/70 italic sm:text-center mt-1">
                Values represent 2ⁿ
              </div>
            </div>
          </Hider>

          <MetaDimTable
            availableDims={availableDims}
            dataShape={dataShape}
            chunkShape={chunkShape}
          />
        </div>

        <div className="px-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground/80">Active Dimensions</h3>
            <MetaAddDimensionControl availableDims={availableDims} dataShape={dataShape} />
          </div>

          <MetaActiveSlicers availableDims={availableDims} dataShape={dataShape} />
          <MetaCollapsedSlicers availableDims={availableDims} />
        </div>
      </div>
    </MetaSelectorContext.Provider>
  );
}