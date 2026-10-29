"use client";

import { useState } from "react";

const subscriberId = "ondc.zeroprofit.food";
const values = [
  ["Network participant role", "Buyer NP"],
  ["Registry", "ONDC pre-production registry"],
  ["Subscriber ID", subscriberId],
  ["Subscriber URL", "https://ondc.zeroprofit.food/buyer"],
  ["Pilot scope", "Hyderabad · Retail / groceries (RET10)"],
];

export default function OndcSetup() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }
  return <main className="ondc-page">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Zero Margin Food Systems Foundation home"><span className="mark">ZM</span><span>Zero Margin<br />Food Systems Foundation</span></a><a className="ondc-back" href="/">← Foundation site</a></header>
    <section className="ondc-hero">
      <p className="eyebrow">ONDC pre-production onboarding</p>
      <h1>Portal answers,<br /><em>prepared.</em></h1>
      <p>Use this page beside the ONDC portal. It keeps the first pilot intentionally narrow: a Buyer Network Participant for grocery discovery in Hyderabad.</p>
    </section>
    <section className="ondc-card" aria-labelledby="portal-values">
      <div><p className="section-label">Step 1.a</p><h2 id="portal-values">Enter these values</h2></div>
      <dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code><button onClick={() => copy(label, value)} aria-label={`Copy ${label}`}>{copied === label ? "Copied" : "Copy"}</button></dd></div>)}</dl>
      <p className="ondc-note"><strong>Pre-production integration is in progress.</strong> DNS, callback routes, signing keys and protocol logging are configured. ONDC build verification, grievance and payout walkthroughs, and production onboarding remain pending.</p>
    </section>
    <section className="ondc-steps">
      <p className="section-label">Integration status</p>
      <ol>
        <li><span>01</span><div><h3>Public callback service</h3><p><code>https://ondc.zeroprofit.food/buyer</code> receives transaction, IGM and RSF callbacks over HTTPS.</p></div></li>
        <li><span>02</span><div><h3>Signed protocol exchange</h3><p>Signing keys remain protected in the backend. Outbound test calls are signed and transaction logs are retained for verification.</p></div></li>
        <li><span>03</span><div><h3>Network observability</h3><p>Pre-production requests, callbacks and synchronous acknowledgements are anonymised and submitted automatically using the portal-issued N.O. token.</p></div></li>
      </ol>
    </section>
    <section className="ondc-goal"><p className="section-label">Pilot status</p><h2>Hyderabad grocery<br /><em>pre-production pilot.</em></h2><p>The signed search and transaction flows are for ONDC Workbench verification. The buyer ordering service is not open yet. We will publish shopping access after ONDC verification and production onboarding are complete.</p><div className="ondc-public-links"><a href="/disclosures">Buyer app disclosures</a><a href="/terms">Static terms</a><a href="/support">Customer support</a></div></section>
  </main>;
}
