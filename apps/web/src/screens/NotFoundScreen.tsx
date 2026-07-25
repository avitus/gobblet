import { Card } from "@gobblet/design-system";
import { Link } from "react-router";

export function NotFoundScreen(): React.JSX.Element {
  return (
    <Card title="Nothing here">
      <p>
        That address does not exist. <Link to="/">Back to the lobby</Link>.
      </p>
    </Card>
  );
}
