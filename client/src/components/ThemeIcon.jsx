import React from "react";

export default function ThemeIcon({ name, className = "h-5 w-5" }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} focusable="false">
      <use href={`/sigma-icons.svg#${name}`} />
    </svg>
  );
}