'use client';
import {useState} from 'react';
export function EvidenceChip({reference}:{reference:string}) {
  const [preview,setPreview]=useState<{title:string;text:string;knowledgeBase:string;origin:Record<string,unknown>}|null>(null);const [error,setError]=useState('');const [pending,setPending]=useState(false);
  if(!reference.startsWith('project-knowledge:'))return <span className="qitu-tutor-evidence"><span className="qitu-tutor-evidence-label">证据</span><span className="qitu-tutor-evidence-ref">{reference}</span></span>;
  const [,projectId,citationId]=reference.split(':');
  return <details className="qitu-tutor-evidence" onToggle={e=>{if(!e.currentTarget.open)setPreview(null);}}><summary onClick={async e=>{if(e.currentTarget.parentElement?.hasAttribute('open')||pending)return;setPreview(null);setPending(true);setError('');try{const response=await fetch(`/api/v1/student/knowledge/citations/${encodeURIComponent(citationId??'')}?projectId=${projectId}`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('资料暂不可用或授权已变更');setPreview((await response.json()).data);}catch(e){setPreview(null);setError(e instanceof Error?e.message:'读取失败');}finally{setPending(false);}}}>查看项目资料来源</summary>{pending&&<p>正在读取…</p>}{error&&<p role="alert">{error}</p>}{preview&&<div><strong>{preview.title}</strong><p>已使用：{preview.knowledgeBase}</p><p>原始资料版本：{String(preview.origin.sourceRevision??'未知')}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflowY:'auto'}}>{preview.text}</pre></div>}</details>;
}
