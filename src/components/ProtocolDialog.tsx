import { Download, X } from "lucide-react";

import { getCopy } from "../i18n";
import type { ProtocolResource, RvLiteProtocolResource, TelepathicProtocolResource } from "../resources/protocolRegistry";
import { saveTextFile } from "../storage/native";

export function ProtocolDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: ProtocolResource | RvLiteProtocolResource | TelepathicProtocolResource; onClose: () => void }) {
  const save = () => void saveTextFile(copy.home === "Home" ? "Save protocol resource" : "Zapisz zasób protokołu", `${resource.displayName.replace(/[^a-z0-9._-]+/gi, "_")}_v${resource.version}_${resource.language}.md`, resource.content);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{copy.protocolResource}</small><h2>{resource.displayName}</h2><p>v{resource.version} · {resource.language.toUpperCase()} · {wordCount(resource.content).toLocaleString()} {copy.wordCount.toLowerCase()}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="hash-grid"><code>{"sourceDocxSha256" in resource ? <>{copy.sourceHash}<br />{resource.sourceDocxSha256}</> : <>Source<br />{resource.sourceFormat}</>}</code><code>{copy.contentHash}<br />{resource.contentSha256}</code></div>
        <pre className="protocol-text">{resource.content}</pre>
        <div className="modal-actions"><button className="secondary-button" onClick={save}><Download size={14} />{copy.home === "Home" ? "Save" : "Zapisz"}</button><button className="primary-button" onClick={onClose}>{copy.close}</button></div>
      </section>
    </div>
  );
}


function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
