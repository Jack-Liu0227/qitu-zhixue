import type { TutorTurn } from '@qitu/contracts';

function collectEvidenceRefs(turns: TutorTurn[]): string[] {
  const refs = new Set<string>();
  for (const turn of turns) {
    for (const block of turn.blocks) {
      if (block.kind === 'evidence') refs.add(block.ref);
    }
  }
  return [...refs];
}

export function PinnedSourcesRail({ turns }: { turns: TutorTurn[] }) {
  const refs = collectEvidenceRefs(turns);
  return (
    <section className="qitu-tutor-pinned-sources" aria-labelledby="pinned-sources-title">
      <header className="qitu-tutor-pinned-header">
        <div>
          <p>AI 对话上下文</p>
          <h2 id="pinned-sources-title">固定资料 <span>({refs.length})</span></h2>
          <small>Pinned sources · 服务端引用</small>
        </div>
        <span className="qitu-tutor-pinned-readonly">只读</span>
      </header>
      <div className="qitu-tutor-pinned-list">
        {refs.length === 0 ? (
          <div className="qitu-tutor-pinned-empty">
            <span aria-hidden="true">⌖</span>
            <strong>暂无引用资料</strong>
            <small>AI 回复产生服务端证据引用后，会显示在这里。</small>
          </div>
        ) : refs.map((ref, index) => (
          <article className="qitu-tutor-pinned-card" key={ref}>
            <span className="qitu-tutor-pinned-index">[{index + 1}]</span>
            <span className="qitu-tutor-pinned-copy"><strong>服务端证据</strong><small>{ref}</small></span>
            <span className="qitu-tutor-pinned-mark" aria-hidden="true">§</span>
          </article>
        ))}
      </div>
      <p className="qitu-tutor-pinned-note">来源由服务端授权，学生端不能修改。</p>
    </section>
  );
}
