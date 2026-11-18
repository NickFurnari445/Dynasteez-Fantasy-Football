import type { ReactNode } from "react";

function RuleSection({ id, number, title, children }: { id: string; number: string; title: string; children: ReactNode }) {
  return <section id={id} className="panel handbook-rule">
    <div className="rule-heading"><span aria-hidden="true">{number}</span><h2>{title}</h2></div>
    {children}
  </section>;
}

export function Handbook() {
  return <div className="handbook">
    <header className="handbook-masthead">
      <p className="eyebrow">The official rulebook</p>
      <h1><span>Dynasteez</span> League Handbook</h1>
      <nav aria-label="Handbook sections">
        <a href="#rosters">Rosters</a><a href="#draft-order">Draft</a><a href="#waivers">Waivers</a><a href="#trades">Trades</a>
      </nav>
    </header>
    <RuleSection id="rosters" number="01" title="Roster settings">
      <h3>Starting lineup</h3>
      <ul className="slot-list lineup-slots">{["1 QB", "2 RB", "2 WR", "1 TE", "1 FLEX", "1 SUPERFLEX", "1 K", "1 DEF"].map(slot => <li key={slot}>{slot}</li>)}</ul>
      <h3 className="sr-only">Additional roster spots</h3>
      <ul className="slot-list extra-slots">{["9 BENCH", "1 IR", "3 TAXI SQUAD"].map(slot => <li key={slot}>{slot}</li>)}</ul>
    </RuleSection>
    <section className="panel handbook-rule">
      <h2 className="roster-rules-heading">Additional roster rules</h2>
      <ul className="rule-list"><li>Each team may carry a maximum of 3 quarterbacks at any time.</li></ul>
      <p className="rule-highlight"><strong>Effective Fall 2027</strong> Three bench spots will be added, increasing bench capacity from 9 to 12.</p>
    </section>
    <header className="handbook-divider">
      <h2>League rules</h2>
      <p>Draft order, free agency and trade governance</p>
    </header>
    <RuleSection id="draft-order" number="02" title="Draft order">
      <ul className="rule-list">
        <li><strong>Picks #1 and #2.</strong> The 9th and 10th seeds play a two-week matchup. The winner receives pick #1. The loser receives pick #2 and must complete the last-place punishment.</li>
        <li><strong>Picks #3 and #4.</strong> The 7th and 8th seeds play a two-week consolation matchup. The winner receives pick #3 and the loser receives pick #4.</li>
        <li><strong>Picks #5 and #6.</strong> The winner of the fifth-place game receives pick #5 and the loser receives pick #6.</li>
        <li><strong>Picks #7 and #8.</strong> The winner of the third-place game receives pick #7 and the loser receives pick #8.</li>
        <li><strong>Pick #9.</strong> League runner-up.</li>
        <li><strong>Pick #10.</strong> League champion.</li>
      </ul>
    </RuleSection>
    <RuleSection id="waivers" number="03" title="Waiver order">
      <ul className="rule-list">
        <li>Beginning Fall 2027, waiver claims will use FAAB (Free Agency Acquisition Budget). Every manager starts the season with an equal budget and bids to claim players.</li>
        <li>FAAB bids apply only to waiver claims. Unclaimed players become free agents and can be added for free.</li>
        <li>Waivers run from the end of Monday Night Football until approximately Wednesday at 3:00 a.m., or for 2 days after a player is dropped.</li>
      </ul>
    </RuleSection>
    <RuleSection id="trades" number="04" title="Trade settings">
      <ul className="rule-list">
        <li>Trades process immediately after acceptance.</li>
        <li>A disputed trade may be discussed and voted on in the league group chat.</li>
        <li>Five votes in favor are required to overturn a disputed trade.</li>
        <li><strong>Trade deadline.</strong> Week 11.</li>
      </ul>
    </RuleSection>
  </div>;
}

