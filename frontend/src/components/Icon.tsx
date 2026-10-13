export const Icon = ({ n, className = "", fill, size, color }: { n: string; className?: string; fill?: boolean; size?: number; color?: string }) => (
  <span className={`ms ${fill ? "ms-fill" : ""} ${className}`} style={{ ...(size ? { fontSize: size } : {}), ...(color ? { color } : {}) }} aria-hidden>{n}</span>
);
