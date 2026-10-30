// Sidecar XMP untuk rating/label Lightroom.
// Bug lama: Rating ditulis sebagai atribut `xmlns:xmp` + `:Rating` di rdf:Description →
// itu bukan deklarasi namespace yang sah, XML jadi tidak well-formed dan
// Lightroom/Bridge/Camera Raw menolak membaca rating. Rating harus jadi elemen.

export interface XmpMeta {
  rating: number
  label: 'Green' | 'Yellow' | 'Red'
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildXmp(meta: XmpMeta): string
export function buildXmp(rating: number, label: string): string
export function buildXmp(metaOrRating: XmpMeta | number, label?: string): string {
  const meta: XmpMeta = typeof metaOrRating === 'number'
    ? { rating: metaOrRating, label: (label || 'Green') as XmpMeta['label'] }
    : metaOrRating

  const rating = Number.isFinite(Number(meta.rating)) ? Math.round(Number(meta.rating)) : 0
  const labelXml = esc(String(meta.label))
  const subject = esc(`OhMyFlow/${meta.label}`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="OhMyFlow">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
   <xmp:Rating>${rating}</xmp:Rating>
   <xmp:Label>${labelXml}</xmp:Label>
   <lr:hierarchicalSubject>
    <rdf:Bag><rdf:li>${subject}</rdf:li></rdf:Bag>
   </lr:hierarchicalSubject>
   <dc:subject>
    <rdf:Bag><rdf:li>${subject}</rdf:li></rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}
