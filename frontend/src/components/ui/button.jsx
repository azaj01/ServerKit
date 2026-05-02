import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center text-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:     'border border-border bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary:   'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost:       'hover:bg-accent hover:text-accent-foreground',
        link:        'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 min-w-24 px-5 py-2.5 has-[>svg]:px-4',
        sm:      'h-8 min-w-[4.5rem] rounded-md gap-1.5 px-3.5 text-xs has-[>svg]:px-3',
        lg:      'h-11 min-w-32 rounded-lg px-7 text-base has-[>svg]:px-5',
        icon:    'size-9 min-w-0 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
    compoundVariants: [
      {
        variant: 'ghost',
        size: 'icon',
        className: 'border border-border bg-transparent text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
      },
    ],
  }
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
