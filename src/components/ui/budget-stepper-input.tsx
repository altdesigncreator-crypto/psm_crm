import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface BudgetStepperInputProps {
  minValue: number;
  maxValue: number;
  isUnlimited: boolean;
  step?: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
  onUnlimitedToggle: (unlimited: boolean) => void;
  className?: string;
}

function StepperField({
  label,
  value,
  onChange,
  disabled,
  step = 500,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: number;
  placeholder?: string;
}) {
  const [focused, setFocused] = React.useState(false);

  const decrement = () => onChange(Math.max(0, value - step));
  const increment = () => onChange(value + step);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, "");
    if (raw === "") {
      onChange(0);
      return;
    }
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num >= 0) {
      onChange(num);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div
        className={cn(
          "flex items-center rounded-lg border bg-background shadow-sm transition-all duration-200 overflow-hidden",
          focused ? "border-[#0463CA] ring-2 ring-[#0463CA]/20 shadow-md" : "border-border hover:border-[#0463CA]/40",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        <button
          type="button"
          disabled={disabled || value <= 0}
          onClick={decrement}
          className={cn(
            "flex items-center justify-center w-11 h-12 shrink-0 text-[#0463CA] hover:bg-[#0463CA]/5 transition-colors border-r border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <Minus className="w-4 h-4" strokeWidth={2.5} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={value.toLocaleString("en-US")}
          onChange={handleInputChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="flex-1 h-12 px-3 text-center text-base font-semibold text-foreground bg-transparent outline-none min-w-0"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={increment}
          className={cn(
            "flex items-center justify-center w-11 h-12 shrink-0 text-[#0463CA] hover:bg-[#0463CA]/5 transition-colors border-l border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

export function BudgetStepperInput({
  minValue,
  maxValue,
  isUnlimited,
  step = 500,
  onMinChange,
  onMaxChange,
  onUnlimitedToggle,
  className,
}: BudgetStepperInputProps) {
  return (
    <div className={cn("w-full space-y-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          {isUnlimited
            ? `ရွေးချယ်ထားသော ဘတ်ဂျက် - သိန်း ${minValue.toLocaleString("en-US")} မှ အကန့်အသတ်မရှိ`
            : `ရွေးချယ်ထားသော ဘတ်ဂျက် - သိန်း ${minValue.toLocaleString("en-US")} မှ ${maxValue.toLocaleString("en-US")} ကြား`}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StepperField
          label="အနည်းဆုံး သိန်း (Min)"
          value={minValue}
          onChange={onMinChange}
          step={step}
          placeholder="0"
        />
        <StepperField
          label="အများဆုံး သိန်း (Max)"
          value={isUnlimited ? 0 : maxValue}
          onChange={onMaxChange}
          step={step}
          disabled={isUnlimited}
          placeholder={isUnlimited ? "Unlimited" : "Max"}
        />
      </div>

      {/* Unlimited Toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onUnlimitedToggle(!isUnlimited)}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0463CA]/40",
            isUnlimited
              ? "border-[#0463CA] bg-[#0463CA]"
              : "border-border bg-background"
          )}
          role="switch"
          aria-checked={isUnlimited}
        >
          <span
            className={cn(
              "inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300",
              isUnlimited ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
        <span className="text-sm font-medium text-foreground">
          အကန့်အသတ်မရှိ (Unlimited)
        </span>
        <span className="text-xs text-muted-foreground">
          အများဆုံး ဘတ်ဂျက်ကို အကန့်အသတ်မရှိ (Unlimited) အဖြစ် သတ်မှတ်ရန်
        </span>
      </div>
    </div>
  );
}
