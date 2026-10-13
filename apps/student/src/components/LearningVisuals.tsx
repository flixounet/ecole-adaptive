export function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M6 7h10c7 0 10 4 10 10v9H16C9 26 6 22 6 16Z" fill="currentColor" />
        <path d="M11 13h10M11 18h7" stroke="#28594c" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <Mark />
      <span>
        école<span className="brand-light">adaptive</span>
      </span>
    </span>
  );
}
export function Arrow({ back = false }: { back?: boolean }) {
  return <span aria-hidden="true">{back ? '←' : '→'}</span>;
}
export function BookArt() {
  return (
    <svg className="book-art" viewBox="0 0 380 260" aria-hidden="true">
      <circle cx="206" cy="124" r="107" fill="#e2e8bf" />
      <circle cx="300" cy="65" r="20" fill="#f0bf8f" />
      <path d="m82 198 163 15 69-40-156-17Z" fill="#c8d3b0" />
      <path d="m91 169 146 15 61-34v25l-61 36-146-16Z" fill="#326552" />
      <path d="m91 164 146 15 61-34-148-15Z" fill="#f7f6df" />
      <path d="m99 155 141 14 50-28" fill="none" stroke="#cccba9" strokeWidth="2" />
      <path d="m119 118 118 23 41-29v26l-41 27-118-21Z" fill="#c58b6a" />
      <path d="m119 115 118 23 41-29-118-20Z" fill="#faf4e4" />
      <path d="m179 90 49 9 28-50-45-8Z" fill="#7a956a" />
      <path d="m192 79 17-27M202 85l18-29M212 89l18-28" stroke="#dfe7c9" strokeWidth="3" />
      <path
        d="M79 120c-1-27-24-42-41-29 7 24 22 33 41 29Zm0 0c-2-28 10-50 30-45 3 22-11 38-30 45Z"
        fill="#527c60"
      />
      <path d="m81 157-3-55" stroke="#386348" strokeWidth="3" />
      <path d="M62 141h39l-6 31H67Z" fill="#d5a26d" />
      <text x="279" y="105" fontSize="26" fontFamily="Georgia, serif" fill="#486641">
        ×
      </text>
      <text x="120" y="66" fontSize="26" fontFamily="Georgia, serif" fill="#698052">
        a²
      </text>
      <path d="M308 191v16m-8-8h16" stroke="#c08965" strokeWidth="2" />
      <circle cx="64" cy="66" r="5" fill="#b0bd83" />
    </svg>
  );
}
