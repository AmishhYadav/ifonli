import * as React from "react";

import { cn } from "./cn";
import { inputClasses } from "./input";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(inputClasses, "h-auto min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
}
