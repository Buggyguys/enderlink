import * as SelectPrimitive from "@radix-ui/react-select";
import { useEffect, useState, type ComponentProps } from "react";
import { Icon } from "./Icons";
import "./Select.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type SelectProps = Pick<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  "id" | "aria-label" | "aria-labelledby" | "aria-describedby" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  placeholder?: string;
};

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Painted inside the webview: native option menus ignore colours on some OSes. */
export function Select({
  value,
  onValueChange,
  options,
  disabled,
  placeholder = "Choose an option",
  className = "",
  ...labelProps
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const unavailable = disabled || options.length === 0;
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  const selected = options.find((option) => option.value === value);
  // Radix reserves "" for its placeholder. Encode values so a real empty choice
  // (e.g. World activity only) remains selectable without a sentinel collision.
  const encode = (value: string) => `value:${value}`;
  return (
    <SelectPrimitive.Root
      open={open && !unavailable}
      onOpenChange={setOpen}
      value={selected ? encode(value) : ""}
      onValueChange={(next) => {
        const option = options.find((option) => encode(option.value) === next);
        if (!unavailable && option && !option.disabled)
          onValueChange(option.value);
      }}
      disabled={unavailable}
    >
      <SelectPrimitive.Trigger
        {...labelProps}
        className={`select-trigger ${className}`}
        data-value={value}
        title={selected?.label}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="select-chevron">
          <Chevron />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.ScrollUpButton
            className="select-scroll select-scroll-up"
            aria-hidden="true"
          >
            <Chevron />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={encode(option.value)}
                disabled={option.disabled}
                textValue={option.label}
                className="select-option"
                data-value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-check">
                  <Icon name="check" size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton
            className="select-scroll"
            aria-hidden="true"
          >
            <Chevron />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
