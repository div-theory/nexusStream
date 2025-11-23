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
  const baseStyles = "sharp inline-flex items-center justify-center font-light transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:pointer-events-none active:translate-x-0.5 active:translate-y-0.5";
  
  const variants = {
    primary: "bg-white text-black border border-white hover:bg-black hover:text-white",
    secondary: "bg-black text-white border border-white/20 hover:border-white hover:bg-white/5",
    accent: "bg-blue-600 text-white border border-blue-600 hover:bg-transparent hover:text-blue-500",
    danger: "bg-transparent text-red-500 border border-red-900/50 hover:bg-red-950 hover:border-red-500",
    ghost: "bg-transparent text-slate-400 hover:text-white hover:bg-white/5",
  };

  const sizes = {
    sm: "px-3 py-1 text-xs font-mono tracking-wider",
    md: "px-5 py-2 text-sm uppercase tracking-widest",
    lg: "px-8 py-3 text-base uppercase tracking-widest",
    icon: "p-3 aspect-square"
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