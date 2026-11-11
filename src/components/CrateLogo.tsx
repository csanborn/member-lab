export function CrateLogo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--brand)" />
      <path d="M7 12h18v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill="var(--accent)" />
      <path d="M6 9h20v4H6z" fill="var(--paper)" />
      <path d="M12 16h8" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
