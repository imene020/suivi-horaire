import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sea-500 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Acier du logo, assez foncé pour que le texte blanc reste lisible (contraste ≥ 4.5:1).
        default:
          "bg-gradient-to-br from-steel-500 to-steel-700 text-white hover:from-steel-600 hover:to-steel-800 shadow-md shadow-steel-700/25",
        // Accent bleu Sidi Bou Saïd : l'action principale du moment (ex. pointer l'arrivée).
        accent:
          "bg-gradient-to-br from-sea-500 to-sea-700 text-white hover:from-sea-600 hover:to-sea-800 shadow-md shadow-sea-700/25",
        destructive: "bg-gradient-to-br from-red-600 to-rose-600 text-white hover:from-red-500 hover:to-rose-500 shadow-md shadow-red-600/20",
        outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400",
        ghost: "hover:bg-slate-100 text-slate-700",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
      },
      size: {
        default: "min-h-11 h-11 px-5 py-2.5",
        sm: "min-h-9 h-9 px-3 text-xs",
        lg: "min-h-12 h-12 px-6 text-base",
        icon: "min-h-10 h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
