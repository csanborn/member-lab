import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="container page narrow">
      <h1>Page not found</h1>
      <p>
        That page is not here. <Link to="/">Go to Crate Club</Link>.
      </p>
    </div>
  );
}
