import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

interface DualRangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  labelFormatter?: (min: number, max: number) => string;
  className?: string;
}

const DualRangeSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  DualRangeSliderProps
>(({ min, max, step = 50, value, onValueChange, labelFormatter, className }, ref) => {
  const label = labelFormatter ? labelFormatter(value[0], value[1]) : `${value[0]} - ${value[1]}`;

  const handleValueChange = React.useCallback((val: number[]) => {
    const [v0, v1] = val as [number, number];
    if (v1 - v0 >= step) {
      onValueChange([v0, v1]);
    }
  }, [step, onValueChange]);

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">{label}</span>
      </div>
      <SliderPrimitive.Root
        ref={ref}
        className="relative flex w-full touch-none select-none items-center h-6"
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={handleValueChange}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full rounded-full" style={{ backgroundColor: '#0463CA' }} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block h-5 w-5 rounded-full border-2 bg-background shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing hover:shadow-lg hover:scale-110 transition-transform"
          style={{ borderColor: '#0463CA' }}
        />
        <SliderPrimitive.Thumb
          className="block h-5 w-5 rounded-full border-2 bg-background shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing hover:shadow-lg hover:scale-110 transition-transform"
          style={{ borderColor: '#0463CA' }}
        />
      </SliderPrimitive.Root>
      <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
        <span>သိန်း {min.toLocaleString('en-US')}</span>
        <span>သိန်း {max.toLocaleString('en-US')}</span>
      </div>
    </div>
  );
});
DualRangeSlider.displayName = "DualRangeSlider";

export { DualRangeSlider };
