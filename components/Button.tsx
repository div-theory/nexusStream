import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-95";
  
  const variants = {
    // Inverts based on theme: White on Black (Dark Mode) -> Black on White (Light Mode)
    primary: "bg-primary text-background border border-primary hover:bg-transparent hover:text-primary",
    // Transparent with border
    secondary: "bg-transparent text-primary border border-border hover:border-primary hover:bg-primary/5",
    // Accent (Blue)
    accent: "bg-blue-600 text-white border border-blue-600 hover:bg-transparent hover:text-blue-500",
    // Danger (Red) - always red
    danger: "bg-transparent text-red-500 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500",
    // Ghost
    ghost: "bg-transparent text-secondary hover:text-primary hover:bg-surface-highlight",
  };

  const sizes = {
    sm: "px-3 py-1 text-xs font-mono tracking-wider rounded-lg",
    md: "px-5 py-2 text-sm uppercase tracking-widest rounded-xl",
    lg: "px-8 py-3 text-base uppercase tracking-widest rounded-2xl",
    icon: "p-3 aspect-square rounded-xl"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};