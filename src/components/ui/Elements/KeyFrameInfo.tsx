import React, {useState} from 'react'
import {Select, SelectContent, SelectGroup, SelectValue, SelectTrigger, SelectItem, Input} from '@/components/ui'


export const KeyFrameInfo = ({keyframe, keyframesMap} : {keyframe: number, keyframesMap: Map<number,any> | undefined}) => {
	const properties = keyframesMap?.get(keyframe);
	const visuals = properties?.visual;
	const visualProperties = visuals ? Object.keys(visuals) : [];
	const [activeProperty, setActiveProperty] = useState('');
	const [useSlider, setUseSlider] = useState(false);
	const [inputValue, setInputValue] = useState('');

	function getPropertyValues(property:string){
		const isCamera = property =='camera';
		if (isCamera) return;
		const propertyValue = visuals[property];
		const propertyType = typeof propertyValue
		
	}

	return (
		<div className='grid grid-cols-3'>
		Keyframe Info:
		<Select onValueChange={getPropertyValues}>
			<SelectTrigger>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem key='camera' value='camera'>
					Camera
				</SelectItem>
				<SelectGroup>
				{visualProperties?.map((val,idx) =>(
					<SelectItem key={idx} value={val}>
						{val}
					</SelectItem>
				))}
				</SelectGroup>
			</SelectContent>
		</Select>
		<Input className='w-[90px]' value={inputValue} 
			// onChange={}
		
		/>
		</div>
	)
}


