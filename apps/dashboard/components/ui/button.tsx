import {forwardRef} from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand/90',
        outline: 'border bg-white text-ink hover:bg-canvas',
        ghost: 'text-slate hover:bg-canvas hover:text-ink'
      }
    },
    defaultVariants: {variant: 'default'}
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({className, variant, ...props}, ref) => (
  <button ref={ref} className={cn(buttonVariants({variant}), className)} {...props} />
));
Button.displayName = 'Button';
