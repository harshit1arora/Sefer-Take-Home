export function SeferBrand({ className = '' }: { className?: string }) {
  return (
    <span className={`sefer-brand ${className}`.trim()}>
      <img src="/sefer-mark.svg" alt="" aria-hidden="true" />
      <span>
        sefer<span className="brand-period">.</span>
      </span>
    </span>
  );
}
