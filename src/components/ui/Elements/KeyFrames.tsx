"use client";
import React, {useEffect, useRef, useState } from 'react'
import { Button } from '../button'
import { ButtonGroup } from "@/components/ui/button-group"
import { useImageExportStore } from '@/GlobalStates/ImageExportStore';
import { usePlotStore } from '@/GlobalStates/PlotStore';
import { useShallow } from 'zustand/shallow'
import { Slider } from '../slider'
import '../css/KeyFrames.css'
import { Input } from '../input';
import { IoCloseCircleSharp } from "react-icons/io5";
import { FaPlusCircle } from "react-icons/fa";
import { MdDeleteForever } from "react-icons/md";
import { MdPreview } from "react-icons/md";
import { TbKeyframeFilled } from "react-icons/tb";
import { TbKeyframesFilled } from "react-icons/tb";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner"
import { QuickTip } from '../Widgets/QuickTip';
import { KeyFramesHelper } from './KeyFramesHelper';
import { KeyFrameInfo } from './KeyFrameInfo';
import { BsBoxArrowUp } from 'react-icons/bs';
function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return keys.reduce((acc, key) => {
    if (key in obj) {
      acc[key] = obj[key];
    }
    return acc;
  }, {} as Pick<T, K>);
}

const SetKeyFrame = (frame: number) =>{
    const {plotType} = usePlotStore.getState()
    const {addKeyFrame} = useImageExportStore.getState()
    let vizStates = []
    if (plotType === "volume"){
        vizStates=["transparency", "vTransferRange", "vTransferScale"];
    } else if (plotType === "point-cloud"){
        vizStates=["scaleIntensity", "pointSize", "timeScale"];
    } else {
        vizStates=["displacement"]
    }
    if (["point-cloud", "volume"].includes(plotType)){
        vizStates.push("valueRange", "xRange", "yRange", "zRange")
    }
    if (plotType != "pointCloud") {
        vizStates.push("nanColor", "nanTransparency")
    }
    const currentVizState = usePlotStore.getState()
    const keyState = pick(currentVizState, vizStates as (keyof typeof currentVizState)[])
    const currentCamState = useImageExportStore.getState().cameraRef?.current?.clone()
    const cameraState = {
        position: currentCamState?.position,
        rotation:currentCamState?.rotation,
    }
    const thisState = {
        visual : keyState,
        camera: cameraState,
        time: usePlotStore.getState().animProg
    }
    addKeyFrame(frame, thisState)
}

export const KeyFrames = () => {

    const {animProg, setAnimProg} = usePlotStore(useShallow(s => s))
    const [showHelper, setShowHelper] = useState(false)

    const {keyFrames, frames, useTime, frameRate, timeRate, orbit, currentFrame, previewKeyFrames, setCurrentFrame, setFrames} = useImageExportStore(
        useShallow(s => s))
    const timeRatio = timeRate/frameRate
    const keyFrameList = keyFrames ? Array.from(keyFrames.keys()).sort((a, b) => a - b) : null;
    const originalAnimProg = useRef<number | null>(null)
    const [MdLg, setMdLg] = useState<"md" | "lg">("md");

	useEffect(()=>{ // Clear KeyFrames if it is empty. 
		if (keyFrameList && keyFrameList.length == 0){
			useImageExportStore.setState({keyFrames: undefined})
		}
	},[keyFrameList])

    useEffect(()=>{
        originalAnimProg.current = animProg;
        return ()=>{
            if (originalAnimProg.current){
                setAnimProg(originalAnimProg.current) // Reset animProg when done monkeying with values
            }
        }
    },[])

      useEffect(() => {
        const handleResize = () => {
          setMdLg(window.innerWidth < 768 ? "md" : "lg");
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      }, []);

    {/* Information */}
    useEffect(() => {
        if (orbit) {
            toast.warning("Warning!", {
                description: "Camera Motion overwritten by Orbit!",
                action: {
                    label: "close",
                    onClick: () => null,
                },
            });
        }
        if (useTime) {
            toast.warning("Warning!", {
                description: "Time changes overwritten by Animate Time!",
                action: {
                    label: "close",
                    onClick: () => null,
                },
            });
        }
    }, [orbit, useTime]);

  useEffect(() => {
    if ((orbit || useTime) && !keyFrames) {
      toast.warning("Warning!", {
        description: "Keyframe required to preview orbit!",
        action: {
          label: "close",
          onClick: () => null,
        },
      });
    }
  }, [orbit, useTime, keyFrames]);

  return (
   <Card className='keyframes-container'>
    <QuickTip message='Close Keyframe Editor'>
        <IoCloseCircleSharp 
			style={{
				position:'absolute',
				top:'10px',
				left:'10px',
				cursor:'pointer'
			}}
			size={20}
			onClick={()=>useImageExportStore.getState().setKeyFrameEditor(false)}
		/>
    </QuickTip>
      <CardContent className='flex flex-col gap-1 w-full h-full px-1 py-1'>
        <div className='flex flex-wrap justify-center gap-1 ml-6 mr-0 md:ml-8 md:mr-4'>
            <Button
                variant='outline'
                onClick={()=>setShowHelper(true)}
            >
                <BsBoxArrowUp />
                { MdLg === "lg" ? 'Guide' : '?'}
            </Button>
			{/* Buttons */}
			<ButtonGroup>
				<QuickTip message='Add new Keyframe' side='top'>
                    <Button 
                        className='cursor-pointer'
                        size="sm"
                        variant="outline"
                        onClick={()=>{SetKeyFrame(currentFrame)}}
                    > 
                        <FaPlusCircle /> { MdLg === "lg" ? 'Keyframe' : <TbKeyframeFilled/>}
                    </Button>
                </QuickTip>
                <QuickTip message='Clear all Keyframes' side='top'>
                    <Button 
                            disabled={!keyFrameList}
                            className='cursor-pointer'
                            size="sm"
                            variant="outline"
                            onClick={()=>{useImageExportStore.setState({keyFrames: undefined})}}
                        >
                            <MdDeleteForever className='size-6'/> { MdLg === "lg" ? 'Keyframes' : <TbKeyframesFilled/>}
                        </Button>
                </QuickTip>
                <QuickTip message='Preview full animation' side='top'>
                    <Button 
                        disabled={!keyFrameList}
                        className='cursor-pointer'
                        size="sm"
                        variant="outline"
                        onClick={()=>{useImageExportStore.getState().PreviewKeyFrames()}}
                    >
                        <MdPreview className='size-6'/> { MdLg === "lg" ? (previewKeyFrames ? 'Stop Preview' : "Preview") : ''}
                    </Button>
                </QuickTip>
			</ButtonGroup>
			{/* Frame Information */}
            <ButtonGroup >
                <QuickTip message='Set number of frames in animation (defaults to number of timesteps)' side='top'>
                    <Button size="sm" variant="decorator">
                        Frames
                    </Button>
                </QuickTip>
                <Input className='w-[60px] h-[32px] no-spinner' id="frames" type='number' step={1} value={frames} onChange={e => setFrames(Math.max(parseInt(e.target.value),2))} />
            </ButtonGroup>
            <ButtonGroup >
                <QuickTip message='Curent Frame' side='top'>
                    <Button size="sm" variant="decorator">
                        Frame
                    </Button>
                </QuickTip>
                <Input value={currentFrame} type='number' 
                    className='w-[60px] h-[32px] no-spinner'
                    min={1} 
                    step={1} 
                    onChange={e =>parseInt(e.target.value) ? setCurrentFrame(Math.max(parseInt(e.target.value), 1)) : 1}
                />
            </ButtonGroup>
            {/* <KeyFrameInfo keyframe={currentFrame} keyframesMap={keyFrames} /> */}
		</div>
        <div className="relative w-full my-2 px-2 drop-shadow-[0_0_4px_var(--notice-shadow)] rounded-lg">
            {keyFrameList?.map((frame) => {
                const thumbRadius = 8 + 8; //Thumbradius plus padding
                const percent = ((frame - 1 )/(frames - 1)) * 100; 
                return (
                <TbKeyframeFilled
                    key={frame}
                    style={{
                    position: "absolute",
                    left: `calc(${percent}% + ${thumbRadius}px - ${thumbRadius * 2 * percent / 100}px)`,
					top:0,
                    transform:"translate(-50%, -50%)",
                    zIndex: 0, 
                    cursor:"pointer",
					visibility:percent <= 100 ? "visible" : "hidden"
                    }}
					color='orangered'
					size={18}
					onClick={()=>setCurrentFrame(frame)}
					onDoubleClick={()=>{
						useImageExportStore.getState().removeKeyFrame(frame)
					}}
                />
                );
            })}
            <Slider
                value={[currentFrame]}
                min={1}
                max={frames}
                step={1}
                className='flex-1 my-2'
                onValueChange={(vals: number[]) => {
                const v = Array.isArray(vals) ? vals[0] : 0
                setCurrentFrame(v)
                if (useTime && originalAnimProg.current){
                    setAnimProg(originalAnimProg.current + (v / frames)*timeRatio)
                }
                }}
            />
		</div>
		
    </CardContent>
    <KeyFramesHelper open={showHelper} onOpenChange={setShowHelper}/>
    </Card>
  )
}
