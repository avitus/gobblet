import {
  Badge,
  Banner,
  Button,
  Card,
  SelectField,
  Spinner,
  TextField,
} from "@gobblet/design-system";
import { USER_STATUSES } from "@gobblet/protocol";
import type { AdminUserSearchQuery, UserStatus } from "@gobblet/protocol";
import { useState } from "react";
import { Link } from "react-router";
import { describeApiError } from "../api/errors";
import { useAdminUsers } from "../api/queries";
import styles from "./Admin.module.css";

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  ...USER_STATUSES.map((status) => ({ value: status, label: status })),
];

/**
 * Account search (appendix P7.2). A username prefix, an internal id or a whole email
 * address matches; a partial address does not, so the surface cannot be used to
 * enumerate addresses, and no address is shown until one account is opened.
 */
export function AdminUsersScreen(): React.JSX.Element {
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState<AdminUserSearchQuery>({});
  const users = useAdminUsers(query, true);
  const pages = users.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.users);

  return (
    <Card title="Accounts" description="A username prefix, an id, or a whole email address.">
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({
            ...(term.trim() === "" ? {} : { query: term.trim() }),
            ...(status === "" ? {} : { status: status as UserStatus }),
          });
        }}
      >
        <TextField
          label="Search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          data-testid="admin-user-search"
        />
        <SelectField
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(event) => {
            setStatus(event.target.value);
          }}
          data-testid="admin-user-status"
        />
        <Button type="submit" data-testid="admin-user-search-submit">
          Search
        </Button>
      </form>

      {users.isPending && <Spinner label="Searching accounts" />}
      {users.isError && <Banner tone="error">{describeApiError(users.error)}</Banner>}

      {users.isSuccess &&
        (rows.length === 0 ? (
          <p data-testid="admin-users-empty">No account matches that.</p>
        ) : (
          <table className={styles.table} data-testid="admin-users-table">
            <thead>
              <tr>
                <th scope="col">Username</th>
                <th scope="col">Status</th>
                <th scope="col">Role</th>
                <th scope="col">Email</th>
                <th scope="col">Rating</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.userId} data-testid={`admin-user-row-${user.username}`}>
                  <td>
                    <Link to={`/admin/users/${user.userId}`}>{user.username}</Link>
                  </td>
                  <td>
                    <Badge tone={user.status === "active" ? "ok" : "warn"}>{user.status}</Badge>
                  </td>
                  <td>{user.role}</td>
                  <td>{user.emailVerified ? "verified" : "unverified"}</td>
                  <td className={styles.numeric}>{user.rating ?? "unrated"}</td>
                  <td>{user.lastSeenAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {users.hasNextPage === true && (
        <Button
          variant="secondary"
          size="sm"
          busy={users.isFetchingNextPage}
          onClick={() => {
            void users.fetchNextPage();
          }}
          data-testid="admin-users-more"
        >
          Show more
        </Button>
      )}
    </Card>
  );
}
