const PERKS = [
  { title: 'Free delivery over $20', body: 'No delivery fee on any order of $20 or more, from every shop on Corner Crate.' },
  { title: 'Half the service fee', body: 'The service fee on every order is cut in half, whatever the order size.' },
  { title: 'Member prices', body: 'Weekly picks from neighborhood shops at prices only members see.' },
  { title: 'First pick of busy slots', body: 'Book delivery windows on holidays and storm days before anyone else.' },
];

/** Sits under an h2, so each perk is an h3. */
export function Perks() {
  return (
    <ul className="perks">
      {PERKS.map((perk, index) => (
        <li key={perk.title} className="perk">
          <span className="perk__mark" aria-hidden="true">
            {index + 1}
          </span>
          <h3 className="perk__title">{perk.title}</h3>
          <p>{perk.body}</p>
        </li>
      ))}
    </ul>
  );
}
