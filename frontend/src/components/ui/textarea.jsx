import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input flex min-h-[60px] w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground shadow-xs',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'transition-[color,box-shadow]',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
