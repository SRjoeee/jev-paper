import { COPY } from '@/shared/copy'
import { highlighterSvg } from '@/shared/icon'
import { LAYERS } from '@/shared/levels'

export function Guide() {
  return (
    <main className="guide">
      <header className="stage">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant icon from src/shared/icon.ts */}
        <span className="mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlighterSvg(26, 2) }} />
        <h1>{COPY.guide.title}</h1>
        <p className="lede">{COPY.guide.lede}</p>
      </header>
      <section className="stage" aria-labelledby="g-colors">
        <h2 id="g-colors">{COPY.guide.colors}</h2>
        <ul className="legend">
          {LAYERS.map(layer => (
            <li key={layer.level} data-lit>
              <span className="stroke" aria-hidden="true">
                {layer.tones.map(t => (
                  <i key={t} style={{ background: `var(--jp-${t})` }} />
                ))}
              </span>
              <span>
                <strong>{layer.name}</strong>
                <span className="note">{COPY.guide.colorNotes[layer.level]}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="stage" aria-labelledby="g-tips">
        <h2 id="g-tips">{COPY.guide.tipsTitle}</h2>
        <ol className="tips">
          {COPY.guide.tips.map(tip => (
            <li key={tip}>{tip}</li>
          ))}
        </ol>
      </section>
      <a className="primary stage" href="https://arxiv.org/html/1706.03762">
        {COPY.guide.cta}
      </a>
    </main>
  )
}
