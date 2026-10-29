const ranking = [
  ["Search relevance", "40%", "How closely the item name, category and description match the buyer’s query."],
  ["Total buyer price", "25%", "Lower total payable value, including disclosed delivery and other charges, ranks higher."],
  ["Estimated delivery time", "15%", "Shorter valid delivery estimates rank higher."],
  ["Distance", "10%", "Sellers closer to the buyer’s delivery location rank higher."],
  ["Seller or product rating", "10%", "Higher network-provided ratings rank higher when comparable rating data exists."],
];

const standards = [
  "The seller, store and item must be legally eligible and must not be rejected under ONDC’s catalog and store rejection framework.",
  "The response must conform to the applicable ONDC protocol schema and contain the identifiers needed to continue the transaction.",
  "The item must be shown as available and serviceable for the buyer’s location at the time of search.",
  "The listing must include a usable item name, seller identity, price and currency. Material charges supplied by the seller are displayed before confirmation.",
  "The same standards are applied consistently to all responding sellers. Zero Margin Food Systems Foundation does not sell ranking positions or favour affiliated sellers.",
];

export default function Disclosures() {
  return <main className="policy-page">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Zero Margin Food Systems Foundation home"><span className="mark">ZM</span><span>Zero Margin<br />Food Systems Foundation</span></a><a className="ondc-back" href="/">← Foundation site</a></header>
    <section className="policy-hero"><p className="eyebrow">ONDC Buyer App · Public disclosure</p><h1>Fair search,<br /><em>explained.</em></h1><p>These disclosures describe which ONDC search responses we display and how eligible results are ranked for the Zero Margin Food buyer application.</p><div className="policy-meta"><span>Version 0.1</span><span>Effective 31 August 2026</span><span>Retail B2C · ONDC:RET10</span></div></section>
    <section className="policy-section"><div><p className="section-label">Disclosure 1</p><h2>Minimum standards for displaying search results</h2></div><ol className="policy-list">{standards.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol></section>
    <section className="policy-section policy-tint"><div><p className="section-label">Disclosure 2</p><h2>Sorting parameters and relative importance</h2><p className="policy-copy">Eligible results are sorted using the weighted factors shown here. Search relevance is the primary factor. Where a value is missing or cannot be compared reliably, it receives no preferential weight.</p></div><div className="ranking-list">{ranking.map(([title, weight, detail]) => <article key={title}><div><h3>{title}</h3><strong>{weight}</strong></div><p>{detail}</p></article>)}</div></section>
    <section className="policy-section"><div><p className="section-label">Buyer choice</p><h2>Alternative sorting</h2></div><div className="policy-prose"><p>As the buyer-facing interface is completed, buyers will be able to re-sort eligible results by total price, delivery time, distance, or rating. Filters and sorting operate only after legal, protocol and published minimum-standard checks.</p><p>Paid placement is not currently offered. If promoted results are introduced later, they will be clearly labelled and this disclosure will be updated before use.</p><p>Questions about these disclosures may be raised through our <a href="/support">customer support page</a>.</p></div></section>
  </main>;
}
