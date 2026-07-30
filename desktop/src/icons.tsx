import type { ReactNode } from 'react'

type Props = { size?: number; className?: string }

function Svg({ children, size = 18, className }: Props & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const IconHome = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 10v10h14V10" />
  </Svg>
)

export const IconGamepad = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="7" width="20" height="11" rx="3" />
    <path d="M8 12h2M9 11v2M15.5 11.5h.01M18 13.5h.01" />
  </Svg>
)

export const IconBolt = (p: Props) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
  </Svg>
)

export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)

export const IconCpu = (p: Props) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
  </Svg>
)

export const IconGpu = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M14 10h5M14 14h3" />
  </Svg>
)

export const IconRam = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="8" width="20" height="8" rx="1.5" />
    <path d="M6 8V6M10 8V6M14 8V6M18 8V6M6 16v2M10 16v2M14 16v2M18 16v2" />
  </Svg>
)

export const IconBattery = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="7" width="17" height="10" rx="2" />
    <rect x="20" y="9" width="2" height="6" rx="1" fill="currentColor" stroke="none" />
    <path d="M6.5 11.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
)

/** Logo oficial Discord (glifo) */
export const IconDiscord = ({ size = 18, className }: Props) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
  >
    <path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14 14 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

/** Batería grande con nivel de carga y % dentro */
export function BatteryBig({
  percent = 0,
  charging = false,
  size = 180,
}: {
  percent?: number
  charging?: boolean
  size?: number
}) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  const color = charging ? '#3ddc97' : p <= 20 ? '#ff6b7a' : p <= 40 ? '#f0b429' : '#3aa0ff'
  const fillW = Math.round((140 * p) / 100)
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 200 110" aria-hidden className="battery-big">
      <rect x="8" y="18" width="160" height="74" rx="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
      <rect x="172" y="38" width="16" height="34" rx="6" fill="rgba(255,255,255,0.35)" />
      <rect x="18" y="28" width="140" height="54" rx="8" fill="rgba(0,0,0,0.35)" />
      {fillW > 0 ? <rect x="18" y="28" width={fillW} height="54" rx="8" fill={color} opacity="0.92" /> : null}
      <text
        x="88"
        y="62"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontSize="32"
        fontWeight="800"
        fontFamily="Segoe UI, system-ui, sans-serif"
        style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 3 }}
      >
        {Math.round(p)}%
      </text>
      {charging ? (
        <path d="M168 22 158 38h8l-4 14 14-20h-8l6-10z" fill="#3ddc97" />
      ) : null}
    </svg>
  )
}

export const IconActivity = (p: Props) => (
  <Svg {...p}>
    <path d="M3 12h3l2-7 4 14 2-7h5" />
  </Svg>
)

export const IconEye = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const IconTray = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M8 21h8M12 18v3" />
  </Svg>
)

export const IconRefresh = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.2" />
    <path d="M21 3v6h-6" />
  </Svg>
)

export const IconWifi = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12.5a10 10 0 0 1 14 0" />
    <path d="M8.5 16a5.5 5.5 0 0 1 7 0" />
    <circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none" />
    <path d="M2 9a15 15 0 0 1 20 0" />
  </Svg>
)

export const IconDownload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </Svg>
)

export const IconUpload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 21V9" />
    <path d="m7 14 5-5 5 5" />
    <path d="M4 3h16" />
  </Svg>
)

export const IconPower = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2v10" />
    <path d="M6.5 5.5a8 8 0 1 0 11 0" />
  </Svg>
)

export const IconTemp = (p: Props) => (
  <Svg {...p}>
    <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a3.5 3.5 0 1 1-4 0z" />
  </Svg>
)

export const IconLayers = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2 2 7l10 5 10-5-10-5z" />
    <path d="M2 12l10 5 10-5M2 17l10 5 10-5" />
  </Svg>
)

export const IconChart = (p: Props) => (
  <Svg {...p}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="M8 16v-5" />
    <path d="M12 16V8" />
    <path d="M16 16v-3" />
  </Svg>
)

export const IconTarget = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
  </Svg>
)

export const IconDisk = (p: Props) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Svg>
)

export const IconApps = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
)

export const IconInfo = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 10v6M12 7h.01" />
  </Svg>
)

export const IconFolder = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </Svg>
)

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Svg>
)

export const IconFan = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 4c2.2 2.4 2.8 4.6 1.6 6.2C11.4 8.8 9.2 8 7 8c2.8-2.2 4.4-3.4 5-4z" />
    <path d="M20 12c-2.4 2.2-4.6 2.8-6.2 1.6 1.4-2.2 2.2-4.4 2.2-6.6 2.2 2.8 3.4 4.4 4 5z" />
    <path d="M12 20c-2.2-2.4-2.8-4.6-1.6-6.2 2.2 1.4 4.4 2.2 6.6 2.2-2.8 2.2-4.4 3.4-5 4z" />
    <path d="M4 12c2.4-2.2 4.6-2.8 6.2-1.6-1.4 2.2-2.2 4.4-2.2 6.6C5.8 14.8 4.6 13.2 4 12z" />
  </Svg>
)
