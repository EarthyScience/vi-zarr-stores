"use client";

import React, { useEffect, useState, useMemo, useRef } from 'react'
import { GetColorMapTexture, colormaps, getColormapGradientCss, colormapIndex } from '@/components/textures';
import { useGlobalStore } from '@/GlobalStates/GlobalStore';
import { useShallow } from 'zustand/shallow';
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button-enhanced";
import { Separator } from "@/components/ui/separator";
import { Search, X, Eye, EyeOff } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { QuickTip } from '../Widgets/QuickTip';

const Colormaps = () => {

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showNames, setShowNames] = useState(true);
  const { colormap, setColormap, colormapName, flipColormap, setColormapName, setFlipColormap } = useGlobalStore(
    useShallow((state) => ({
      setColormap: state.setColormap,
      colormap: state.colormap,
      colormapName: state.colormapName,
      flipColormap: state.flipColormap,
      setColormapName: state.setColormapName,
      setFlipColormap: state.setFlipColormap,
    }))
  );
  const [popoverSide, setPopoverSide] = useState<"left" | "top">("left");
  const [prevColormapName, setPrevColormapName] = useState<string>(colormapName || '');
  const previousTextureRef = useRef(colormap);
  const colormapNameRef = useRef(colormapName);
  const flipColormapRef = useRef(flipColormap);

  const categories = useMemo(() => {
    const set = new Set<string>();
    colormapIndex.forEach((entry) => {
      if (entry.category) set.add(entry.category);
    });
    return ['None', ...Array.from(set).sort()];
  }, []);
  const filteredColormaps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // No search: category filtering works normally
    if (!query) {
      if (!selectedCategory || selectedCategory === 'None') {
        return colormaps;
      }

      return colormapIndex
        .filter((entry) => entry.category === selectedCategory)
        .map((entry) => entry.name);
    }

    // Search ALWAYS uses the complete collection
    const nameMatches: string[] = [];
    const otherMatches: string[] = [];

    for (const entry of colormapIndex) {
      const nameHit = entry.name.toLowerCase().includes(query);
      const categoryHit = entry.category?.toLowerCase().includes(query);
      const notesHit = entry.notes?.toLowerCase().includes(query);

      if (nameHit) {
        nameMatches.push(entry.name);
      } else if (categoryHit || notesHit) {
        otherMatches.push(entry.name);
      }
    }
    for (const cmap of colormaps){
      const nameHit = cmap.toLowerCase().includes(query)
      if (nameHit) nameMatches.push(cmap)
    }

    return [...nameMatches, ...otherMatches];
  }, [searchQuery, selectedCategory]);

  const visibleMatches = useMemo(() => filteredColormaps.slice(0, 64), [filteredColormaps]);
  const hasMoreResults = filteredColormaps.length > visibleMatches.length;

  // Keep refs in sync with store state changes
  useEffect(() => {
    colormapNameRef.current = colormapName;
    flipColormapRef.current = flipColormap;
  }, [colormapName, flipColormap]);

  useEffect(() => {
    previousTextureRef.current = colormap;
  }, [colormap]);

  let cmapTimeout: NodeJS.Timeout | undefined;

  const setCmap = (cmap: string) => setColormap(
      GetColorMapTexture(
        previousTextureRef.current,
        cmap === "Default" ? "Spectral" : cmap,
        1,
        "#000000",
        0,
        flipColormapRef.current
      )
    )

  const updateColormap = (cmap: string) => {
    if (cmapTimeout){
      clearTimeout(cmapTimeout);
      cmapTimeout = undefined;
    }
    setCmap(cmap);
  }

  const restoreColormap = () => {
    cmapTimeout = setTimeout(()=>{
      setCmap(colormapName);
    }, 100)
  }

  useEffect(() => {
      const handleResize = () => {
        setPopoverSide(window.innerWidth < 768 ? "top" : "left");
      };
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

  return (
    <div className="relative">
      <Popover>
      <PopoverTrigger asChild>
        <div>
        <QuickTip message='Change Colormap' side={popoverSide}>
          <div>
              <Button
                size="icon"
                className='cursor-pointer hover:scale-90 transition-transform duration-100 ease-out rounded-full cmap-trigger'
                style={{
                  backgroundImage: getColormapGradientCss((colormapName === 'Default' ? 'Spectral' : colormapName) || 'Spectral'),
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                  backgroundSize: '100% 100%',
                  transform: flipColormap ? "scaleX(-1)" : "",
                  width: "32px",
                  height: "32px",
                }} /> 
            </div>
        </QuickTip>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side={popoverSide}
        className="colormaps"
        style={{
          width: '280px',
          maxWidth: 'calc(100vw - 1.5rem)',
          overflow: 'hidden',
          overscrollBehavior: 'contain',
          padding: 0,
          boxSizing: 'border-box',
          maxHeight: popoverSide === 'top' ? '80vh' : undefined,
        }}
      >
        <style>{`\n.colormaps {\n  scrollbar-width: none;\n}\n.colormaps::-webkit-scrollbar {\n  display: none;\n}\n.colormaps .rendered-cmap, .colormaps .cmap-trigger, .colormaps .search-input {\n  border: 1px solid rgba(0,0,0,0.08);\n}\n@media (prefers-color-scheme: dark) {\n  .colormaps .rendered-cmap, .colormaps .cmap-trigger, .colormaps .search-input {\n    border: 1px solid rgba(255,255,255,0.12);\n  }\n}\n`}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.6rem', width: '100%', padding: '0.75rem 0.75rem 0' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: '100%', flexWrap: 'wrap', padding: 0 }}>
            <ButtonGroup className="justify-start gap-0.25">
              <Button
                type="button"
                onClick={() => setFlipColormap(!flipColormap)}
                size="sm"
                variant="secondary"
                className="cursor-pointer"
              >
                {flipColormap ? 'Unflip' : 'Flip'}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setColormapName(prevColormapName);
                  setPrevColormapName(colormapName);
                  setFlipColormap(false);
                }}
                size="sm"
                variant="secondary"
                className="cursor-pointer"
              >
                Revert
              </Button>
            </ButtonGroup>
            <Select
              value={selectedCategory === 'None' ? '' : selectedCategory}
              onValueChange={(value) => setSelectedCategory(value === 'None' ? '' : value)}
            >
              <SelectTrigger size="sm" className="w-[110px] cursor-pointer">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="cursor-pointer">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div style={{ marginRight: 'auto', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <QuickTip message={<span>{showNames ? "Hide names" : "Show names"}</span>}>
                <Button
                  size="icon"
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setShowNames(prev => !prev)}
                >
                  {showNames ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </Button>
              </QuickTip>
              <Button
                size="sm"
                variant="secondary"
                className="border-b-1 border-amber-400"
              >
                <span className="max-w-[188px] truncate">
                  {colormapName}
                </span>
              </Button>
            </div>
          </div>
          <Separator/>
          <InputGroup className="w-full">
            <InputGroupInput 
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search..."
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {searchQuery ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 p-0"
            onClick={() => setSearchQuery('')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        </InputGroup>
        <Separator/>
        </div>
        {(searchQuery.trim() || selectedCategory !== 'None') && (
          <div className="search-results-summary" style={{ margin: '0 0.75rem 0.75rem', fontSize: '0.85rem', color: 'var(--ui-text-muted)' }}>
            Showing <strong>{visibleMatches.length}</strong> of <strong>{filteredColormaps.length}</strong>
            {selectedCategory && selectedCategory !== 'None' && !searchQuery.trim() && <> in <strong>{selectedCategory}</strong></>}
            {searchQuery.trim() && <> matching &quot;{searchQuery}&quot;</>}
            {hasMoreResults && ' — first 64 shown'}
          </div>
        )}
        {/* COLORMAPS */}
        <div className="colormap-list-container" style={{ marginTop: '0.5rem', width: '100%', padding: '0 0.75rem 0.75rem' }}>
          <div style={{ maxHeight: 'min(50vh, 360px)', overflowY: 'auto', paddingRight: 0, width: '100%', boxSizing: 'border-box' }}>
            <div className="colormaps-grid" style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(1, minmax(0, 1fr))', width: '100%', boxSizing: 'border-box' }}>
          {visibleMatches.map((val) => (
            <button
              key={val}
              className="cmap rendered-cmap"
              type="button"
              onClick={() => {
                setPrevColormapName(colormapName);
                setColormapName(val);
              }}
              onMouseEnter={() => updateColormap(val)}
              onMouseLeave={() => restoreColormap()}
              style={{
                width: '96%',
                minWidth: 0,
                height: '34px',
                borderRadius: '0.5rem',
                color: 'var(--ui-text-highlighted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                padding: '0',
                fontSize: '0.85rem',
                fontWeight: 700,
                textShadow: '0 1px 3px rgba(0,0,0,0.45)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 'inherit',
                  backgroundImage: getColormapGradientCss(val),
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                  backgroundSize: '100% 100%',
                  transform: flipColormap ? 'scaleX(-1)' : undefined,
                  pointerEvents: 'none',
                }}
              />
              {showNames && (
                <span
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '0.05rem 0.75rem',
                    marginLeft: 0,
                    borderRadius: '0.38rem',
                    background: 'rgba(244, 237, 237, 0.13)',
                    backdropFilter: 'blur(8px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
                    fontWeight: 400,
                    color: 'rgba(241, 237, 237, 0.96)',
                  }}
                >
                  {val}
                </span>
              )}
            </button>
          ))}
            </div>
        </div>
        {filteredColormaps.length === 0 && (
          <div style={{ padding: '1rem 0', color: 'var(--ui-text-muted)' }}>
            No colormaps found. Try a different search term.
          </div>
        )}
        </div>
      </PopoverContent>
      
      </Popover>
    </div>
  );
};

export default Colormaps
