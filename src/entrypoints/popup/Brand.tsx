import { COPY } from '@/shared/copy'
import { highlighterSvg } from '@/shared/icon'

export function Brand() {
  return (
    <p className="brand">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant icon from src/shared/icon.ts */}
      <span className="mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlighterSvg(13, 2.2) }} />
      {COPY.brand}
    </p>
  )
}
