type Props = { size?: number; className?: string }

export function AppLogo({ size = 32, className = '' }: Props) {
  return (
    <img
      src="./logo.png"
      alt="EyedOptimizer"
      className={`app-logo ${className}`.trim()}
      width={size}
      height={size}
      draggable={false}
    />
  )
}
